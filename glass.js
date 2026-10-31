/* Interactive glass (macOS 27): controls on the toolbar's glass answer the pointer with a soft highlight under it, and a
   small press response (the press itself is CSS). It only reports where the pointer is, as --glass-x and --glass-y on the
   control; hig-system.css draws it. Pointer devices only, and nothing runs for touch. A little goes a long way: the
   highlight is faint and appears on hover, not at rest. */
(() => {
  const SELECTOR = '.site-header .performance-tabs, .site-header button[data-ui-kind="toolbar"]:not(.local-compute-status), [data-glass]';
  const fine = typeof matchMedia === 'function' ? matchMedia('(hover: hover) and (pointer: fine)') : null;
  let target = null, point = null, frame = 0;

  function mark(root = document) {
    for (const element of root.querySelectorAll(SELECTOR)) if (!element.hasAttribute('data-glass')) element.setAttribute('data-glass', '');
  }
  function paint() {
    frame = 0;
    if (!target || !point) return;
    const box = target.getBoundingClientRect();
    target.style.setProperty('--glass-x', Math.round(point.x - box.left) + 'px');
    target.style.setProperty('--glass-y', Math.round(point.y - box.top) + 'px');
  }
  function release() {
    if (target) { target.style.removeProperty('--glass-x'); target.style.removeProperty('--glass-y'); }
    target = null; point = null;
  }

  document.addEventListener('pointermove', event => {
    if (!fine?.matches || event.pointerType === 'touch') return;
    const element = event.target.closest?.('[data-glass]') || null;
    if (element !== target) { release(); target = element; }
    if (!target) return;
    point = {x: event.clientX, y: event.clientY};
    if (!frame) frame = requestAnimationFrame(paint);
  }, {passive: true});
  document.documentElement.addEventListener('pointerleave', release);

  // The toolbar buttons get their data-ui-kind from ui-system.js, which loads after this file; mark again once it has run.
  mark();
  addEventListener('DOMContentLoaded', () => mark());
  addEventListener('load', () => mark());
  window.ApexGlass = {mark, selector: SELECTOR};
})();
