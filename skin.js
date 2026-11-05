/* The look toggle: the default macOS look, or the Linear look (skins.css). The choice is stored in this browser, and an inline script in
   index.html applies it before the first paint so the page does not flash in the other look. Switching redraws the canvas charts, which
   take their colours from the look (canvasTheme). */
(() => {
  const KEY = 'apex-skin', LOOKS = ['macos', 'linear'];
  function apply(skin, persist = true) {
    const next = LOOKS.includes(skin) ? skin : 'macos';
    if (next === 'macos') delete document.documentElement.dataset.skin;
    else document.documentElement.dataset.skin = next;
    const button = document.getElementById('skinToggle');
    if (button) {
      const linear = next === 'linear';
      button.setAttribute('aria-pressed', String(linear));
      button.setAttribute('aria-label', linear ? 'Use the macOS look' : 'Use the Linear look');
      button.title = linear ? 'Look: Linear. Switch to the macOS look' : 'Look: macOS. Switch to the Linear look';
    }
    if (persist) { try { localStorage.setItem(KEY, next); } catch { /* applies to this page only */ } }
    // The sliding segment highlights are measured; the Linear look changes control sizes, so measure again.
    requestAnimationFrame(() => window.ApexUI?.decorate(document));
    if (typeof loaded !== 'undefined' && typeof drawAll === 'function') {
      if (loaded.length) drawAll();
      else if (typeof selected !== 'undefined' && selected.length && typeof renderMiniSectorMap === 'function') renderMiniSectorMap();
    }
    window.dispatchEvent(new CustomEvent('apex-skin', {detail: next}));
  }
  addEventListener('DOMContentLoaded', () => {
    apply(document.documentElement.dataset.skin || 'macos', false);
    document.getElementById('skinToggle')?.addEventListener('click', () => apply(document.documentElement.dataset.skin === 'linear' ? 'macos' : 'linear'));
  });
  window.ApexSkin = {apply};
})();
