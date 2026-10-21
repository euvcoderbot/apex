/* Apple-style motion for navigation only (switching category or view), never
   for data refreshes: progressive loading re-renders the same panel many times
   and must stay still. Uses the View Transitions API where available and does
   nothing when the person asks for reduced motion. */
(() => {
  const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const supported = () => typeof document.startViewTransition === 'function' && !document.hidden && !reduced();

  // Run a synchronous DOM update inside a view transition. Callers that need
  // the new DOM immediately (keyboard focus moves) must call update directly.
  function transition(update) {
    if (!supported()) { update(); return; }
    try { document.startViewTransition(() => { update(); }); }
    catch { update(); }
  }

  // Mark an element as just navigated to, so its charts grow in once.
  function enter(element) {
    if (!element || reduced()) return;
    clearTimeout(element.apexMotionTimer);
    element.dataset.motion = 'enter';
    element.apexMotionTimer = setTimeout(() => { delete element.dataset.motion; }, 700);
  }

  window.ApexMotion = {transition, enter, reduced};
})();
