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
        requestAnimationFrame(() => {
          if (body.hidden) return;
          body.scrollTop = 0;
          window.ApexUI?.decorate(body);
          const search = body.querySelector('#lapDriverSearch');
          const focus = search?.getClientRects().length && !matchMedia('(pointer: coarse)').matches
            ? search : body.querySelector('[data-lap-sheet-close]');
          focus?.focus({preventScroll: true});
        });
      } else if (body.hidden && body.matches(':popover-open')) {
        body.hidePopover();
        const search = document.getElementById('lapDriverSearch');
        if (search?.value) {
          search.value = '';
          search.dispatchEvent(new Event('input'));
        }
      }
    };
    new MutationObserver(sync).observe(body, {attributes: true, attributeFilter: ['hidden']});
    body.addEventListener('click', event => {
      const close = event.target.closest('[data-lap-sheet-close]');
      if (!close) return;
      setLapSelectionExpanded(false, true);
      if (close.hasAttribute('data-view-comparison')) requestAnimationFrame(() => {
        const reference = document.querySelector('#loadedLaps .loaded-lap-main[aria-pressed="true"]');
        reference?.focus({preventScroll: true});
        reference?.scrollIntoView({block: 'nearest'});
      });
    });
    addEventListener('keydown', event => {
      if (body.hidden || !body.matches(':popover-open')) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        setLapSelectionExpanded(false, true);
      }
      if (event.key !== 'Tab') return;
      const stops = [...body.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]')]
        .filter(node => node.tabIndex >= 0 && node.getClientRects().length && !node.closest('[inert]'));
      const first = stops[0], last = stops.at(-1), active = document.activeElement;
      if (!body.contains(active) || active === (event.shiftKey ? first : last)) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      }
    });
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
