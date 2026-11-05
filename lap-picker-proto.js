/* PROTOTYPE, not for merging: three ways to choose laps, switchable on the page so they can be compared.
   current  the lap list scrolls inside the right pane (what ships today)
   compact  A: every lap of the stint is visible as a small tile grid, so nothing scrolls inside the pane
   sheet    B: the picker opens as a sheet over the page from the Comparison bar; the right pane shows Track & corners only
   Pick one with the control at the bottom left, or open /apex?laps=compact or /apex?laps=sheet. The choice is remembered in this browser. */
(() => {
  const KEY = 'apex-lap-picker', MODES = [['current', 'Current'], ['compact', 'A · Compact tiles'], ['sheet', 'B · Sheet']];
  const read = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
  const write = value => { try { localStorage.setItem(KEY, value); } catch { /* remembered for this page only */ } };
  const asked = new URLSearchParams(location.search).get('laps');
  if (MODES.some(([id]) => id === asked)) write(asked);
  const set = mode => {
    document.documentElement.dataset.lapPicker = mode;
    write(mode);
    const toggle = document.getElementById('lapWorkspaceToggle');
    if (toggle && typeof setLapSelectionExpanded === 'function') setLapSelectionExpanded(mode !== 'sheet');
    for (const button of document.querySelectorAll('#lapPickerProto button')) button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
  };
  const start = MODES.some(([id]) => id === read()) ? read() : 'current';
  document.documentElement.dataset.lapPicker = start;
  addEventListener('DOMContentLoaded', () => {
    const bar = document.createElement('div');
    bar.id = 'lapPickerProto';
    bar.setAttribute('role', 'group');
    bar.setAttribute('aria-label', 'Lap picker prototype');
    bar.innerHTML = '<span>Lap picker</span>' + MODES.map(([id, label]) => `<button type="button" data-mode="${id}" aria-pressed="${id === start}">${label}</button>`).join('');
    bar.addEventListener('click', event => { const button = event.target.closest('button[data-mode]'); if (button) set(button.dataset.mode); });
    document.body.append(bar);
  });
  // The sheet is shown in the browser's top layer (a manual popover), which sits above the page whatever clips or transforms the right
  // pane has; it follows the picker's own hidden state, so nothing else has to know about it.
  addEventListener('DOMContentLoaded', () => {
    const body = document.getElementById('lapSelectionBody');
    if (!body || !body.showPopover) return;
    // Only the sheet design is a popover: the attribute alone makes the browser lay the element over the page, so the other designs
    // must not carry it.
    const sync = () => {
      const sheet = document.documentElement.dataset.lapPicker === 'sheet';
      if (body.matches(':popover-open') && (!sheet || body.hidden)) body.hidePopover();
      if (sheet && !body.hasAttribute('popover')) body.setAttribute('popover', 'manual');
      if (!sheet && body.hasAttribute('popover')) body.removeAttribute('popover');
      if (sheet && !body.hidden && !body.matches(':popover-open')) body.showPopover();
    };
    new MutationObserver(sync).observe(body, {attributes: true, attributeFilter: ['hidden']});
    new MutationObserver(sync).observe(document.documentElement, {attributes: true, attributeFilter: ['data-lap-picker']});
    // Escape, or a click on the dimmed page behind the sheet, closes it.
    addEventListener('keydown', event => { if (event.key === 'Escape' && body.matches(':popover-open')) setLapSelectionExpanded(false, true); });
    // A popover's backdrop does not take clicks, so a click anywhere outside the sheet is caught here, closes it, and is not passed on to
    // whatever was behind (it would otherwise also select that driver or lap).
    addEventListener('click', event => {
      if (!body.matches(':popover-open') || event.target.closest('#lapSelectionBody, #lapWorkspaceToggle, #lapWorkspaceActions, #lapPickerProto, #loadedLaps, #clearComparison')) return;
      event.preventDefault(); event.stopPropagation();
      setLapSelectionExpanded(false, true);
    }, true);
    // With the picker in a sheet, the right pane's Laps tab would hold only a button, so the button and Compare fastest move into the
    // Comparison bar over the charts, and the right pane shows Track & corners alone. Switching back to another design puts them back.
    const toggle = document.getElementById('lapWorkspaceToggle'), actions = document.getElementById('lapWorkspaceActions');
    const tray = document.querySelector('.comparison-tray'), clear = document.getElementById('clearComparison');
    const homes = new Map([toggle, actions].filter(Boolean).map(node => { const mark = document.createComment(node.id); node.before(mark); return [node, mark]; }));
    const place = () => {
      const sheet = document.documentElement.dataset.lapPicker === 'sheet';
      if (sheet && tray) {
        const group = tray.querySelector('.comparison-picker') || Object.assign(document.createElement('div'), {className: 'comparison-picker'});
        group.append(...homes.keys());
        if (!group.isConnected) (clear || tray.lastElementChild).before(group);
        document.getElementById('inspectorTabTrack')?.click();
      } else {
        const moved = !!tray?.querySelector('.comparison-picker');
        for (const [node, mark] of homes) mark.after(node);
        tray?.querySelector('.comparison-picker')?.remove();
        if (moved) document.getElementById('inspectorTabLaps')?.click();
      }
    };
    new MutationObserver(place).observe(document.documentElement, {attributes: true, attributeFilter: ['data-lap-picker']});
    place();
    // In sheet mode the picker starts closed; its markup starts open for the in-pane designs.
    if (document.documentElement.dataset.lapPicker === 'sheet') setLapSelectionExpanded(false);
    sync();
  });
})();
