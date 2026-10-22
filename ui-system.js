/* Component ownership only. No telemetry, data loading or ranking code. */
(() => {
  const groups='.performance-tabs,.session-analysis-tabs,.performance-scope-toggle,.performance-band-options,.performance-tyre-options,.performance-range-options,.race-result-controls,.map-view-switch';
  const symbols={plus:'M12 5v14M5 12h14',minus:'M5 12h14',left:'m14 6-6 6 6 6',right:'m10 6 6 6-6 6',close:'m6 6 12 12M18 6 6 18',chart:'M4 4v16h16M7 15l4-5 4 2 5-7',expand:'M4 9V4h5m6 0h5v5M4 15v5h5m6 0h5v-5',reset:'M5 7a8 8 0 1 1-1 8M5 3v5h5'};
  const symbol=name=>`<svg class="ui-symbol" data-ui-symbol="${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${symbols[name]||symbols.chart}"/></svg>`;
  const columnWidths=new Map(); let tableId=0, columnDrag=null;
  function boundedColumnWidth(value){return Math.max(64,Math.min(1000,Math.round(value)));}
  function tableKey(table){return [...table.querySelectorAll('thead th')].map(th=>th.textContent.replace(/\s+/g,' ').trim()).join('|');}
  function applyColumnWidths(table,widths){
    let group=table.querySelector('colgroup[data-ui-columns]');
    if(!group){group=document.createElement('colgroup');group.dataset.uiColumns='true';table.prepend(group);}
    while(group.children.length<widths.length)group.append(document.createElement('col'));
    widths.forEach((width,index)=>group.children[index].style.width=width+'px');
    table.classList.add('ui-resized-table');table.style.width=widths.reduce((sum,value)=>sum+value,0)+'px';
    table.querySelectorAll('.ui-column-resizer').forEach((handle,index)=>{set(handle,'aria-valuenow',String(widths[index]));set(handle,'aria-valuetext',widths[index]+' pixels');});
  }
  function resizeColumn(handle,delta,reset=false){
    const table=handle.closest('table'),key=tableKey(table),index=Number(handle.dataset.uiColumn);
    let state=columnWidths.get(key);
    if(!state){const initial=[...table.querySelectorAll('thead th')].map(th=>boundedColumnWidth(th.getBoundingClientRect().width));state={defaults:[...initial],widths:initial};}
    state.widths[index]=reset?state.defaults[index]:boundedColumnWidth(state.widths[index]+delta);
    columnWidths.delete(key);columnWidths.set(key,state);
    if(columnWidths.size>50)columnWidths.delete(columnWidths.keys().next().value);
    applyColumnWidths(table,state.widths);
  }
  function decorateTables(root){
    for(const table of root.querySelectorAll('table.performance-table')){
      if(table.closest('details:not([open])'))continue;
      if(!table.id)table.id='ui-table-'+(++tableId);
      [...table.querySelectorAll('thead th')].forEach((th,index)=>{
        if(th.querySelector('.ui-column-resizer'))return;
        const label=th.textContent.replace(/\s+/g,' ').trim(),handle=document.createElement('span');
        handle.className='ui-column-resizer';handle.dataset.uiColumn=String(index);handle.dataset.uiKind='separator';handle.tabIndex=0;
        handle.setAttribute('role','separator');handle.setAttribute('aria-orientation','vertical');handle.setAttribute('aria-label','Resize '+label);
        handle.setAttribute('aria-controls',table.id);handle.setAttribute('aria-valuemin','64');handle.setAttribute('aria-valuemax','1000');
        handle.setAttribute('aria-valuenow',String(boundedColumnWidth(th.getBoundingClientRect().width)));
        handle.title='Drag to resize '+label+'. Arrow keys adjust width; double-click resets.';
        th.append(handle);
      });
      const state=columnWidths.get(tableKey(table));if(state)applyColumnWidths(table,state.widths);
    }
  }
  function familyFor(el){
    if(el.matches('[role="separator"]'))return 'separator';
    if(el.matches('input[type="checkbox"]'))return 'checkbox';
    if(el.matches('input[type="radio"]'))return 'radio';
    if(el.matches('input[type="color"]'))return 'colour';
    if(el.matches('input,select,textarea'))return 'field';
    if(el.matches('summary'))return 'disclosure';
    if(el.matches('.select-trigger'))return 'popup';
    if(el.matches('[role="option"]'))return 'menu-item';
    if(el.matches('#loadSession,#performanceLoad,[data-ui-primary]'))return 'primary';
    if(el.matches('.driver-pill'))return 'list-row';
    if(el.matches('.category-tab'))return 'tab';
    if(el.matches('.run-segment'))return 'run';
    if(el.matches('.lap-chip,.track-pill,.corner-pick,.fastest-lap-pick'))return 'choice';
    if(el.matches('.loaded-lap-main'))return 'reference';
    if(el.matches('.perf-sort-btn')||el.closest('.corner-table-head'))return 'sort';
    if(el.matches('#performanceToggleTracks'))return 'picker';
    if(el.matches('.workspace-disclosure,.corner-analysis-toggle'))return 'disclosure';
    if(el.matches('[data-performance-metric],[data-session-view]'))return 'tab';
    if(el.matches('[data-zoom],[data-pan],[data-delta-zoom]'))return 'stepper';
    if(el.matches('.remove,[data-remove],.map-guide-info'))return 'icon';
    if(el.closest(groups))return 'segment';
    if(el.closest('.workspace-tools')||el.matches('#windowSidebarToggle'))return 'toolbar';
    return 'push';
  }
  function set(el,key,value){if(el.getAttribute(key)!==value)el.setAttribute(key,value);}
  let fieldId=0;
  function upgradePopups(root){
    if(typeof window.enhanceSelect!=='function')return;
    for(const select of root.querySelectorAll('select:not(.native-select-proxy)')){
      if(!select.id)select.id='ui-field-'+(++fieldId);
      let shell=select.closest('.select-shell');
      if(!shell){shell=document.createElement('span');shell.className='select-shell';select.before(shell);shell.append(select);}
      const label=select.closest('label');
      let text;
      if(label){
        text=label.querySelector('.ui-field-label');
        if(!text){text=document.createElement('span');text.className='ui-field-label';text.id=select.id+'Label';
          const nodes=[...label.childNodes].filter(node=>node.nodeType===3);
          text.textContent=nodes.map(node=>node.textContent.trim()).filter(Boolean).join(' ');
          for(const node of nodes)node.remove();label.prepend(text);}
      }
      const focused=select===document.activeElement;
      window.enhanceSelect(select);
      const trigger=shell.querySelector('.select-trigger'),menu=shell.querySelector('.select-menu');
      if(text&&trigger){trigger.setAttribute('aria-labelledby',text.id);menu?.setAttribute('aria-labelledby',text.id);}
      else if(select.getAttribute('aria-label')&&trigger){trigger.setAttribute('aria-label',select.getAttribute('aria-label'));menu?.setAttribute('aria-label',select.getAttribute('aria-label'));}
      if(focused)trigger?.focus({preventScroll:true});
    }
  }
  function decorate(root=document){
    upgradePopups(root);
    decorateTables(root);
    for(const el of root.querySelectorAll('button,input:not([type="hidden"]),select,textarea,summary,[role="separator"]')){
      set(el,'data-ui-kind',familyFor(el));
      if(el.matches('button')&&!el.getAttribute('type'))el.type='button';
      if(el.matches('.driver-pill,.lap-chip,.run-segment'))set(el,'aria-pressed',String(el.classList.contains('selected')));
      let name=el.matches('[data-pan="left"]')?'left':el.matches('[data-pan="right"]')?'right':el.matches('[data-zoom="in"],[data-delta-zoom="in"]')?'plus':el.matches('[data-zoom="out"],[data-delta-zoom="out"]')?'minus':el.matches('[data-remove],.remove')?'close':null;
      if(name&&!el.querySelector('[data-ui-symbol]'))el.innerHTML=symbol(name);
      if(el.matches('button')&&(!el.hasAttribute('title')||el.dataset.uiTooltip==='auto')){
        const label=el.getAttribute('aria-label')||el.textContent.trim();
        if(label){el.title=label;el.dataset.uiTooltip='auto';}
      }
    }
    for(const group of root.querySelectorAll(groups)){
      set(group,'data-ui-group','segments');
      // Segmented toggle buttons expose pressed states, not incomplete radio semantics.
      if(group.getAttribute('role')==='radiogroup')group.setAttribute('role','group');
    }
    for(const el of root.querySelectorAll('.perf-tercile-badge,.track-count-badge,.performance-coverage-badge,.performance-quality-badge,.retirement-badge,.tow-badge')){
      set(el,'data-ui-kind','badge');
      el.style.removeProperty('font-size');el.style.removeProperty('border-radius');
    }
    for(const el of root.querySelectorAll('.empty-icon-badge'))if(!el.querySelector('[data-ui-symbol]'))el.innerHTML=symbol('chart');
    placeThumbs(root);
  }
  // Segmented controls: one thumb per group that slides to the chosen segment
  // (HIG Segmented controls). Its geometry lives in --ui-thumb-* on the group;
  // the group's ::before draws it, so re-renders never recreate it.
  const thumbGroups='[data-ui-group="segments"],.run-segments,.category-bar';
  const chosen='button[aria-pressed="true"],button[aria-current="page"]';
  function placeThumb(group){
    const button=group.querySelector(':scope > :is('+chosen+')');
    if(!button||!button.offsetWidth){group.removeAttribute('data-ui-thumb');return;}
    const next=[button.offsetLeft,button.offsetTop,button.offsetWidth,button.offsetHeight].map(v=>v+'px');
    const props=['--ui-thumb-x','--ui-thumb-y','--ui-thumb-w','--ui-thumb-h'];
    if(props.every((prop,index)=>group.style.getPropertyValue(prop)===next[index])&&group.dataset.uiThumb)return;
    props.forEach((prop,index)=>group.style.setProperty(prop,next[index]));
    // The first placement appears in place; later ones slide.
    if(!group.dataset.uiThumb){group.dataset.uiThumb='placed';requestAnimationFrame(()=>requestAnimationFrame(()=>{if(group.dataset.uiThumb)group.dataset.uiThumb='sliding';}));}
  }
  const thumbObserver=typeof ResizeObserver!=='undefined'?new ResizeObserver(entries=>entries.forEach(entry=>placeThumb(entry.target.closest?.(thumbGroups)||entry.target))):null;
  function placeThumbs(root=document){
    for(const group of root.querySelectorAll(thumbGroups)){
      placeThumb(group);
      if(thumbObserver&&!group.dataset.uiThumbObserved){group.dataset.uiThumbObserved='true';thumbObserver.observe(group);}
    }
  }
  function audit(root=document){
    const counts={},unowned=[];
    for(const el of root.querySelectorAll('button,input:not([type="hidden"]),select,textarea,summary,[role="separator"]')){
      const kind=el.dataset.uiKind;
      if(!kind)unowned.push(el.tagName+' '+(el.id||el.className));
      else counts[kind]=(counts[kind]||0)+1;
    }
    return {version:'macos-components-v1',counts,unowned};
  }
  decorate();
  let pending=false;
  if(typeof MutationObserver!=='undefined')new MutationObserver(records=>{
    if(!records.some(record=>record.type==='childList'||record.target.matches?.('button,input,select,summary'))||pending)return;
    // rAF pauses in background tabs; the timer guarantees new controls are owned anyway.
    pending=true;const run=()=>{if(!pending)return;pending=false;decorate();};requestAnimationFrame(run);setTimeout(run,150);
  }).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','aria-pressed','aria-selected','aria-current','disabled']});
  document.addEventListener('keydown',event=>{
    const resizer=event.target.closest?.('.ui-column-resizer');
    if(resizer&&['ArrowLeft','ArrowRight','Home'].includes(event.key)){event.preventDefault();resizeColumn(resizer,event.key==='ArrowLeft'?-8:8,event.key==='Home');return;}
    const button=event.target.closest?.('button[data-ui-kind="segment"],button[data-ui-kind="run"]'),group=button?.closest('[data-ui-group="segments"],.run-segments');
    if(!group||event.altKey||event.metaKey||event.ctrlKey||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    const choices=[...group.querySelectorAll('button:not(:disabled)')];
    const index=choices.indexOf(button),next=event.key==='Home'?choices[0]:event.key==='End'?choices.at(-1):choices[(index+(event.key==='ArrowRight'?1:-1)+choices.length)%choices.length];
    if(next){event.preventDefault();next.focus();next.click();}
  });
  document.addEventListener('pointerdown',event=>{
    const handle=event.target.closest?.('.ui-column-resizer');if(!handle)return;
    event.preventDefault();event.stopPropagation();handle.focus({preventScroll:true});handle.setPointerCapture?.(event.pointerId);
    columnDrag={handle,x:event.clientX};
  });
  document.addEventListener('pointermove',event=>{
    if(!columnDrag)return;const delta=event.clientX-columnDrag.x;columnDrag.x=event.clientX;resizeColumn(columnDrag.handle,delta);
  });
  document.addEventListener('pointerup',()=>{columnDrag=null;});
  document.addEventListener('pointercancel',()=>{columnDrag=null;});
  document.addEventListener('dblclick',event=>{const handle=event.target.closest?.('.ui-column-resizer');if(handle){event.preventDefault();resizeColumn(handle,0,true);}});
  window.ApexUI=Object.freeze({decorate,audit,familyFor,symbol});
})();
