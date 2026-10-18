/* Presentation only: never changes observations, scores, ordering or eligibility. */
(() => {
  const workspaceTools = document.querySelector('.workspace-tools');
  if(window.APEX_LOCAL_MODE){
    const localLink=document.querySelector('.local-compute-link');
    if(localLink){const status=document.createElement('span');status.className='local-compute-status';status.textContent='Local compute · disk cache';status.title='Parsing and calculations run on this PC. Vercel is not used.';localLink.replaceWith(status);}
  }
  const metrics = {
    pace: ['01', 'Pace', 'One-lap speed & sustained race pace'],
    corners: ['02', 'Cornering', 'Performance through the same measured turns'],
    straight: ['03', 'Straight line', 'Settled speed, top speed & acceleration'],
    braking: ['04', 'Braking', 'Two views of the same qualifying-lap observations'],
    pits: ['05', 'Pit stops', 'Service speed, pit-lane time & consistency'],
    tyres: ['06', 'Tyre trend', 'How performance changes with tyre age'],
    trend: ['07', 'Development & updates', 'Relative progress across observed rounds'],
    results: ['08', 'Reliability & results', 'Race outcomes, finishes & retirement causes']
  };
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  // The driver rail uses real spare desktop width, never a fixed-height scroller.
  // Move the same node back into the chooser on compact windows; state survives.
  const driverRail=window.matchMedia('(min-width:1440px)');
  function arrangeDriverRail(){
    const column=document.querySelector('.analysis-column'),body=document.querySelector('#lapSelectionBody'),sidebar=document.querySelector('#driverSidebar');
    if(!column||!body||!sidebar)return;
    const wide=driverRail.matches,host=wide?column:body;
    if(sidebar.parentElement!==host)host.prepend(sidebar);
    column.classList.toggle('has-driver-rail',wide);
    const chooser=document.querySelector('#lapWorkspaceToggle'),toggle=document.querySelector('#sidebarToggle');
    if(toggle)toggle.hidden=!wide&&chooser?.getAttribute('aria-expanded')==='false';
  }
  arrangeDriverRail();driverRail.addEventListener('change',arrangeDriverRail);
  function metricHeading(metric, context = {}) {
    const [number, title, description] = metrics[metric] || ['', 'Performance', ''];
    const subject = ['corners','straight','braking'].includes(metric) ? `${context.subject === 'driver' ? 'Drivers' : 'Teams'}${metric === 'corners' ? ` · ${context.session === 'race' ? 'Race' : 'Qualifying'}` : ''}` : 'Selected events';
    return `<header class="metric-heading" aria-label="${escape(context.year || '—')} · ${subject}"><div class="metric-heading-copy"><h2>${title}</h2><p class="explanation-only">${description}</p></div><div class="metric-heading-controls"></div><span class="metric-load-count">${Number(context.events) || 0} loaded GP${Number(context.events) === 1 ? '' : 's'}</span></header>`;
  }
  function arrangePerformance(root, metric) {
    if (!root) return;
    root.dataset.presentation = metric;
    const panel = root.querySelector('#performanceMetricPanel');
    const controls = panel?.querySelector(':scope > .performance-actions');
    const headingControls = panel?.querySelector('.metric-heading-controls');
    if (controls && headingControls) headingControls.append(controls);
    for (const body of root.querySelectorAll('.performance-card-body')) {
      const children = [...body.children];
      const charts = children.filter(el => el.matches('.performance-chart-card:not(.performance-tyre-stint-plot)'));
      const table = children.find(el => el.matches('.performance-table-wrap'));
      if (charts.length > 1) {
        const grid = document.createElement('div');
        grid.className = 'performance-visual-grid';
        body.insertBefore(grid, charts[0]);
        for (const chart of charts) {
          const cell = document.createElement('section');
          cell.className = 'performance-visual-cell';
          cell.append(chart);
          grid.append(cell);
        }
      } else if (charts.length === 1 && table) {
        const split = document.createElement('div');
        split.className = 'performance-split-view';
        body.insertBefore(split, charts[0]);
        split.append(charts[0], table);
      } else if (charts.length === 1) {
        charts[0].classList.add('is-standalone-chart');
      }
      const placeControls = (control, chart) => {
        if (control && chart) chart.querySelector('.perf-chart-header')?.after(control);
      };
      if (metric === 'pace') placeControls(body.querySelector('.performance-metric-toolbar'), body.querySelector('.performance-chart-card'));
      if (metric === 'pace') placeControls(body.querySelector('.performance-stat-toggle'), [...body.querySelectorAll('.pace-visual-grid .performance-chart-card')].at(-1));
      if (metric === 'straight') placeControls(body.querySelector('.straight-summary-controls'), body.querySelector('.performance-chart-card'));
      if (metric === 'straight') placeControls(body.querySelector('.performance-range-control'), [...body.querySelectorAll('.performance-chart-card')].at(-1));
      const runControls = body.querySelector('.performance-tyre-plot-controls');
      if (runControls && !runControls.closest('.performance-run-inspector')) {
        const runNote = runControls.nextElementSibling;
        const inspector = document.createElement('details'), summary = document.createElement('summary');
        inspector.className = 'performance-run-inspector'; summary.textContent = 'Inspect a tyre run';
        runControls.before(inspector); inspector.append(summary, runControls);
        if (runNote?.matches('p.performance-note')) inspector.append(runNote);
        const plot = body.querySelector('.performance-tyre-stint-plot');
        if (plot) inspector.append(plot);
      }
    }
    if (['straight','braking','pits'].includes(metric)) root.querySelector('#performanceMetricPanel > .performance-card > .panel-heading')?.classList.add('visually-hidden');
    for (const wrap of root.querySelectorAll('.performance-table-wrap')) {
      const table = wrap.querySelector('table');
      if (!table) continue;
      const title = wrap.closest('.performance-card')?.querySelector('.panel-heading h2')?.textContent || 'Measurement evidence';
      if (!table.querySelector('caption')) {
        const caption = table.createCaption();
        caption.className = 'visually-hidden';
        caption.textContent = title;
      }
    }
    for(const grid of root.querySelectorAll('.performance-visual-grid')){
      for(const chart of grid.querySelectorAll('.performance-chart-card')){
        if(chart.querySelector('.performance-chart-controls'))continue;
        const slot=document.createElement('div');slot.className='performance-chart-controls';
        chart.querySelector('.perf-chart-header')?.after(slot);
        for(const control of chart.querySelectorAll(':scope > .performance-metric-toolbar,:scope > .performance-stat-toggle,:scope > .straight-summary-controls,:scope > .performance-range-control'))slot.append(control);
        if(!slot.childElementCount)slot.setAttribute('aria-hidden','true');
      }
    }
    for(const note of root.querySelectorAll('p.performance-quality-status:not(.explanation-only)')){
      if(note.closest('details,.performance-tyre-toolbar')||note.querySelector('button')||note.getAttribute('role')==='status')continue;
      const parent=note.parentElement;
      let evidence=parent.querySelector(':scope > .performance-status-evidence');
      if(!evidence){evidence=document.createElement('details');evidence.className='performance-evidence performance-status-evidence';const title=document.createElement('summary');title.textContent='Coverage and assumptions';evidence.append(title);parent.append(evidence);}
      evidence.append(note);
    }
  }
  document.querySelectorAll('[data-analysis-view]').forEach(button => button.addEventListener('click', () => {
    document.querySelector(button.dataset.analysisView === 'performance' ? '.performance-intro' : '.session-intro')?.append(workspaceTools);
    document.querySelector('.skip-link')?.setAttribute('href', button.dataset.analysisView === 'performance' ? '#carPerformance' : '#top');
  }));
  window.ApexPresentation = Object.freeze({ metricHeading, arrangePerformance });
})();
