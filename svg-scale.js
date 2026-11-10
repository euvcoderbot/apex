/* Keeps text and lines in the hand-drawn SVG charts at their real size. These charts are drawn on a fixed canvas (viewBox) and
   stretched to their card, so on a wide card an 11 px label would render at 18 px and a 1.5 px line at 2.5 px. This measures
   each chart's stretch and stores it as --chart-scale; the CSS divides font sizes by it, and lines use non-scaling strokes.
   Charts drawn at their real width (session-overview.js) have a scale of 1 and are unaffected. */
(() => {
  const SELECTOR = 'svg.season-chart, svg.trade-off-plot, svg.overview-lap-chart';
  const sized = new WeakSet();
  const measure = svg => {
    const vb = svg.viewBox?.baseVal, w = svg.getBoundingClientRect().width;
    if (!vb?.width || !w) return;
    svg.style.setProperty('--chart-scale', String(Math.round(w / vb.width * 1000) / 1000));
  };
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(entries => requestAnimationFrame(() => entries.forEach(e => measure(e.target)))) : null;
  const scan = () => { for (const svg of document.querySelectorAll(SELECTOR)) if (!sized.has(svg)) { sized.add(svg); measure(svg); observer?.observe(svg); } };
  new MutationObserver(records => { if (records.some(r => r.addedNodes.length)) scan(); }).observe(document.documentElement, {childList: true, subtree: true});
  scan();
})();
