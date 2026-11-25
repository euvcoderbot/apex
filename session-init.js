/* Session analysis: page start-up (runs on DOMContentLoaded). */
// Initial Setup on Document Load
document.addEventListener('DOMContentLoaded', () => {
  const snapshotBadge=document.querySelector('#snapshotBadge');
  if(snapshotBadge)snapshotBadge.hidden=!(window.APEX_SNAPSHOT_MODE&&!window.APEX_LOCAL_MODE);
  function descriptions(value) {
    document.body.classList.toggle('is-descriptions-hidden',!value);
    const toggle=$('#explanationsToggle');toggle?.setAttribute('aria-pressed',String(value));
    if(toggle)toggle.querySelector('span').textContent=value?'Hide explanations':'Show explanations';
  }
  descriptions(window.ApexAnalysis?.preference('descriptions',false)===true);
  $('#explanationsToggle')?.addEventListener('click',()=>{
    const value=document.body.classList.contains('is-descriptions-hidden');
    window.ApexAnalysis?.savePreference('descriptions',value);descriptions(value);
    window.dispatchEvent(new CustomEvent('apex-descriptions',{detail:value}));
  });
  window.addEventListener('apex-descriptions',event=>descriptions(event.detail===true));
  const definitions=$('#performanceDefinitions');
  if(definitions&&window.ApexAnalysis)definitions.innerHTML=Object.values(window.ApexAnalysis.definitions).map(d=>`<dt>${d.title}</dt><dd>${d.description}</dd>`).join('');
  window.addEventListener('pointerup', finishZoomDrag);
  applyTheme(document.documentElement.dataset.theme, false);
  document.querySelectorAll('.select-shell select').forEach(enhanceSelect);
  window.addEventListener('resize', () => document.querySelectorAll('.select-shell.is-open').forEach(positionSelectMenu));
  window.addEventListener('scroll', event => {
    if (event.target.closest?.('.select-menu')) return;
    document.querySelectorAll('.select-shell.is-open').forEach(positionSelectMenu);
  }, true);
  document.addEventListener('click', event => {
    if (event.target.closest('.select-shell')) return;
    document.querySelectorAll('.select-shell.is-open').forEach(shell => {
      closeSelectMenu(shell);
    });
  });
  const yearSelect = $('#year');
  const currentYear = new Date().getFullYear();
  const years = [];
  for (let y = currentYear; y >= 2018; y--) {
    years.push(y);
  }
  populate(yearSelect, years);
  yearSelect.value = String(years[0]); // default to latest available season
  syncSelectUI(yearSelect);
  
  yearSelect.addEventListener('change', () => loadCalendar().catch(() => {}));
  $('#gp').addEventListener('change', populateSessions);
  $('#loadSession').onclick = loadRealSession;
  // The Load button names the session the menus point at when it differs from the one on screen (session-loader.js).
  for (const id of ['#year', '#gp', '#session']) $(id)?.addEventListener?.('change', () => setTimeout(markPendingSelection));
  
  const themeToggle = $('#themeToggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      applyTheme(lightThemeActive() ? 'dark' : 'light');
    });
  }

  $('#clearComparison')?.addEventListener('click', () => {
    loaded = [];
    renderAll();
    renderStints();
  });

  // The Display menu closes like any menu: on a click elsewhere or Escape.
  const closeDisplayMenu = target => {
    const menu = document.querySelector('.trace-display-menu[open]');
    if (menu && !menu.contains(target)) menu.open = false;
  };
  document.addEventListener('pointerdown', event => closeDisplayMenu(event.target));
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    const menu = document.querySelector('.trace-display-menu[open]');
    if (menu) { menu.open = false; menu.querySelector('summary')?.focus(); }
  });

  // The trailing inspector shows one pane at a time; the map cannot measure itself while hidden, so it draws on arrival.
  const inspector = $('#sessionInspector');
  const inspectorTabs = [...(inspector?.querySelectorAll('[data-inspector-tab]') || [])];
  const showInspectorPane = pane => {
    inspector.dataset.pane = pane;
    for (const tab of inspectorTabs) {
      const on = tab.dataset.inspectorTab === pane;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
    }
    if (pane === 'track') renderMiniSectorMap();
  };
  inspector?.querySelector('.inspector-tabs')?.addEventListener('click', event => {
    const tab = event.target.closest('[data-inspector-tab]');
    if (tab) showInspectorPane(tab.dataset.inspectorTab);
  });
  inspector?.querySelector('.inspector-tabs')?.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const next = inspectorTabs[(inspectorTabs.indexOf(document.activeElement) + 1) % inspectorTabs.length];
    showInspectorPane(next.dataset.inspectorTab);
    next.focus();
  });

  const cornerAnalysisToggle = $('#cornerAnalysisToggle');
  $('#lapWorkspaceToggle')?.addEventListener('click', event => {
    setLapSelectionExpanded(event.currentTarget.getAttribute('aria-expanded') !== 'true');
  });
  const cornerAnalysis = $('#cornerAnalysis');
  if (cornerAnalysisToggle && cornerAnalysis) {
    cornerAnalysisToggle.addEventListener('click', () => {
      const collapsed = cornerAnalysis.classList.toggle('is-collapsed');
      $('#cornerWorkspace').inert = collapsed;
      cornerAnalysisToggle.setAttribute('aria-expanded', String(!collapsed));
    });
    cornerAnalysis.addEventListener('transitionend', event => {
      if (event.propertyName === 'grid-template-rows' && !cornerAnalysis.classList.contains('is-collapsed')) renderMiniSectorMap();
    });
  }
  
  window.addEventListener('resize', scheduleDrawAll, { passive: true });
  if (typeof ResizeObserver !== 'undefined') {
    let mapSize = '';
    new ResizeObserver(entries => {
      const rect = entries[0]?.contentRect;
      const size = rect ? `${Math.round(rect.width)}:${Math.round(rect.height)}` : '';
      if (rect?.width && rect?.height && size !== mapSize) {
        mapSize = size;
        requestAnimationFrame(() => { if (loaded.length || selected.length) renderMiniSectorMap(); });
      }
    }).observe($('#dominanceCanvas'));
  }
  
  clearBeforeSessionLoad();
  renderCharts();
  bindTrackMapHover();
  document.querySelectorAll('[data-map-view]').forEach(button => button.addEventListener('click', () => {
    mapView = button.dataset.mapView;
    $('#realTooltip').style.display = 'none';
    renderMiniSectorMap();
  }));
  
  calendarReady = loadCalendar();
  // Which sessions are published labels Session analysis's menus. Opening on that view, check now; on Home, Season or Car
  // performance it waits until the browser is idle, so its indexes do not compete with the page's own data.
  if (window.ApexUrl?.read()?.view === 'session') loadPublishedSessions();
  else (window.requestIdleCallback || (fn => setTimeout(fn, 3000)))(() => loadPublishedSessions(), {timeout: 8000});
  document.addEventListener('visibilitychange', () => {
    if(document.visibilityState==='visible' && window.APEX_SNAPSHOT_MODE && Date.now()-snapshotCheckedAt>=60000){
      invalidateSnapshotData();
      void loadPublishedSessions();
    }
  });
  if(window.APEX_SNAPSHOT_MODE)window.setInterval(() => {
    if(document.visibilityState==='visible')void loadPublishedSessions();
  },60000);
  calendarReady.catch(error => {
    console.warn(error);
  });
  const initial = window.ApexUrl?.read();
  if (initial?.view === 'session' && initial.params.round) void applySessionUrl(initial.params);
  // On the published site the latest race is saved already: Session analysis opens on it rather than on an empty page asking
  // for Load session. Only when that view is actually opened (never in the background on Home or Season) and nothing is loaded.
  const published = () => Boolean(window.APEX_SNAPSHOT_MODE) && !window.APEX_LOCAL_MODE && !window.APEX_COMPUTE_ORIGIN;
  let autoLoaded = false, autoInFlight = false, autoReplaced = false;
  const autoLoad = () => {
    if (autoLoaded || !published() || sessionEventName) return;
    autoLoaded = true;
    // Only a session the published list has: an unpublished one would end in an error the person never asked for.
    void Promise.all([calendarReady, loadPublishedSessions()]).then(() => {
      if (sessionEventName || document.body.classList.contains('season-view') || document.body.classList.contains('performance-view')) return;
      const option = $('#session')?.selectedOptions?.[0];
      if (!publishedSessions || !option || option.disabled || /not published/i.test(option.textContent)) return;
      autoInFlight = true;
      return Promise.resolve(loadRealSession()).finally(() => { autoInFlight = false; }).then(() => {
        // A comparison on screen at once: the two leading finishers' fastest laps (the person changes or clears them).
        if (autoReplaced || !sessionEventName || loaded.length || document.body.classList.contains('season-view') || document.body.classList.contains('performance-view')) return;
        const leaders = [...realDrivers.values()].filter(d => Number.isFinite(d.position)).sort((x, y) => x.position - y.position).slice(0, 2);
        for (const d of leaders) {
          const best = (d.laps || []).filter(l => Number.isFinite(l.time) && !l.in_lap && !l.out_lap).sort((x, y) => x.time - y.time)[0];
          if (!best) continue;
          if (!selected.includes(d.code)) selected.push(d.code);
          toggleLoadedLap(d.code, best.lap);
        }
        if (loaded.length) { renderDrivers(); window.ApexUrl?.write('session', sessionUrlState(), {replace: true}); }   // replace: Back still leaves the page
      });
    }).catch(() => { autoLoaded = false; });
  };
  // Load pressed while the automatic load runs: it replaces that load (the session the menus now name), not stops it.
  document.addEventListener('click', event => {
    const button = event.target.closest?.('#loadSession');
    if (!button || !autoInFlight) return;
    event.stopImmediatePropagation(); event.preventDefault();
    autoInFlight = false; autoReplaced = true; sessionRequest?.abort();
    const started = Date.now();
    const again = () => (button.classList.contains('is-loading') && Date.now() - started < 8000 ? setTimeout(again, 50) : loadRealSession());
    again();
  }, true);
  if (initial?.view === 'session' && !initial.params.round) autoLoad();
  document.addEventListener('click', event => { if (event.target.closest?.('[data-analysis-view="session"]')) setTimeout(autoLoad, 0); }, true);
});
