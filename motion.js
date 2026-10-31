/* Apple-style motion for navigation only (switching category or view), never
   for data refreshes: progressive loading re-renders the same panel many times
   and must stay still. Uses the View Transitions API where available and does
   nothing when the person asks for reduced motion. */
(() => {
  const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const supported = () => typeof document.startViewTransition === 'function' && !document.hidden && !reduced();

  // Run a synchronous DOM update inside a view transition. Callers that need
  // the new DOM immediately (keyboard focus moves) must call update directly.
  let active = null;
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

  // Clear the category-entry marker after its existing320ms animation.
  function enter(element) {
    if (!element || reduced()) return;
    clearTimeout(element.apexMotionTimer);
    element.dataset.motion = 'enter';
    element.apexMotionTimer = setTimeout(() => { delete element.dataset.motion; }, 400);
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
  window.ApexMotion = {transition, enter, reduced, track, animate};
})();
