/* Linear-style motion: navigation switches, modal bounce, and warm sibling tooltips;
   never runs on progressive data refreshes and cancels cleanly under reduced motion. */
(() => {
  const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const supported = () => typeof document.startViewTransition === 'function' && !document.hidden && !reduced();

  // Run a synchronous DOM update inside a view transition. Callers that need
  // the new DOM immediately (keyboard focus moves) must call update directly.
  let active = null;
  let warmTooltipUntil = 0;
  const animations = new Set();
  function transition(update) {
    active?.skipTransition?.();
    if (!supported()) { update(); return; }
    let ran = false;
    const once = () => { if (ran) return; ran = true; update(); };
    try {
      const current = document.startViewTransition(once); active = current;
      current?.finished?.catch(() => {}).finally(() => { if (active === current) active = null; });
      current?.updateCallbackDone?.catch(() => {});
    }
    catch (error) { if (!ran) once(); else throw error; }
  }

  // Clear the view/category entry marker after Linear's 180 ms collapsible ease.
  function enter(element) {
    if (!element || reduced()) return;
    clearTimeout(element.apexMotionTimer);
    element.dataset.motion = 'enter';
    element.apexMotionTimer = setTimeout(() => { delete element.apexMotionTimer; delete element.dataset.motion; }, 220);
  }

  // Subtle scale pulse feedback on dialog confirm or invalid submit (Linear's 150 ms bounce).
  function bounce(element) {
    if (!element || reduced()) return;
    clearTimeout(element.apexBounceTimer);
    element.dataset.bounce = 'true';
    element.apexBounceTimer = setTimeout(() => { delete element.dataset.bounce; }, 160);
  }

  // Instant warm chaining across sibling tooltips: skips 120 ms entrance while scanning.
  function warmTooltip(element, stayWarmMs = 350) {
    if (!element) return;
    const now = Date.now();
    element.toggleAttribute('data-instant', now < warmTooltipUntil || reduced());
    warmTooltipUntil = now + stayWarmMs;
  }

  function track(animation) {
    if (!animation) return animation;
    if (reduced()) { animation.cancel(); return animation; }
    animations.add(animation);animation.finished?.catch(() => {}).finally(() => animations.delete(animation));
    return animation;
  }
  // Start an element animation that a newer one can interrupt: the previous animation on the same element and key is cancelled
  // first, so quick repeated changes never stack two transforms on one node. Callers measure the element's rect (which includes
  // the running transform) before calling, so the new animation begins from where the old one visibly was.
  const running = new WeakMap();
  function animate(element, keyframes, options, key = 'default') {
    if (!element?.animate) return null;
    const byKey = running.get(element) || new Map(); running.set(element, byKey);
    byKey.get(key)?.cancel();
    const animation = track(element.animate(keyframes, options));
    byKey.set(key, animation);
    animation?.finished?.catch(() => {}).finally(() => { if (byKey.get(key) === animation) byKey.delete(key); });
    return animation;
  }
  if (typeof matchMedia === 'function') matchMedia('(prefers-reduced-motion: reduce)').addEventListener?.('change',event => {
    if (!event.matches) return;
    active?.skipTransition?.();for (const animation of animations) animation.cancel();animations.clear();
  });
  window.ApexMotion = {transition, enter, bounce, warmTooltip, reduced, track, animate};
})();
