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
      {label: 'Switch density', detail: 'Compact / comfortable', action: toggleDensity},
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
    const next = root.dataset.linearDensity === 'compact' ? 'comfortable' : 'compact';
    root.dataset.linearDensity = next;
    try { localStorage.setItem('apex-linear-density', next); } catch { /* page only */ }
    const button = rail.querySelector('[data-linear-density]');
    button.textContent = next === 'compact' ? 'Comfortable spacing' : 'Compact spacing';
    button.setAttribute('aria-pressed', String(next === 'compact'));
    requestAnimationFrame(() => window.ApexUI?.decorate(document));
    window.dispatchEvent(new Event('resize'));
  }
  function syncView() {
    if (!rail) return;
    const performance = document.querySelector('[data-analysis-view="performance"]')?.getAttribute('aria-selected') === 'true';
    rail.dataset.view = performance ? 'performance' : 'session';
  }
  function mount() {
    rail = document.createElement('aside'); rail.id = 'linearWorkspace'; rail.setAttribute('aria-label', 'Apex workspace'); rail.hidden = true;
    // Static authored markup only; labels from data always use textContent.
    rail.innerHTML = '<div class="linear-workspace-brand"><img src="assets/f1apex-icon-32.png" alt="" width="22" height="22"><strong>Apex Data</strong><span>Workspace</span></div><button type="button" class="linear-search" aria-haspopup="dialog"><span>Search commands</span><kbd>Ctrl K</kbd></button><div class="linear-nav-heading">Analysis</div><div class="linear-navigation"></div><div class="linear-category-heading linear-nav-heading">Measurements</div><div class="linear-categories"></div><div class="linear-rail-footer"><span>Formula 1 · Analytics</span><button type="button" data-linear-density aria-pressed="false">Compact spacing</button></div>';
    document.querySelector('.site-header').before(rail);
    dialog = document.createElement('dialog'); dialog.id = 'linearCommandMenu'; dialog.setAttribute('aria-label', 'Search Apex commands');
    dialog.innerHTML = '<div class="linear-command-input"><label for="linearCommandSearch">Search commands</label><input id="linearCommandSearch" type="search" placeholder="What would you like to do?" autocomplete="off"><button type="button" aria-label="Close command search">Esc</button></div><div class="linear-command-results" aria-label="Commands"></div><div class="linear-command-footer">↑ ↓ navigate <span>Enter to open · Esc to close</span></div>';
    document.body.append(dialog);
    search = dialog.querySelector('input'); results = dialog.querySelector('.linear-command-results');
    rail.querySelector('.linear-search').addEventListener('click', openCommands);
    rail.querySelector('[data-linear-density]').addEventListener('click', toggleDensity);
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
    });
    new MutationObserver(syncView).observe(document.querySelector('.performance-tabs'), {subtree: true, attributes: true, attributeFilter: ['aria-selected']});
    lapHeader = document.createElement('div'); lapHeader.className = 'linear-lap-header'; lapHeader.hidden = true;
    lapHeader.innerHTML = '<strong>Comparison laps</strong><div class="linear-lap-actions"></div><button type="button" aria-label="Close lap chooser">Done</button>';
    lapHeader.querySelector('button').addEventListener('click', () => document.getElementById('lapWorkspaceToggle')?.click());
    document.getElementById('lapSelectionBody').prepend(lapHeader);
    try { root.dataset.linearDensity = localStorage.getItem('apex-linear-density') === 'compact' ? 'compact' : 'comfortable'; } catch { root.dataset.linearDensity = 'comfortable'; }
    if (root.dataset.linearDensity === 'compact') { root.dataset.linearDensity = 'comfortable'; toggleDensity(); }
  }
  function reconcile() {
    if (!rail) return;
    const active = isLinear(); rail.hidden = !active; lapHeader.hidden = !active;
    if (active) {
      move(document.querySelector('.performance-tabs'), rail.querySelector('.linear-navigation'));
      move(document.getElementById('performanceCategoryList'), rail.querySelector('.linear-categories'));
      move(document.getElementById('lapWorkspaceActions'), lapHeader.querySelector('.linear-lap-actions'));
    } else {
      if (dialog.open) dialog.close();
      for (const [node, anchor] of anchors) anchor.after(node);
    }
    syncView(); requestAnimationFrame(() => window.ApexUI?.decorate(document));
  }
  addEventListener('DOMContentLoaded', () => { mount(); reconcile(); });
  addEventListener('apex-skin', reconcile);
})();
