/* The lap chooser is a sheet over the page, opened from Choose laps in the Comparison bar. It is shown in the browser's top layer (a manual
   popover), so nothing the panes clip or transform can cut it off. It follows the chooser's own hidden state (setLapSelectionExpanded), so the
   rest of the app does not need to know it is a sheet. Escape, or a click on the dimmed page, closes it; picking laps leaves it open. */
(() => {
  addEventListener('DOMContentLoaded', () => {
    const body = document.getElementById('lapSelectionBody');
    if (!body?.showPopover) return;
    const sync = () => {
      if (!body.hidden && !body.matches(':popover-open')) {
        body.showPopover();
        // The stint selectors' sliding highlight is measured from the chosen button; measure again once the sheet has its real layout,
        // or it stays where it was measured while the sheet was opening and is drawn over the first lap.
        requestAnimationFrame(() => window.ApexUI?.decorate(body));
      } else if (body.hidden && body.matches(':popover-open')) body.hidePopover();
    };
    new MutationObserver(sync).observe(body, {attributes: true, attributeFilter: ['hidden']});
    addEventListener('keydown', event => { if (event.key === 'Escape' && body.matches(':popover-open')) setLapSelectionExpanded(false, true); });
    // A popover's backdrop does not take clicks, so a click outside the sheet is caught here: it closes the sheet and is not passed on to
    // whatever was behind (it would otherwise also select that driver or lap).
    addEventListener('click', event => {
      if (!body.matches(':popover-open') || event.target.closest('#lapSelectionBody, #lapWorkspaceToggle, #loadedLaps, #clearComparison')) return;
      event.preventDefault(); event.stopPropagation();
      setLapSelectionExpanded(false, true);
    }, true);
    sync();
  });
})();
