/* Presentation-only workspace. Original controls are reparented, never cloned:
   existing listeners, URL state and loaded data remain owned by the app. */
(() => {
  const root = document.documentElement;
  const anchors = new Map();
  let rail, dialog, search, results, returnFocus, lapHeader;
  const isLinear = () => root.dataset.skin === 'linear';
  const move = (node, destination) => {
    if (!node || !destination) return;
    if (!anchors.has(node)) {
      const anchor = document.createComment('linear workspace restore');
      node.before(anchor); anchors.set(node, anchor);
    }
    destination.append(node);
  };
  function commands() {
    return [
      {label: 'Session analysis', detail: 'Compare laps and telemetry', action: () => document.querySelector('[data-analysis-view="session"]')?.click()},
      {label: 'Car performance', detail: 'Explore team and driver measurements', action: () => document.querySelector('[data-analysis-view="performance"]')?.click()},
      {label: 'Choose comparison laps', detail: 'Session analysis', action: () => { document.querySelector('[data-analysis-view="session"]')?.click(); document.getElementById('lapWorkspaceToggle')?.click(); }},
      {label: 'Change appearance', detail: 'Switch light / dark', action: () => document.getElementById('themeToggle')?.click()},
      {label: 'Toggle explanations', detail: 'Show or hide measurement guidance', action: () => document.getElementById('explanationsToggle')?.click()},
      {label: 'Switch density', detail: 'Normal / compact', action: toggleDensity},
      ...[...document.querySelectorAll('#performanceCategoryList button:not(:disabled)')].map(button => ({label: button.getAttribute('aria-label') || button.textContent.trim(), detail: 'Car performance category', action: () => { document.querySelector('[data-analysis-view="performance"]')?.click(); button.click(); }})),
    ];
  }
  function renderCommands() {
    const query = search.value.toLowerCase().trim();
    results.replaceChildren();
    for (const command of commands().filter(item => (item.label + ' ' + item.detail).toLowerCase().includes(query))) {
      const button = document.createElement('button'); button.type = 'button';
      const label = document.createElement('span'); label.textContent = command.label;
      const detail = document.createElement('small'); detail.textContent = command.detail;
      button.append(label, detail);
      button.addEventListener('click', () => { dialog.close(); command.action(); });
      results.append(button);
    }
    if (!results.children.length) {
      const empty = document.createElement('p'); empty.textContent = 'No matching commands.'; results.append(empty);
    }
  }
  function openCommands(event) {
    if (!isLinear()) return;
    returnFocus = event?.currentTarget instanceof HTMLElement ? event.currentTarget : document.activeElement;
    search.value = ''; renderCommands(); dialog.showModal(); search.focus();
  }
  function toggleDensity() {
    const next = root.dataset.linearDensity === 'compact' ? 'normal' : 'compact';
    root.dataset.linearDensity = next;
    try { localStorage.setItem('apex-linear-density', next); } catch { /* page only */ }
    syncDensityButton();
    requestAnimationFrame(() => window.ApexUI?.decorate(document));
    window.dispatchEvent(new Event('resize'));
  }
  // Density is a toggle in the header, beside the appearance controls: pressed means compact.
  function syncDensityButton() {
    const button = document.getElementById('densityToggle'); if (!button) return;
    const compact = root.dataset.linearDensity === 'compact';
    button.setAttribute('aria-pressed', String(compact));
    button.setAttribute('aria-label', compact ? 'Use normal density' : 'Use compact density');
    button.title = compact ? 'Density: compact. Switch to normal' : 'Density: normal. Switch to compact';
  }
  function mountDensityButton() {
    const button = document.createElement('button');
    button.id = 'densityToggle'; button.type = 'button'; button.className = 'sidebar-toggle'; button.dataset.linearDensity = '';
    // Static authored markup: three tight rows, the compact list.
    button.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><path d="M3 4h10M3 8h10M3 12h10"/></svg>';
    button.addEventListener('click', toggleDensity);
    const theme = document.getElementById('themeToggle');
    if (theme) theme.after(button); else document.querySelector('.site-header .workspace-tools')?.append(button);
    syncDensityButton();
  }
  // A rail section: a heading button that folds its content, as Linear's "Workspace" and "Favorites" headings do.
  function section(id, label, content, extra = '') {
    return `<div class="linear-rail-section" data-section="${id}"><button type="button" class="linear-nav-heading linear-section-toggle ${extra}" aria-expanded="true" aria-controls="linearSection-${id}">${label}</button><div id="linearSection-${id}" class="linear-section-body">${content}</div></div>`;
  }
  function syncView() {
    if (!rail) return;
    const performance = document.querySelector('[data-analysis-view="performance"]')?.getAttribute('aria-selected') === 'true';
    rail.dataset.view = performance ? 'performance' : 'session';
  }
  function mount() {
    rail = document.createElement('aside'); rail.id = 'linearWorkspace'; rail.setAttribute('aria-label', 'Apex workspace'); rail.hidden = true;
    // Static authored markup only; labels from data always use textContent.
    // Linear's sidebar: a workspace row with a round search button, 28 px rows, and quiet section headings that fold their section.
    rail.innerHTML = '<div class="linear-workspace-top"><div class="linear-workspace-brand"><img src="assets/f1apex-icon-32.png" alt="" width="18" height="18"><strong>Apex Data</strong></div>'
      + '<button type="button" class="linear-search" aria-haspopup="dialog" aria-label="Search commands" title="Search commands · Ctrl K"><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3" stroke-linecap="round"/></svg></button></div>'
      + section('analysis', 'Analysis', '<div class="linear-navigation"></div>')
      + section('categories', 'Measurements', '<div class="linear-categories"></div>', 'linear-category-heading')
      + section('drivers', 'Drivers', '<div class="linear-drivers"></div>', 'linear-drivers-heading')
      ;
    rail.addEventListener('click', event => {
      const heading = event.target.closest('.linear-section-toggle'); if (!heading) return;
      const open = heading.getAttribute('aria-expanded') !== 'true';
      heading.setAttribute('aria-expanded', String(open));
      document.getElementById(heading.getAttribute('aria-controls')).hidden = !open;
    });
    document.querySelector('.site-header').before(rail);
    dialog = document.createElement('dialog'); dialog.id = 'linearCommandMenu'; dialog.setAttribute('aria-label', 'Search Apex commands');
    dialog.innerHTML = '<div class="linear-command-input"><label for="linearCommandSearch">Search commands</label><input id="linearCommandSearch" type="search" placeholder="What would you like to do?" autocomplete="off"><button type="button" aria-label="Close command search">Esc</button></div><div class="linear-command-results" aria-label="Commands"></div><div class="linear-command-footer">↑ ↓ navigate <span>Enter to open · Esc to close</span></div>';
    document.body.append(dialog);
    search = dialog.querySelector('input'); results = dialog.querySelector('.linear-command-results');
    rail.querySelector('.linear-search').addEventListener('click', openCommands);
    mountDensityButton();
    // The whole filter chip opens its menu ("Season 2026 ⌄"), not only the value part.
    document.addEventListener('click', event => {
      if (!isLinear()) return;
      const chip = event.target.closest?.('.app-sidebar .control-field');
      if (!chip || event.target.closest('.select-trigger, .select-menu, button, input, a')) return;
      const trigger = chip.querySelector('.select-trigger'); if (!trigger) return;
      event.preventDefault(); trigger.click(); trigger.focus({preventScroll: true});
    });
    dialog.querySelector('[aria-label="Close command search"]').addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => { if (returnFocus?.isConnected) returnFocus.focus(); });
    dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } });
    search.addEventListener('input', renderCommands);
    dialog.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); dialog.close(); return; }
      const buttons = [...results.querySelectorAll('button')];
      const index = buttons.indexOf(document.activeElement);
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const next = event.key === 'ArrowDown' ? (index + 1) % buttons.length : (index <= 0 ? buttons.length - 1 : index - 1);
        buttons[next]?.focus();
      } else if (event.key === 'Enter' && document.activeElement === search) { event.preventDefault(); buttons[0]?.click(); }
    });
    document.addEventListener('keydown', event => {
      if (isLinear() && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault(); if (dialog.open) dialog.close(); else openCommands();
      }
      // "[" folds the sidebar, as in Linear; never while typing or with a modifier held.
      const typing = event.target.closest?.('input, textarea, select, [contenteditable="true"]');
      if (isLinear() && event.key === '[' && !typing && !event.ctrlKey && !event.metaKey && !event.altKey && !dialog.open) {
        event.preventDefault(); document.getElementById('windowSidebarToggle')?.click();
      }
    });
    new MutationObserver(syncView).observe(document.querySelector('.performance-tabs'), {subtree: true, attributes: true, attributeFilter: ['aria-selected']});
    lapHeader = document.createElement('div'); lapHeader.className = 'linear-lap-header'; lapHeader.hidden = true;
    lapHeader.innerHTML = '<strong>Comparison laps</strong><div class="linear-lap-actions"></div><button type="button" aria-label="Close lap chooser">Done</button>';
    lapHeader.querySelector('button').addEventListener('click', () => document.getElementById('lapWorkspaceToggle')?.click());
    document.getElementById('lapSelectionBody').prepend(lapHeader);
    try { root.dataset.linearDensity = localStorage.getItem('apex-linear-density') === 'compact' ? 'compact' : 'normal'; } catch { root.dataset.linearDensity = 'normal'; }
    if (root.dataset.linearDensity === 'compact') { root.dataset.linearDensity = 'normal'; toggleDensity(); }
  }
  function reconcile() {
    if (!rail) return;
    const active = isLinear(); rail.hidden = !active; lapHeader.hidden = !active;
    const density = document.getElementById('densityToggle'); if (density) density.hidden = !active;
    if (active) {
      move(document.querySelector('.performance-tabs'), rail.querySelector('.linear-navigation'));
      move(document.getElementById('performanceCategoryList'), rail.querySelector('.linear-categories'));
      move(document.getElementById('lapWorkspaceActions'), lapHeader.querySelector('.linear-lap-actions'));
    } else {
      if (dialog.open) dialog.close();
      for (const [node, anchor] of anchors) anchor.after(node);
    }
    syncView(); requestAnimationFrame(() => window.ApexUI?.decorate(document));
    // The driver list's placement belongs to dashboard-ui.js (arrangeDriverRail); a resize makes it re-place the list now that the rail exists.
    window.dispatchEvent(new Event('resize'));
  }
  addEventListener('DOMContentLoaded', () => { mount(); reconcile(); });
  addEventListener('apex-skin', reconcile);
})();
