// Meeting lifecycle on the Meet page: detects joining and leaving the call, starts or resumes the stored
// meeting, keeps captions on and in Ukrainian, saves transcript progress, and exposes state for the sidebar.
(function (root) {
  const MT = (root.MT = root.MT || {});

  const POLL_MS = 1000;
  const SAVE_DEBOUNCE_MS = 1500;
  const LEAVE_MISSES = 3; // polls without the Leave button before the call counts as left
  const NOT_FOUND_MS = 10000;
  const DEFAULT_SETTINGS = { autoCaptions: true, autoUkrainian: true, showOverlay: false, autoDownload: true };

  class MeetingSession {
    constructor() {
      this.settings = { ...DEFAULT_SETTINGS };
      this.meeting = null;
      this.builder = null;
      this.tracker = null;
      this.status = 'idle'; // idle | waiting | recording | off | notfound | ended
      this.language = null; // { label, ukrainian }
      this.banner = null;
      this.bannerDismissed = false;
      this.contextLost = false;
      this.listeners = new Set();
      this.misses = 0;
      this.starting = false;
      this.saveTimer = null;
      this.regionMissingSince = null;
      this.languageTried = false;
      this.ccAttempts = 0;
    }

    on(fn) {
      this.listeners.add(fn);
      return () => this.listeners.delete(fn);
    }

    emit(kind) {
      for (const fn of this.listeners) {
        try { fn(kind, this); } catch (err) { console.error('[meet-transcriber]', err); }
      }
    }

    async init() {
      const settings = await MT.send('tab:hello', { code: MT.dom.meetingCode() });
      if (settings) this.settings = { ...DEFAULT_SETTINGS, ...settings };
      MT.captions.setOverlayVisible(this.settings.showOverlay);
      try {
        chrome.storage.onChanged.addListener((changes, area) => {
          if (area !== 'local' || !changes.settings?.newValue) return;
          this.settings = { ...DEFAULT_SETTINGS, ...changes.settings.newValue };
          MT.captions.setOverlayVisible(this.settings.showOverlay);
          this.emit('settings');
        });
      } catch { /* extension context gone */ }
      addEventListener('pagehide', () => {
        if (this.destroyed) return;
        this.saveNow();
        MT.send('tab:bye');
      });
      this.poll();
      this.pollTimer = setInterval(() => this.poll(), POLL_MS);
    }

    // ---------- lifecycle ----------

    poll() {
      if (!MT.contextAlive()) return this.onContextLost();
      const inCall = MT.dom.isInCall();
      if (inCall) this.misses = 0;
      if (inCall && !this.meeting && !this.starting) this.start();
      if (!inCall && this.meeting && ++this.misses >= LEAVE_MISSES) this.end();
      if (this.meeting && inCall) this.refresh();
    }

    async start() {
      this.starting = true;
      const title = MT.dom.meetingTitle();
      const res = await MT.send('session:start', { code: MT.dom.meetingCode(), title, url: location.origin + location.pathname });
      this.starting = false;
      if (!res) return;
      this.meeting = res.meeting;
      this.lastAutoTitle = title;
      this.titleDirty = false;
      this.settings = { ...DEFAULT_SETTINGS, ...res.settings };
      this.status = 'waiting';
      this.languageTried = false;
      this.ccAttempts = 0;
      this.reclaims = 0;
      this.builder = new MT.TranscriptBuilder();
      this.builder.load(this.meeting.entries);
      this.tracker = new MT.CaptionTracker({
        builder: this.builder,
        onChange: () => {
          this.emit('transcript');
          this.scheduleSave();
        },
        onRegion: (region) => this.onRegion(region),
      });
      this.tracker.start();
      MT.captions.setOverlayVisible(this.settings.showOverlay);
      console.info('[meet-transcriber]', res.resumed ? 'resumed' : 'started', this.meeting.id);
      this.emit('state');
    }

    // The extension was reloaded or updated under this page, so nothing can be saved from here any more. Stop
    // claiming to record; the service worker injects a fresh copy that takes over (destroy()) and resumes the
    // meeting. The banner is for the case when that copy never comes.
    onContextLost() {
      if (this.contextLost) return;
      this.contextLost = true;
      this.tracker?.stop();
      this.status = 'ended';
      this.banner = { kind: 'reload' };
      this.emit('state');
    }

    // A newer copy of the content script took over this page.
    destroy() {
      this.destroyed = true;
      clearInterval(this.pollTimer);
      clearTimeout(this.saveTimer);
      this.tracker?.stop();
      this.listeners.clear();
    }

    async end() {
      const meeting = this.meeting;
      if (!meeting) return;
      this.tracker?.stop();
      await this.saveNow();
      await MT.send('session:end', { id: meeting.id });
      this.meeting = null;
      this.status = 'ended';
      this.lastMeeting = meeting;
      console.info('[meet-transcriber] ended', meeting.id);
      this.emit('state');
    }

    // Periodic checks while in the call: captions state, language, own name, title.
    refresh() {
      const cc = MT.dom.captionsState();
      if (cc === 'off' && this.settings.autoCaptions && this.ccAttempts < 3) {
        this.ccAttempts++;
        MT.captions.enableCaptions();
      }

      const region = this.tracker?.region;
      if (region) this.regionMissingSince = null;
      else if (cc === 'on') this.regionMissingSince ??= Date.now();
      else this.regionMissingSince = null;

      let status;
      if (cc === 'off') status = 'off';
      else if (region) status = 'recording';
      else if (this.regionMissingSince && Date.now() - this.regionMissingSince > NOT_FOUND_MS) status = 'notfound';
      else status = 'waiting';

      let changed = status !== this.status;
      this.status = status;

      if (region) {
        const lang = MT.captions.currentLanguage();
        if (lang && lang.label !== this.language?.label) {
          this.language = lang;
          this.meeting.language = lang.label;
          this.scheduleSave();
          changed = true;
        }
        const banner = this.language && !this.language.ukrainian && !this.bannerDismissed && this.languageTried
          ? { kind: 'lang', lang: this.language.label } : null;
        if (JSON.stringify(banner) !== JSON.stringify(this.banner)) {
          this.banner = banner;
          changed = true;
        }
      }

      if (!this.builder.selfName) {
        // setSelfName() stores the name either way and reports whether existing entries were renamed.
        const self = MT.dom.selfName();
        if (self && this.builder.setSelfName(self)) {
          this.scheduleSave();
          this.emit('transcript');
        }
      }

      // Follow Meet's title only when it changes, so a rename in the archive is not overwritten.
      const title = MT.dom.meetingTitle();
      if (title && title !== this.lastAutoTitle) {
        this.lastAutoTitle = title;
        if (title !== this.meeting.title) {
          this.meeting.title = title;
          this.titleDirty = true;
          this.scheduleSave();
          changed = true;
        }
      }

      if (changed) this.emit('state');
    }

    async onRegion(region) {
      if (!region) return;
      MT.captions.markRoot(region);
      if (!this.languageTried) {
        this.languageTried = true;
        if (this.settings.autoUkrainian) {
          const ok = await MT.captions.setUkrainian();
          if (!ok) console.warn('[meet-transcriber] could not switch captions to Ukrainian');
        }
        this.refresh();
      }
      this.reclaimSpaceSoon();
    }

    // If Meet still reserves room for the hidden captions, make it measure the collapsed overlay again.
    reclaimSpaceSoon(delay = 1500) {
      clearTimeout(this.reclaimTimer);
      this.reclaimTimer = setTimeout(async () => {
        // Toggling captions is disruptive, so never more than twice per meeting.
        if (this.settings.showOverlay || this.reclaiming || this.reclaims >= 2 || !MT.captions.spaceReserved()) return;
        this.reclaims = (this.reclaims || 0) + 1;
        this.reclaiming = true;
        console.info('[meet-transcriber] reclaiming the space Meet reserved for captions');
        await MT.captions.remeasure();
        this.reclaiming = false;
      }, delay);
    }

    // ---------- persistence ----------

    scheduleSave() {
      clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(() => this.saveNow(), SAVE_DEBOUNCE_MS);
    }

    async saveNow() {
      clearTimeout(this.saveTimer);
      if (!this.meeting || !this.builder) return;
      const entries = this.builder.snapshot();
      const patch = { entries, speakers: this.builder.speakers(), language: this.meeting.language };
      if (this.titleDirty) {
        patch.title = this.meeting.title;
        this.titleDirty = false;
      }
      await MT.send('session:update', { id: this.meeting.id, patch });
    }

    // ---------- actions from the sidebar ----------

    entries() {
      return this.builder ? this.builder.snapshot() : this.lastMeeting?.entries || [];
    }

    liveId() {
      return this.status === 'recording' ? this.builder?.liveId || null : null;
    }

    currentMeeting() {
      return this.meeting || this.lastMeeting || null;
    }

    async setSetting(key, value) {
      this.settings = { ...this.settings, [key]: value };
      if (key === 'showOverlay') {
        MT.captions.setOverlayVisible(value);
        if (!value) this.reclaimSpaceSoon(600);
      }
      this.emit('settings');
      await MT.send('settings:set', { patch: { [key]: value } });
    }

    enableCaptions() {
      this.ccAttempts = 0;
      MT.captions.enableCaptions();
    }

    async chooseUkrainian() {
      const ok = await MT.captions.setUkrainian();
      if (!ok) {
        // Fall back to showing Meet's own controls so the user can pick the language by hand.
        await this.setSetting('showOverlay', true);
      }
      this.refresh();
      return ok;
    }

    dismissBanner() {
      this.bannerDismissed = true;
      this.banner = null;
      this.emit('state');
    }
  }

  MT.MeetingSession = MeetingSession;
})(globalThis);
