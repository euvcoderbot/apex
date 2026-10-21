/* Session analysis: page start-up (runs on DOMContentLoaded). */
// Initial Setup on Document Load
document.addEventListener('DOMContentLoaded', () => {
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
  
  const themeToggle = $('#themeToggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      applyTheme(lightThemeActive() ? 'dark' : 'light');
    });
  }

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
  calendarReady.catch(error => {
    console.warn(error);
  });
  const initial = window.ApexUrl?.read();
  if (initial?.view === 'session' && initial.params.round) void applySessionUrl(initial.params);
});
