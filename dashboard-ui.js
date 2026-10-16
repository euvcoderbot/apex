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
          // Keep the acceleration selector attached to its own chart, not its neighbours.
          const range = chart.previousElementSibling;
          if (range?.getAttribute('aria-label') === 'Acceleration speed range') {
            const hint = range.previousElementSibling;
            if (hint?.matches('.performance-band-hint')) cell.append(hint);
            cell.append(range);
          }
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
      if (wrap.querySelector('.measurement-table-heading')) continue;
      const label = document.createElement('div');
      label.className = 'measurement-table-heading';
      const count = table.querySelector('td.section-empty') ? 0 : table.tBodies[0]?.rows.length || 0;
      const sortable = !!table.querySelector('[data-performance-sort]');
      const labelText = document.createElement('span');
      labelText.textContent = `${count} ${count === 1 ? 'entry' : 'entries'}`;
      const hint = document.createElement('small');
      hint.className = 'explanation-only';
      hint.textContent = sortable ? 'Click headings to sort' : '';
      label.append(labelText, hint);
      wrap.prepend(label);
    }
  }
  document.querySelectorAll('[data-analysis-view]').forEach(button => button.addEventListener('click', () => {
    document.querySelector(button.dataset.analysisView === 'performance' ? '.performance-intro' : '.session-intro')?.append(workspaceTools);
    document.querySelector('.skip-link')?.setAttribute('href', button.dataset.analysisView === 'performance' ? '#carPerformance' : '#top');
  }));
  window.ApexPresentation = Object.freeze({ metricHeading, arrangePerformance });
})();
