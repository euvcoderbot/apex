/* Presentation only: never changes observations, scores, ordering or eligibility. */
(() => {
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
    return `<header class="metric-heading"><div class="metric-heading-copy"><h2>${title}</h2><p class="explanation-only">${description}</p></div><dl class="metric-context"><div><dt>Season</dt><dd>${escape(context.year || '—')}</dd></div><div><dt>Loaded GPs</dt><dd>${Number(context.events) || 0}</dd></div><div><dt>View</dt><dd>${subject}</dd></div></dl></header>`;
  }
  function arrangePerformance(root, metric) {
    if (!root) return;
    root.dataset.presentation = metric;
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
    }
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
  function setTrackTrayExpanded(expanded) {
    const button = document.getElementById('performanceToggleTracks');
    const pills = document.getElementById('performanceTrackPills');
    if (!button || !pills) return;
    button.setAttribute('aria-expanded', String(expanded));
    pills.hidden = !expanded;
  }
  document.getElementById('performanceToggleTracks')?.addEventListener('click', event => {
    setTrackTrayExpanded(event.currentTarget.getAttribute('aria-expanded') !== 'true');
  });
  document.getElementById('performanceLoad')?.addEventListener('click', () => setTrackTrayExpanded(false));
  document.querySelectorAll('[data-performance-scope="tracks"]').forEach(button => button.addEventListener('click', () => setTrackTrayExpanded(true)));
  document.querySelectorAll('[data-analysis-view]').forEach(button => button.addEventListener('click', () => {
    document.querySelector('.skip-link')?.setAttribute('href', button.dataset.analysisView === 'performance' ? '#carPerformance' : '#top');
  }));
  window.ApexPresentation = Object.freeze({ metricHeading, arrangePerformance, setTrackTrayExpanded });
})();
