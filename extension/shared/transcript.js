// TranscriptBuilder: turns snapshots of Meet's caption blocks into a stable list of transcript entries.
//
// Meet keeps one DOM block per speaker turn and rewrites its text in place: words are appended every ~300ms,
// the tail gets revised as recognition improves, and a single block can keep growing for minutes. Meet has
// also been known to drop the head of very long blocks (a sliding window) and to re-render the whole
// captions region (layout changes, captions toggled). The builder therefore:
//   - tracks each block by an opaque key (the DOM element in production);
//   - splits a block's text into segments at pauses, one transcript entry per segment;
//   - re-anchors segment offsets when the head of a block is cut off;
//   - lets a re-rendered block adopt the entries of the block it replaced instead of duplicating them.
(function (root) {
  const MT = (root.MT = root.MT || {});

  const DEFAULTS = {
    pauseMs: 4000, // silence that starts a new paragraph within the same block
    anchorLen: 24, // chars used to find where a truncated block continues
    minAnchor: 12,
    adoptWindowMs: 15000, // a released block can be adopted by a re-rendered one for this long
    now: () => Date.now(),
    idPrefix: 'e',
  };

  const clean = (s) => String(s || '').replace(/\s+/g, ' ');

  function commonPrefix(a, b) {
    const n = Math.min(a.length, b.length);
    let i = 0;
    while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++;
    return i;
  }

  // Move `pos` forward to the next word boundary so segments never start mid-word.
  function snapToWord(text, pos) {
    if (pos <= 0) return 0;
    if (pos >= text.length) return text.length;
    if (text[pos - 1] === ' ') return pos;
    const next = text.indexOf(' ', pos);
    return next === -1 ? text.length : next + 1;
  }

  class TranscriptBuilder {
    constructor(opts = {}) {
      this.opts = { ...DEFAULTS, ...opts };
      this.blocks = new Map(); // key -> block state
      this.released = new Map(); // blockNo -> {speaker, releasedAt}
      this.entries = [];
      this.byId = new Map();
      this.seq = 0;
      this.blockSeq = 0;
      this.liveId = null;
      this.selfName = null;
      this.selfLabels = new Set(['you', 'ви', 'вы']);
    }

    // Restores entries from storage (e.g. after a page reload in the middle of a meeting).
    load(entries) {
      this.entries = (entries || []).map((e) => ({ ...e }));
      this.byId = new Map(this.entries.map((e) => [e.id, e]));
      for (const e of this.entries) {
        this.seq = Math.max(this.seq, Number(String(e.id).split('-').pop()) || 0);
        this.blockSeq = Math.max(this.blockSeq, e.block || 0);
      }
    }

    setSelfName(name) {
      const next = name ? clean(name).trim() : null;
      if (!next || next === this.selfName) return false;
      const prev = this.selfName || MT.t?.you || 'Ви';
      this.selfName = next;
      let changed = false;
      for (const e of this.entries) {
        if (e.self && e.speaker === prev) { e.speaker = next; changed = true; }
      }
      for (const state of this.blocks.values()) if (state.self) state.speaker = next;
      return changed;
    }

    resolveSpeaker(raw) {
      const name = clean(raw).trim();
      if (!name) return { speaker: '', self: false };
      if (this.selfLabels.has(name.toLowerCase())) return { speaker: this.selfName || MT.t?.you || 'Ви', self: true };
      return { speaker: name, self: false };
    }

    newEntry(state, now) {
      const entry = {
        id: `${this.opts.idPrefix}-${++this.seq}`,
        block: state.no,
        speaker: state.speaker,
        text: '',
        startedAt: now,
        updatedAt: now,
      };
      if (state.self) entry.self = true;
      this.entries.push(entry);
      this.byId.set(entry.id, entry);
      return entry;
    }

    // Applies one snapshot of all blocks currently in the DOM: [{key, speaker, text}] in DOM order.
    // Returns {changed, liveId}.
    update(blocks) {
      const now = this.opts.now();
      let changed = false;
      let liveId = null;

      // Blocks gone from the DOM are final, but can be adopted by a re-rendered twin for a short while.
      // Release them first: a re-render removes the old nodes and adds new ones in the same snapshot.
      const present = new Set(blocks.map((b) => b.key));
      for (const [key, state] of this.blocks) {
        if (present.has(key)) continue;
        this.blocks.delete(key);
        this.released.set(state.no, { speaker: state.speaker, releasedAt: now });
      }
      for (const [no, r] of this.released) {
        if (now - r.releasedAt > this.opts.adoptWindowMs) this.released.delete(no);
      }

      for (const b of blocks) {
        const { speaker, self } = this.resolveSpeaker(b.speaker);
        const text = clean(b.text);
        if (!speaker) continue; // system notices have no speaker
        let state = this.blocks.get(b.key);
        if (!state) {
          if (!text.trim()) continue;
          state = this.adopt(speaker, self, text, now) || {
            no: ++this.blockSeq, speaker, self, last: '', segments: [], lastChangeAt: now,
          };
          this.blocks.set(b.key, state);
        }
        if (this.applyText(state, speaker, self, text, now)) changed = true;
        const active = state.segments[state.segments.length - 1];
        if (active && now - state.lastChangeAt < this.opts.pauseMs) liveId = active.entryId;
      }

      if (liveId !== this.liveId) changed = true;
      this.liveId = liveId;
      return { changed, liveId };
    }

    // Finds a recently released block whose text the new block repeats (Meet re-rendered the region).
    adopt(speaker, self, cur, now) {
      const o = this.opts;
      for (const [no, r] of [...this.released].reverse()) {
        if (r.speaker !== speaker || now - r.releasedAt > o.adoptWindowMs) continue;
        const group = this.entries.filter((e) => e.block === no && e.text);
        if (!group.length) continue;
        const head = group[0].text.slice(0, o.anchorLen);
        if (!cur.startsWith(head) && commonPrefix(cur, group[0].text) < Math.min(o.anchorLen, group[0].text.length)) continue;
        const segments = [];
        let pos = 0;
        for (const e of group) {
          const probe = e.text.slice(0, Math.min(o.minAnchor, e.text.length));
          let idx = cur.indexOf(probe, pos);
          if (idx < 0) idx = Math.min(pos, cur.length);
          segments.push({ entryId: e.id, start: idx });
          pos = idx + e.text.length;
        }
        this.released.delete(no);
        return { no, speaker, self, last: cur, segments, lastChangeAt: now, adopted: true };
      }
      return null;
    }

    applyText(state, speaker, self, cur, now) {
      const prev = state.last;
      if (cur === prev && speaker === state.speaker && !state.adopted) return false;
      state.adopted = false;
      const o = this.opts;
      let changed = false;

      if (speaker !== state.speaker) {
        // Meet occasionally resolves a name late (placeholder -> real name).
        state.speaker = speaker;
        state.self = self;
        for (const seg of state.segments) {
          const e = this.byId.get(seg.entryId);
          if (e && e.speaker !== speaker) { e.speaker = speaker; changed = true; }
        }
      }

      // Head truncation: the new text is much shorter and does not start like the old one.
      if (prev.length > 80 && cur.length < prev.length * 0.8 && commonPrefix(prev, cur) < o.minAnchor) {
        const probe = cur.slice(0, Math.min(o.anchorLen, cur.length));
        const k = probe.length >= o.minAnchor ? prev.indexOf(probe) : -1;
        const segs = state.segments;
        if (k > 0) {
          // Shift offsets by k; text that scrolled out is kept in `base` of the segment it belonged to.
          for (let i = 0; i < segs.length; i++) {
            const seg = segs[i];
            if (seg.frozen) continue;
            const oldEnd = i + 1 < segs.length ? segs[i + 1].start : prev.length;
            if (oldEnd <= k) seg.frozen = true;
            else if (seg.start < k) {
              seg.base = (seg.base || '') + prev.slice(Math.max(0, seg.start), k);
              seg.start = 0;
            } else seg.start -= k;
          }
        } else {
          // Unrelated text: keep everything so far as final and continue in a fresh segment.
          for (const seg of segs) seg.frozen = true;
          segs.push({ entryId: this.newEntry(state, now).id, start: 0 });
        }
      }

      const grew = cur.length > prev.length;
      const paused = now - state.lastChangeAt >= o.pauseMs;
      if (!state.segments.length) {
        state.segments.push({ entryId: this.newEntry(state, now).id, start: 0 });
      } else if (grew && paused) {
        const cut = snapToWord(cur, Math.min(prev.length, cur.length));
        const active = state.segments[state.segments.length - 1];
        if (cut > active.start && cut < cur.length) {
          state.segments.push({ entryId: this.newEntry(state, now).id, start: cut });
        }
      }

      // Recompute segment texts from the current block text. Frozen segments (scrolled out of the block)
      // keep their last known text.
      const segs = state.segments;
      for (let i = 0; i < segs.length; i++) {
        const seg = segs[i];
        if (seg.frozen) continue;
        const end = i + 1 < segs.length ? segs[i + 1].start : cur.length;
        const text = clean((seg.base || '') + cur.slice(seg.start, Math.max(seg.start, end))).trim();
        const entry = this.byId.get(seg.entryId);
        if (entry && text && entry.text !== text) {
          entry.text = text;
          entry.updatedAt = now;
          changed = true;
        }
      }

      state.last = cur;
      state.lastChangeAt = now;
      return changed;
    }

    // Entries with text, in order.
    snapshot() {
      return this.entries.filter((e) => e.text);
    }

    speakers() {
      return [...new Set(this.snapshot().map((e) => e.speaker))];
    }
  }

  MT.TranscriptBuilder = TranscriptBuilder;
  MT.transcriptInternals = { commonPrefix, snapToWord, clean };
})(globalThis);
