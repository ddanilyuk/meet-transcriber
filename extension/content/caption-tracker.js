// Watches Meet's captions region and feeds snapshots into a TranscriptBuilder.
// Meet swaps the region out when captions are toggled or the layout changes, so the tracker re-attaches
// whenever the region node is replaced. Scans are throttled; timers (not rAF) keep working in hidden tabs.
(function (root) {
  const MT = (root.MT = root.MT || {});

  class CaptionTracker {
    constructor({ builder, onChange, onRegion, throttleMs = 150, checkMs = 1000 }) {
      this.builder = builder;
      this.onChange = onChange || (() => {});
      this.onRegion = onRegion || (() => {});
      this.throttleMs = throttleMs;
      this.checkMs = checkMs;
      this.region = null;
      this.observer = new MutationObserver(() => this.schedule());
      this.timer = null;
      this.interval = null;
    }

    start() {
      this.check();
      this.interval = setInterval(() => this.check(), this.checkMs);
    }

    stop() {
      clearInterval(this.interval);
      clearTimeout(this.timer);
      this.observer.disconnect();
      this.region = null;
    }

    // Attach to a new region node if Meet replaced it; report region presence changes.
    check() {
      const region = MT.dom.findRegion();
      if (region !== this.region) {
        this.observer.disconnect();
        this.region = region;
        if (region) this.observer.observe(region, { childList: true, subtree: true, characterData: true });
        this.onRegion(region);
        this.scan();
      } else if (region) {
        // Also catches the pause timeout that ends the "live" highlight without any DOM mutation.
        this.scan();
      }
    }

    schedule() {
      if (this.timer) return;
      this.timer = setTimeout(() => {
        this.timer = null;
        this.scan();
      }, this.throttleMs);
    }

    scan() {
      const blocks = this.region && this.region.isConnected ? MT.dom.parseBlocks(this.region) : [];
      const { changed, liveId } = this.builder.update(blocks);
      if (changed) this.onChange({ liveId });
    }
  }

  MT.CaptionTracker = CaptionTracker;
})(globalThis);
