// Drives Meet's own caption controls: turns captions on, switches the recognition language to Ukrainian,
// and hides / shows the native overlay (CSS in content/page.css keyed off the html class and a data attribute).
(function (root) {
  const MT = (root.MT = root.MT || {});
  const dom = () => MT.dom;

  const HIDE_CLASS = 'mt-hide-captions';
  const ROOT_ATTR = 'data-mt-caption-root';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function waitFor(fn, timeoutMs = 3000, stepMs = 100) {
    const t0 = Date.now();
    for (;;) {
      const v = fn();
      if (v) return v;
      if (Date.now() - t0 > timeoutMs) return null;
      await sleep(stepMs);
    }
  }

  let toggling = false;

  const POPUP_CLOSE_MS = 800; // Meet's popup animates out over ~0.5 s; a second click earlier would reopen it
  const REACTIONS_BACK_MS = 1500; // how long Meet gets to bring the reactions bar back after the popup closes

  // New UI: open the "Captions and translation" popup, flip "Live captions" to `on`, close the popup again.
  // The popup takes the slot of the reactions bar, so it is closed with the same menu button that opened it.
  // Meet restores the bar afterwards; if it does not (seen once, mechanism unknown), the bar is reopened with
  // its own button. Every round trip is logged with the states around it so the next occurrence can be read.
  async function setCaptionsViaMenu(on) {
    const menu = dom().captionsMenuButton();
    if (!menu) return false;
    const reactionsBefore = dom().reactionsWanted();
    let opened = false;
    if (!dom().liveCaptionsToggle()) {
      menu.click();
      opened = true;
    }
    const toggle = await waitFor(() => dom().liveCaptionsToggle(), 2000);
    if (toggle && (dom().captionsState() === 'on') !== on) toggle.click();
    const done = !!(await waitFor(() => (on ? dom().findRegion() : dom().captionsState() === 'off'), 3000));
    const closed = opened ? await closePopup() : null;
    let reactionsRestored = null;
    if (opened && reactionsBefore && !(await waitFor(() => dom().reactionsWanted(), REACTIONS_BACK_MS))) {
      dom().reactionsButton()?.click();
      reactionsRestored = !!(await waitFor(() => dom().reactionsWanted(), 1000));
    }
    console.info('[meet-transcriber] captions popup round trip', JSON.stringify({
      on, opened, toggled: !!toggle, done, closed, reactionsBefore, reactionsAfter: dom().reactionsWanted(), reactionsRestored,
    }));
    return done;
  }

  // Closes the popup with the menu button and waits until it is really gone; one retry, and only after Meet
  // had time to finish its close animation (an earlier click toggles the popup open again).
  async function closePopup() {
    for (let i = 0; i < 2 && dom().captionsDialog(); i++) {
      dom().captionsMenuButton()?.click();
      if (await waitFor(() => !dom().captionsDialog(), POPUP_CLOSE_MS)) return true;
    }
    return !dom().captionsDialog();
  }

  // Turns captions on. Returns a promise of true when it tried; at most one attempt runs at a time
  // (the session polls every second and the popup round trip takes longer).
  async function enableCaptions() {
    if (toggling || dom().captionsState() !== 'off') return false;
    toggling = true;
    try {
      const btn = dom().captionsButton();
      if (btn) btn.click();
      else await setCaptionsViaMenu(true);
      return true;
    } finally {
      toggling = false;
    }
  }

  function currentLanguage() {
    const label = dom().languageLabel();
    return label ? { label, ukrainian: dom().isUkrainian(label) } : null;
  }

  // Opens Meet's "Meeting language" combobox and picks Ukrainian. Returns true on success.
  async function setUkrainian() {
    const combo = await waitFor(() => dom().languageCombobox(), 3000);
    if (!combo) return false;
    if (dom().isUkrainian(dom().languageLabel(combo))) return true;
    combo.click();
    const option = await waitFor(() => document.querySelector(MT.sel.languageOptionUk), 2000);
    if (!option) {
      combo.click(); // close the list again
      return false;
    }
    option.click();
    return !!(await waitFor(() => dom().isUkrainian(dom().languageLabel()), 2000));
  }

  // Marks the overlay root so page.css can hide it; re-run whenever Meet re-renders the captions region.
  function markRoot(region) {
    if (!region) return;
    const el = dom().captionRoot(region);
    if (el && !el.hasAttribute(ROOT_ATTR)) el.setAttribute(ROOT_ATTR, '');
  }

  let overlayVisible = true;

  // Main document only. Meet's picture-in-picture window (Document PiP) is a separate document with its own
  // captions band; it is left alone on purpose: collapsing that band made Meet close its reactions bar for
  // good, both right after the automatic PiP opened and later while it stayed open (live recon 2026-11-09,
  // docs/meet-dom.md). Recording reads the main document, which keeps rendering captions while PiP is open.
  function setOverlayVisible(visible) {
    overlayVisible = visible;
    document.documentElement.classList.toggle(HIDE_CLASS, !visible);
  }

  // True when Meet keeps a band for captions under the video although the overlay is collapsed
  // (it measured the overlay before our CSS applied). Normal gap stage→controls is ~70px, reserved ~280px.
  function spaceReserved() {
    const stage = dom().stage();
    const leave = dom().leaveButton();
    if (!stage || !leave || !stage.offsetParent) return false;
    // Layout box, not getBoundingClientRect(): the sidebar may scale the stage with a transform.
    const bottom = stage.offsetParent.getBoundingClientRect().top + stage.offsetTop + stage.offsetHeight;
    return leave.getBoundingClientRect().top - bottom > 150;
  }

  // Switching captions off and on makes Meet measure the (now collapsed) overlay again.
  async function remeasure() {
    if (toggling || dom().captionsState() !== 'on') return false;
    toggling = true;
    try {
      if (!dom().captionsButton()) {
        if (!(await setCaptionsViaMenu(false))) return false;
        await sleep(300);
        return await setCaptionsViaMenu(true);
      }
      dom().captionsButton()?.click();
      if (!(await waitFor(() => dom().captionsState() === 'off', 2000))) return false;
      await sleep(300);
      dom().captionsButton()?.click();
      return !!(await waitFor(() => dom().findRegion(), 3000));
    } finally {
      toggling = false;
    }
  }

  MT.captions = { enableCaptions, busy: () => toggling, setUkrainian, currentLanguage, markRoot, setOverlayVisible, spaceReserved, remeasure, waitFor };
})(globalThis);
