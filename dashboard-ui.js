/* Presentation only: never changes observations, scores, ordering or eligibility. */
(() => {
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
  function syncPerformanceRows(root=document){
    for(const split of root.querySelectorAll('.performance-split-view')){
      if(split.classList.contains('is-independent-rows'))continue;
      const head=split.querySelector('.performance-table thead tr'),rows=[...split.querySelectorAll('.performance-table tbody tr')];
      if(!head||!rows.length)continue;
      // Measure intrinsic rows, not a previously applied minimum. Round upward:
      // offsetHeight rounds down fractional line boxes and accumulated drift.
      split.style.removeProperty('--split-row');
      const rowHeight=Math.ceil(Math.max(0,...rows.map(row=>row.getBoundingClientRect().height)));
      if(!rowHeight)continue;
      split.style.setProperty('--split-head',Math.ceil(head.getBoundingClientRect().height)+'px');
      split.style.setProperty('--split-row',rowHeight+'px');
      split.classList.add('is-row-synced');
    }
  }
  window.addEventListener?.('resize',()=>syncPerformanceRows());
  // macOS window layout: a source-list sidebar beside the content whenever the
  // window is wide enough. The same driver node moves between the sidebar and
  // the lap chooser, so selection state and listeners survive.
  // Breakpoints are authored at 100% and scaled with the page zoom (see UI_ZOOM).
  const driverRail=window.matchMedia(`(min-width:${Math.round(980*(window.APEX_UI_ZOOM||1))}px)`);
  function arrangeDriverRail(){
    const column=document.querySelector('#sessionSidebar'),body=document.querySelector('#lapSelectionBody'),sidebar=document.querySelector('#driverSidebar');
    if(!column||!body||!sidebar)return;
    const wide=driverRail.matches,host=wide?column:body;
    if(sidebar.parentElement!==host)wide?host.append(sidebar):host.prepend(sidebar);
    document.querySelector('.analysis-column')?.classList.toggle('has-driver-rail',wide);
  }
  arrangeDriverRail();driverRail.addEventListener('change',arrangeDriverRail);
  // Some hosts defer media-query change events; a resize re-check is cheap and idempotent.
  window.addEventListener?.('resize',arrangeDriverRail,{passive:true});
  // Window toolbar: hide/show the sidebar, mirroring the split-view sidebar item.
  const sidebarButton=document.querySelector('#windowSidebarToggle');
  function setSidebarVisible(visible,persist=true){
    document.body?.classList.toggle('is-sidebar-hidden',!visible);
    for(const aside of document.querySelectorAll('.app-sidebar'))aside.inert=!visible;
    if(sidebarButton){sidebarButton.setAttribute('aria-expanded',String(visible));const label=visible?'Hide sidebar':'Show sidebar';sidebarButton.setAttribute('aria-label',label);sidebarButton.title=label;}
    if(persist)window.ApexAnalysis?.savePreference?.('hideSidebar',!visible);
    if(typeof window.dispatchEvent==='function')window.dispatchEvent(new Event('resize'));
  }
  setSidebarVisible(window.ApexAnalysis?.preference?.('hideSidebar',false)!==true,false);
  sidebarButton?.addEventListener('click',()=>setSidebarVisible(document.body.classList.contains('is-sidebar-hidden')));
  // Appearance follows the system until the person chooses one explicitly.
  window.matchMedia('(prefers-color-scheme: light)').addEventListener?.('change',event=>{
    let stored=null;try{stored=localStorage.getItem('apex-theme');}catch(_){return;}
    if(stored)return;
    const isLight=document.documentElement.dataset.theme==='light';
    if(event.matches!==isLight){document.querySelector('#themeToggle')?.click();try{localStorage.removeItem('apex-theme');}catch(_){}}
  });
  // The category bar mirrors the in-panel tablist; activation is delegated to
  // the original control so car-performance.js keeps sole ownership of state.
  const categoryIcons={
    pace:'<circle cx="12" cy="13.5" r="7"/><path d="M12 13.5V9.5M10 3.5h4M18.2 7.3l1.3-1.3"/>',
    corners:'<path d="M5 20v-6a8 8 0 0 1 8-8h6"/><path d="m16 3 3 3-3 3"/>',
    straight:'<path d="M4 12h15"/><path d="m14 7 5 5-5 5"/><path d="M4 7h4M4 17h4"/>',
    braking:'<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 4v2M12 18v2M4 12h2M18 12h2"/>',
    pits:'<path d="M14.5 6.5a4 4 0 0 0-5.3 5.3L4 17l3 3 5.2-5.2a4 4 0 0 0 5.3-5.3l-2.6 2.6-2.4-.6-.6-2.4z"/>',
    tyres:'<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><path d="M12 3.5v4M12 16.5v4M3.5 12h4M16.5 12h4"/>',
    trend:'<path d="M4 19h16"/><path d="m5 15 4.5-4.5 3 3L19 7"/><path d="M15 7h4v4"/>',
    results:'<path d="M6 21V4"/><path d="M6 4h11l-2 4 2 4H6"/>'
  };
  const shortTitles={straight:'Straights',tyres:'Tyres',trend:'Development',results:'Reliability'};
  const categoryList=document.querySelector('#performanceCategoryList'),performanceRoot=document.querySelector('#performanceResults');
  function syncCategoryList(){
    if(!categoryList||!performanceRoot)return;
    const tabs=[...performanceRoot.querySelectorAll('.performance-mode [data-performance-metric]')];
    categoryList.hidden=!tabs.length;
    if(!tabs.length)return;
    categoryList.setAttribute('role','tablist');categoryList.setAttribute('aria-label','Performance category');
    const signature=tabs.map(tab=>tab.dataset.performanceMetric+(tab.disabled?'!':'')).join(',');
    if(categoryList.dataset.signature!==signature){
      categoryList.dataset.signature=signature;
      const rows=tabs.map(tab=>{
        const key=tab.dataset.performanceMetric,[,title,description]=metrics[key]||['',tab.textContent.trim(),''];
        const row=document.createElement('button');row.type='button';row.className='category-tab';row.dataset.sidebarMetric=key;row.setAttribute('aria-label',title);row.title=description;row.disabled=tab.disabled;
        row.id='category-tab-'+key;row.setAttribute('role','tab');row.setAttribute('aria-controls','performanceMetricPanel');
        row.insertAdjacentHTML('afterbegin',`<svg class="ui-symbol category-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${categoryIcons[key]||''}</svg>`);
        const label=document.createElement('span');label.className='category-label';label.textContent=title;
        const short=document.createElement('span');short.className='category-short';short.setAttribute('aria-hidden','true');short.textContent=shortTitles[key]||title;
        row.append(label,short);
        return row;
      });
      categoryList.replaceChildren(...rows);
    }
    const active=tabs.find(tab=>tab.getAttribute('aria-selected')==='true')?.dataset.performanceMetric;
    for(const row of categoryList.querySelectorAll('[data-sidebar-metric]')){
      const on=row.dataset.sidebarMetric===active;row.setAttribute('aria-selected',String(on));row.tabIndex=on?0:-1;
      if(on)row.setAttribute('aria-current','page');else row.removeAttribute('aria-current');
    }
    const panel=performanceRoot.querySelector('#performanceMetricPanel');if(panel&&active)panel.setAttribute('aria-labelledby','category-tab-'+active);
  }
  categoryList?.addEventListener('click',event=>{
    const row=event.target.closest('[data-sidebar-metric]');if(!row||row.disabled)return;
    performanceRoot?.querySelector(`.performance-mode [data-performance-metric="${CSS.escape(row.dataset.sidebarMetric)}"]`)?.click();
    syncCategoryList();
    if(!driverRail.matches)document.querySelector('#performanceMetricPanel')?.scrollIntoView({block:'start'});
  });
  categoryList?.addEventListener('keydown',event=>{
    if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key))return;
    const rows=[...categoryList.querySelectorAll('[data-sidebar-metric]:not(:disabled)')],index=rows.indexOf(document.activeElement);
    if(index<0)return;event.preventDefault();
    const next=event.key==='Home'?rows[0]:event.key==='End'?rows.at(-1):rows[(index+(['ArrowDown','ArrowRight'].includes(event.key)?1:-1)+rows.length)%rows.length];
    next?.focus();next?.click();
  });
  if(performanceRoot&&typeof MutationObserver!=='undefined')new MutationObserver(syncCategoryList).observe(performanceRoot,{childList:true});
  const viewTitles={session:['Compare laps','Session analysis'],performance:['Compare performance','Car performance']};
  function setWindowTitle(view){
    const [title,subtitle]=viewTitles[view]||viewTitles.session;
    const titleEl=document.querySelector('#windowTitle'),subtitleEl=document.querySelector('#windowSubtitle');
    if(titleEl)titleEl.textContent=title;
    if(subtitleEl)subtitleEl.textContent=window.APEX_SNAPSHOT_MODE&&!window.APEX_LOCAL_MODE?`${subtitle} · published snapshot (not live)`:subtitle;
    if(document.body)document.body.dataset.view=view;
  }
  setWindowTitle('session');
  function metricHeading(metric, context = {}) {
    const [number, title, description] = metrics[metric] || ['', 'Performance', ''];
    const subject = ['corners','straight','braking'].includes(metric) ? `${context.subject === 'driver' ? 'Drivers' : 'Teams'}${metric === 'corners' ? ` · ${context.session === 'race' ? 'Race' : 'Qualifying'}` : ''}` : 'Selected events';
    return `<header class="metric-heading" aria-label="${escape(context.year || '—')} · ${subject}"><div class="metric-heading-copy"><h2>${title}</h2><p class="explanation-only">${description}</p></div><div class="metric-heading-controls"></div><span class="metric-load-count">${Number(context.events) || 0} loaded GP${Number(context.events) === 1 ? '' : 's'}</span></header>`;
  }
  function arrangePerformance(root, metric) {
    if (!root) return;
    root.dataset.presentation = metric;
    const panel = root.querySelector('#performanceMetricPanel');
    const headingControls = panel?.querySelector('.metric-heading-controls');
    // Refresh is global to the loaded events; measurement filters stay in-card.
    const refresh = root.querySelector('[data-performance-refresh]');
    if (refresh && headingControls) {
      refresh.classList.add('metric-refresh');
      refresh.setAttribute('aria-label', window.APEX_SNAPSHOT_MODE&&!window.APEX_LOCAL_MODE?'Reload snapshot':'Refresh data');
      if (!refresh.querySelector('svg')) {
        const label = document.createElement('span');
        label.textContent = refresh.textContent;
        refresh.replaceChildren(label);
        refresh.insertAdjacentHTML('afterbegin', '<svg class="ui-symbol" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 8a8 8 0 1 0 1 7M19 3v5h-5"/></svg>');
      }
      headingControls.append(refresh);
    }
    // The page owns the section heading. Every primary card follows the same
    // pattern; only secondary cards and charts need their own visible titles.
    const primaryCard = panel?.querySelector('.performance-card');
    const titleKey = text => String(text || '').trim().toLowerCase().replace(/\s*&\s*/g, ' and ');
    const pageTitle = titleKey(panel?.querySelector('.metric-heading h2')?.textContent);
    for (const heading of root.querySelectorAll('.performance-card > .panel-heading')) {
      const redundant = heading.parentElement === primaryCard || (!!pageTitle && titleKey(heading.querySelector('h2')?.textContent) === pageTitle);
      heading.toggleAttribute('data-redundant', redundant);
    }
    // Shared subject/session controls live with the measurements they affect.
    const primaryBody = primaryCard?.querySelector(':scope > .performance-card-body');
    const sharedControls = [...(panel?.children || [])].filter(el => el.matches('.performance-actions,.performance-tyre-toolbar'));
    const sectionControls = [...(primaryBody?.children || [])].filter(el => !el.matches('.performance-stat-toggle') && el.matches('.performance-scope-toggle,.performance-pit-controls,.performance-results-measure,.performance-actions'));
    if (primaryBody && (sharedControls.length || sectionControls.length)) {
      const group = primaryBody.querySelector(':scope > .performance-card-controls') || document.createElement('div');
      group.className = 'performance-card-controls';
      for (const control of [...sharedControls, ...sectionControls]) {
        if (control.matches('.performance-actions,.performance-pit-controls,.performance-results-measure')) {
          group.append(...control.children); control.remove();
        } else group.append(control);
      }
      primaryBody.prepend(group);
    }
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
        split.className = 'performance-split-view' + (metric === 'tyres' ? ' is-independent-rows' : '');
        body.insertBefore(split, charts[0]);
        if(metric === 'tyres'){
          const evidence=document.createElement('details');evidence.className='performance-evidence';
          const summary=document.createElement('summary');summary.textContent='Tyre trend measurements';
          evidence.append(summary,table);split.append(charts[0],evidence);
        } else split.append(charts[0], table);
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
    for (const wrap of root.querySelectorAll('.performance-table-wrap')) {
      const table = wrap.querySelector('table');
      if (!table) continue;
      const title = wrap.closest('.performance-card')?.querySelector('.panel-heading h2')?.textContent || 'Measurement evidence';
      if (!table.querySelector('caption')) {
        const caption = table.createCaption();
        caption.className = 'visually-hidden';
        caption.textContent = title;
      }
      wrap.setAttribute('role','region');wrap.setAttribute('aria-label',table.querySelector('caption')?.textContent||title);
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
    // Many unavailable sessions read as one grouped notice, not a wall of alerts.
    const errors=panel?[...panel.querySelectorAll(':scope > .performance-error')]:[];
    if(errors.length>2){
      const group=document.createElement('details');group.className='performance-error-group';
      const title=document.createElement('summary'),dot=document.createElement('span'),text=document.createElement('span');dot.className='error-dot';dot.setAttribute('aria-hidden','true');text.textContent=`${errors.length} sessions are incomplete or unavailable`;title.append(dot,text);
      const list=document.createElement('ul');list.className='performance-error-list';
      errors[0].before(group);group.append(title,list);
      for(const error of errors){const item=document.createElement('li');item.textContent=error.textContent.trim();list.append(item);error.remove();}
    }
    syncCategoryList();
    // Paired chart + table: the chart copies the table's header and row heights
    // (measured after layout), so every bar sits level with its table row.
    if(root.querySelector('.performance-split-view')){
      const sync=()=>syncPerformanceRows(root);
      // rAF pauses in background tabs; the timer covers that case.
      if(typeof requestAnimationFrame==='function')requestAnimationFrame(sync);
      setTimeout(sync,60);
    }
    // A chart with no measured rows shows its reason inline as an empty state,
    // rather than an empty box beside full ones.
    for(const chart of root.querySelectorAll('.performance-chart-card')){
      const empty=!chart.querySelector('.performance-bar-row,.performance-tyre-age-row,tbody tr,svg,canvas');
      chart.classList.toggle('is-empty-chart',empty);
      if(empty)for(const note of chart.querySelectorAll('p.performance-quality-status'))note.classList.add('performance-empty-note');
    }
    // Every other coverage note goes into one disclosure per card, below its
    // charts, so a note in one chart no longer stretches its neighbours.
    for(const note of root.querySelectorAll('p.performance-quality-status:not(.explanation-only):not(.performance-empty-note)')){
      if(note.closest('details,.performance-tyre-toolbar')||note.querySelector('button')||note.getAttribute('role')==='status')continue;
      const parent=note.closest('.performance-card-body')||note.parentElement;
      let evidence=parent.querySelector(':scope > .performance-status-evidence');
      if(!evidence){evidence=document.createElement('details');evidence.className='performance-evidence performance-status-evidence';const title=document.createElement('summary');title.textContent='Coverage and assumptions';evidence.append(title);parent.append(evidence);}
      const chart=note.closest('.performance-chart-card');
      const label=chart?.querySelector('.perf-chart-title,.perf-chart-heading')?.textContent.trim();
      if(label&&!note.dataset.chart){note.dataset.chart=label;const tag=document.createElement('strong');tag.textContent=label+': ';note.prepend(tag);}
      evidence.append(note);
    }
  }
  document.querySelectorAll('[data-analysis-view]').forEach(button => button.addEventListener('click', () => {
    setWindowTitle(button.dataset.analysisView);
    document.querySelector('.skip-link')?.setAttribute('href', button.dataset.analysisView === 'performance' ? '#carPerformance' : '#top');
  }));
  window.ApexPresentation = Object.freeze({ metricHeading, arrangePerformance });
})();
