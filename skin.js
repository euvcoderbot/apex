/* The look. The Linear look is the only one: index.html marks <html data-skin="linear"> before the first paint, and this
   announces it once the page is ready. Several modules (the Linear workspace, the Live and Season entry points, the
   dashboard layout) set themselves up on the 'apex-skin' event, so it still fires once at start-up. */
(() => {
  function ready() {
    document.documentElement.dataset.skin = 'linear';
    try { localStorage.removeItem('apex-skin'); } catch { /* storage is optional */ }
    // Segment highlights are measured, so measure again with the Linear control sizes.
    requestAnimationFrame(() => window.ApexUI?.decorate(document));
    if (typeof loaded !== 'undefined' && typeof drawAll === 'function') {
      if (loaded.length) drawAll();
      else if (typeof selected !== 'undefined' && selected.length && typeof renderMiniSectorMap === 'function') renderMiniSectorMap();
    }
    window.dispatchEvent(new CustomEvent('apex-skin', {detail: 'linear'}));
  }
  addEventListener('DOMContentLoaded', ready);
})();
