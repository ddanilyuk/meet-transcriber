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

  function enableCaptions() {
    if (dom().captionsState() !== 'off') return false;
    dom().captionsButton()?.click();
    return true;
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

  function setOverlayVisible(visible) {
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
    if (dom().captionsState() !== 'on') return false;
    dom().captionsButton()?.click();
    if (!(await waitFor(() => dom().captionsState() === 'off', 2000))) return false;
    await sleep(300);
    dom().captionsButton()?.click();
    return !!(await waitFor(() => dom().findRegion(), 3000));
  }

  MT.captions = { enableCaptions, setUkrainian, currentLanguage, markRoot, setOverlayVisible, spaceReserved, remeasure, waitFor };
})(globalThis);
