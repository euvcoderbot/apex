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
  // macOS window layout: a source-list sidebar beside the content whenever the
  // window is wide enough. The same driver node moves between the sidebar and
  // the lap chooser, so selection state and listeners survive.
  const driverRail=window.matchMedia('(min-width:980px)');
  function arrangeDriverRail(){
    const column=document.querySelector('#sessionSidebar'),body=document.querySelector('#lapSelectionBody'),sidebar=document.querySelector('#driverSidebar');
    if(!column||!body||!sidebar)return;
    const wide=driverRail.matches,host=wide?column:body;
    if(sidebar.parentElement!==host)wide?host.append(sidebar):host.prepend(sidebar);
    document.querySelector('.analysis-column')?.classList.toggle('has-driver-rail',wide);
    const chooser=document.querySelector('#lapWorkspaceToggle'),toggle=document.querySelector('#sidebarToggle');
    if(toggle)toggle.hidden=!wide&&chooser?.getAttribute('aria-expanded')==='false';
  }
  arrangeDriverRail();driverRail.addEventListener('change',arrangeDriverRail);
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
    const signature=tabs.map(tab=>tab.dataset.performanceMetric+(tab.disabled?'!':'')).join(',');
    if(categoryList.dataset.signature!==signature){
      categoryList.dataset.signature=signature;
      const rows=tabs.map(tab=>{
        const key=tab.dataset.performanceMetric,[,title,description]=metrics[key]||['',tab.textContent.trim(),''];
        const row=document.createElement('button');row.type='button';row.className='category-tab';row.dataset.sidebarMetric=key;row.setAttribute('aria-label',title);row.title=description;row.disabled=tab.disabled;
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
      if(row.dataset.sidebarMetric===active)row.setAttribute('aria-current','page');else row.removeAttribute('aria-current');
    }
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
    const next=event.key==='Home'?rows[0]:event.key==='End'?rows.at(-1):rows[Math.max(0,Math.min(rows.length-1,index+(['ArrowDown','ArrowRight'].includes(event.key)?1:-1)))];
    next?.focus();
  });
  if(performanceRoot&&typeof MutationObserver!=='undefined')new MutationObserver(syncCategoryList).observe(performanceRoot,{childList:true});
  const viewTitles={session:['Compare laps','Session analysis'],performance:['Compare performance','Car performance']};
  function setWindowTitle(view){
    const [title,subtitle]=viewTitles[view]||viewTitles.session;
    const titleEl=document.querySelector('#windowTitle'),subtitleEl=document.querySelector('#windowSubtitle');
    if(titleEl)titleEl.textContent=title;
    if(subtitleEl)subtitleEl.textContent=subtitle;
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
    for(const note of root.querySelectorAll('p.performance-quality-status:not(.explanation-only)')){
      if(note.closest('details,.performance-tyre-toolbar')||note.querySelector('button')||note.getAttribute('role')==='status')continue;
      const parent=note.parentElement;
      let evidence=parent.querySelector(':scope > .performance-status-evidence');
      if(!evidence){evidence=document.createElement('details');evidence.className='performance-evidence performance-status-evidence';const title=document.createElement('summary');title.textContent='Coverage and assumptions';evidence.append(title);parent.append(evidence);}
      evidence.append(note);
    }
  }
  document.querySelectorAll('[data-analysis-view]').forEach(button => button.addEventListener('click', () => {
    setWindowTitle(button.dataset.analysisView);
    document.querySelector('.skip-link')?.setAttribute('href', button.dataset.analysisView === 'performance' ? '#carPerformance' : '#top');
  }));
  window.ApexPresentation = Object.freeze({ metricHeading, arrangePerformance });
})();
