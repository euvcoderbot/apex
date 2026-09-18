// Isolated workspace: importing this module does not retrieve session/telemetry data.
const $ = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const finite = value => typeof value === 'number' && Number.isFinite(value);
const avg = values => { const a = values.filter(finite); return a.length ? a.reduce((s,v)=>s+v,0)/a.length : null; };
const median = values => { const a=values.filter(finite).sort((a,b)=>a-b), i=Math.floor(a.length/2); return a.length ? a.length%2 ? a[i] : (a[i-1]+a[i])/2 : null; };
const fmt = (n, digits=2, suffix='') => finite(n) ? `${n.toFixed(digits)}${suffix}` : '—';
const color = value => /^#[a-f\d]{6}$/i.test(value || '') ? value : '#888888';
const teamLabel = team => `<span class="performance-team" style="--team-color:${color(team.color)}">${escape(team.team)}</span>`;
let initialized=false, calendar=[], calendarController, controller, generation=0;
let events=[], errors=[], activeMetric='pace', running=false, traceRunning=false, sortKey='qualy', sortDirection=1;
let selectedTeams=new Set(), context=null;
const root=$('performanceResults');

async function get(path, signal) {
  const response=await fetch(`${String(window.APEX_API_ORIGIN || '').replace(/\/$/,'')}${path}`, {signal,cache:'no-store'});
  const payload=await response.json();
  if (!response.ok) throw new Error(typeof payload.detail === 'string' ? payload.detail : `Request failed (${response.status})`);
  return payload;
}

function completed(event, session) {
  const start=Date.parse(event.session_dates?.[session] || '');
  return Number.isFinite(start) && start+4*3600000 < Date.now();
}

async function loadCalendar() {
  calendarController?.abort(); calendarController=new AbortController();
  const signal=calendarController.signal;
  $('performanceLoad').disabled=true;
  $('performanceEvent').innerHTML='<option>Loading calendar…</option>';
  try {
    calendar=await get(`/api/events?year=${$('performanceYear').value}`,signal);
    calendar=calendar.filter(e=>completed(e,'Qualifying'));
    $('performanceEvent').innerHTML=calendar.map(e=>`<option value="${escape(e.name)}">R${e.round} · ${escape(e.name)}</option>`).join('');
    $('performanceEvent').value=calendar.at(-1)?.name || '';
    $('performanceStatus').textContent=calendar.length ? 'Ready. Data loads only when you choose Analyse.' : 'No completed qualifying sessions available for this season.';
    $('performanceLoad').disabled=!calendar.length;
  } catch(e) {
    if(signal.aborted) return;
    $('performanceStatus').textContent=`Calendar unavailable: ${e.message}. Change season to retry.`;
    $('performanceEvent').innerHTML='<option>Calendar unavailable</option>';
  }
}

function stop() {
  controller?.abort(); generation++; running=false; traceRunning=false;
  $('performanceCancel').hidden=true;
  $('performanceLoad').disabled=!calendar.length;
  $('performanceStatus').textContent='Stopped. Completed results remain visible.';
  render();
}

function reset() {
  stop(); events=[]; errors=[]; selectedTeams.clear(); context=null; root.replaceChildren();
  $('performanceStatus').textContent='Selection changed. Choose Analyse to load fresh results.';
}

async function analyse() {
  controller?.abort(); controller=new AbortController(); const signal=controller.signal, id=++generation;
  events=[]; errors=[]; selectedTeams.clear(); running=true;
  context={year:$('performanceYear').value, phase:$('performancePhase').value, traffic:$('performanceTraffic').value,
    season:$('performanceScope').value==='season'};
  const picked=context.season ? [...calendar] : calendar.filter(e=>e.name===$('performanceEvent').value);
  const jobs=picked.flatMap(event=>['Q','R'].filter(s=>s==='Q'||completed(event,'Race')).map(session=>({event,session})));
  const total=jobs.length;
  let done=0;
  $('performanceLoad').disabled=true; $('performanceCancel').hidden=false;
  render();
  async function worker() {
    while(jobs.length && !signal.aborted) {
      const job=jobs.shift();
      $('performanceStatus').textContent=`Analysing ${context.year} · ${done}/${total} session results received · ${job.event.name}`;
      try {
        const params=new URLSearchParams({year:context.year,gp:job.event.name,session:job.session,phase:context.phase,traffic:context.traffic});
        const data=await get(`/api/performance?${params}`,signal);
        if(id!==generation) return;
        let item=events.find(e=>e.name===job.event.name);
        if(!item) { item={...job.event,traces:{}}; events.push(item); }
        item[job.session]=data;
      } catch(e) { if(signal.aborted) return; errors.push({...job,message:e.message}); }
      done++; render();
    }
  }
  // At most two session requests; no whole-season telemetry fan-out.
  await Promise.all([worker(),worker()]);
  if(id!==generation) return;
  running=false; $('performanceLoad').disabled=false; $('performanceCancel').hidden=true;
  $('performanceStatus').textContent=`${context.year} · ${context.phase} · ${events.length}/${picked.length} events with data${errors.length ? ` · ${errors.length} session requests unavailable` : ''}. Fresh retrieval complete.`;
  render();
}

function aggregate() {
  const map=new Map();
  for(const e of [...events].sort((a,b)=>a.round-b.round)) for(const session of ['Q','R']) {
    for(const t of e[session]?.teams || []) {
      if(!map.has(t.team)) map.set(t.team,{team:t.team,color:t.color,q:[],r:[],sectors:[[],[],[]],points:0,pointsKnown:true,starts:0,finishes:0,mechanical:0,incidents:0,other:0,positions:[],samples:0,coverage:[],stints:[],results:0});
      const item=map.get(t.team);
      if(session==='Q') {
        item.q.push({round:e.round,event:e.name,pace:t.pace,lap:t.lap});
        t.sector_deficits?.forEach((v,i)=>{if(finite(v))item.sectors[i].push(v);});
      } else {
        item.r.push(t.pace); item.samples+=t.samples; item.coverage.push(t.traffic_coverage);
        item.points+=t.points; item.pointsKnown&&=t.points_known; item.starts+=t.starts; item.finishes+=t.finishes;
        item.mechanical+=t.mechanical; item.incidents+=t.incidents; item.other+=t.other_retirements;
        item.positions.push(...t.positions); item.results++;
        item.stints.push(...(t.degradation || []).map(s=>({...s,event:e.name})));
      }
    }
  }
  return [...map.values()].map(t=>({...t,qualy:avg(t.q.map(q=>q.pace)),race:avg(t.r),coverage:avg(t.coverage),
    qCount:t.q.filter(q=>finite(q.pace)).length,rCount:t.r.filter(finite).length}));
}

function table(headers,rows) {
  return `<div class="performance-table-wrap"><table class="performance-table"><thead><tr>${headers.map(h=>`<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.map(row=>`<tr>${row.map(v=>`<td>${v}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${headers.length}">No eligible data yet.</td></tr>`}</tbody></table></div>`;
}
function card(title,note,body) { return `<section class="dashboard-card performance-card"><h2>${title}</h2><p class="performance-note">${note}</p>${body}</section>`; }
function sortHeader(key,label) {return `<button data-performance-sort="${key}">${label}${sortKey===key ? sortDirection===1 ? ' ↑':' ↓' : ' ↕'}</button>`;}

function renderPace(teams) {
  const sorted=[...teams].sort((a,b)=>finite(a[sortKey]) && finite(b[sortKey]) ? (a[sortKey]-b[sortKey])*sortDirection : finite(a[sortKey]) ? -1 : finite(b[sortKey]) ? 1 : a.team.localeCompare(b.team));
  return card('Pace overview',`${escape(context?.phase || 'Q1')} · fastest teammate in qualifying · race pace uses matched dry laps with timing-line gaps over ${escape(context?.traffic || 2)}s. Percentages are relative; lower is better.`,
    table(['Team',sortHeader('qualy','Qualifying deficit'),sortHeader('race','Race pace deficit'),'Matched race laps','Traffic coverage'],sorted.map(t=>[
      teamLabel(t),`${fmt(t.qualy,3,'%')}<small>${t.qCount} event${t.qCount===1?'':'s'}</small>`,
      `${fmt(t.race,3,'%')}<small>${t.rCount} event${t.rCount===1?'':'s'}</small>`,t.samples,
      `${fmt(finite(t.coverage)?t.coverage*100:null,0,'%')}<small>${t.coverage<.25?'Low coverage · traffic limited':'Timing-line proxy'}</small>`])))+
    card('Sector deficits','Sectors from each team’s selected qualifying lap, against the fastest selected-lap sector in the same phase. Not theoretical best sectors.',
      table(['Team','Sector 1','Sector 2','Sector 3'],teams.map(t=>[teamLabel(t),...t.sectors.map(s=>fmt(avg(s),3,'%'))])));
}

function renderRace(teams) {
  return card('Tyre-age lap-time trend','Observed s/lap within each dry clean-air stint. Positive means slower with age; fuel burn and changing conditions are not removed. Compare the same event and compound.',
    table(['Team / driver','Event','Compound · stint','Observed slope','Laps'],teams.flatMap(t=>t.stints.map(s=>[
      `${teamLabel(t)}<small>${escape(s.driver)}</small>`,escape(s.event),`${escape(s.compound)} · ${s.stint}`,
      fmt(s.slope,3,' s/lap'),s.samples]))));
}

function renderResults(teams) {
  return card('Reliability and results','Race classifications only; sprints excluded. Points and finishing position describe results conversion, not a car-performance score. Unknown retirement causes remain separate.',
    table(['Team','Points','Avg. finish','Finished / starts','Mechanical','Incidents','Other / unknown'],teams.map(t=>[
      teamLabel(t),t.results&&t.pointsKnown?t.points:'—',fmt(avg(t.positions),1),`${t.finishes} / ${t.starts}`,
      t.mechanical,t.incidents,t.other])));
}

function renderTrend(teams) {
  return card('Development trend','Qualifying deficit by event, equal-weighted. Lower is better. Missing sessions are gaps, not zero. Track mix and driver execution remain confounders.',
    table(['Team','Event-by-event deficit','First 3 → last 3','Change'],teams.map(t=>{
      const valid=t.q.filter(q=>finite(q.pace)), first=avg(valid.slice(0,3).map(q=>q.pace)),last=avg(valid.slice(-3).map(q=>q.pace));
      const enough=valid.length>=6;
      const ceiling=Math.max(1,...teams.flatMap(t=>t.q.map(q=>q.pace).filter(finite)));
      return [teamLabel(t),`<div class="performance-trend" style="--team-color:${color(t.color)}">${t.q.map(q=>`<span style="height:${finite(q.pace)?Math.max(2,q.pace/ceiling*100):0}%;${finite(q.pace)?'':'background:transparent'}" title="R${q.round} ${escape(q.event)}: ${fmt(q.pace,3,'%')}" aria-label="R${q.round}: ${fmt(q.pace,3,'%')}"></span>`).join('')}</div><div class="performance-trend-label"><span>R${t.q[0]?.round??'—'}</span><span>R${t.q.at(-1)?.round??'—'}</span></div>`,
        enough?`${fmt(first,3,'%')} → ${fmt(last,3,'%')}`:'Needs 6 eligible events',enough?fmt(last-first,3,' pp'):'—'];
    })))+card('FIA updates','Use the official Car Presentation Submissions for the event. Upgrade counts are not weighted by importance, and a before/after pace change cannot establish causation.',
      '<p><a href="https://www.fia.com/documents" target="_blank" rel="noopener">Open FIA event documents ↗</a></p><p class="performance-note">Automatic report ingestion and component-to-trend annotations are not available in this version. No upgrade counts or claimed gains are inferred.</p>');
}

function renderTrace(teams) {
  if(context?.season) return card('Cornering, straight line and braking','Analyse a single track to compare representative qualifying telemetry. Season timing analysis does not download every car’s telemetry.', '<p>Select <strong>Per track</strong> above, then choose Analyse.</p>');
  const e=events[0];
  const candidates=(e?.Q?.teams || []).filter(t=>t.lap);
  const selected=candidates.filter(t=>selectedTeams.has(t.team));
  const controls=`<div class="performance-choices">${candidates.map(t=>`<label><input type="checkbox" data-performance-team="${escape(t.team)}" ${selectedTeams.has(t.team)?'checked':''} ${traceRunning?'disabled':''}>${escape(t.team)} · ${escape(t.lap.driver)} L${t.lap.lap}</label>`).join('')}</div><button type="button" id="performanceTraceLoad" ${!selected.length||running||traceRunning?'disabled':''}>${traceRunning?'Analysing telemetry…':'Analyse selected teams'}</button>`;
  const loaded=selected.filter(t=>e.traces[t.team]?.corners);
  let html=card('Telemetry comparison','Select teams to retrieve their fastest qualifying lap in the chosen phase. No automatic telemetry downloads. These are observed laps, not isolated car potential.',controls);
  const failed=selected.filter(t=>e.traces[t.team]?.error);
  html+=failed.map(t=>`<p class="performance-error">${escape(t.team)}: ${escape(e.traces[t.team].error)}</p>`).join('');
  if(!loaded.length) return html;
  // Shared category assignment and identical corner set for every selected team.
  const common=loaded[0] ? e.traces[loaded[0].team].corners.map(c=>c.corner).filter(label=>loaded.every(t=>e.traces[t.team].corners.some(c=>c.corner===label))) : [];
  const groups={low:[],medium:[],high:[]};
  for(const label of common) {
    const v=median(loaded.map(t=>e.traces[t.team].corners.find(c=>c.corner===label).minimum));
    groups[v<150?'low':v<230?'medium':'high'].push(label);
  }
  if(activeMetric==='corners') {
    html+=card('Low / medium / high-speed cornering','Shared speed categories across loaded teams. Mean speed uses total common-window distance ÷ time. Check individual corners below; lap execution, tyres and setup remain in the result.',
      table(['Team','Low <150','Medium 150–230','High ≥230','Telemetry interval'],loaded.map(t=>{
        const trace=e.traces[t.team];
        return [teamLabel(t),...Object.values(groups).map(labels=>{
          const c=trace.corners.filter(c=>labels.includes(c.corner));
          return c.length ? `${fmt(c.reduce((s,c)=>s+c.length,0)/c.reduce((s,c)=>s+c.time,0)*3.6,1,' km/h')}<small>${c.length} common corners</small>`:'—';
        }),fmt(trace.median_sample_interval,3,' s')];
      })))+card('Corner measurements','Fixed ±100 m windows clipped at neighbouring corner midpoints. Differences in reconstructed path length can affect timing: inspect both time and speed, not tiny hundredths in isolation.',
      table(['Corner',...loaded.map(t=>escape(t.team))],common.map(label=>[escape(label),...loaded.map(t=>{
        const c=e.traces[t.team].corners.find(c=>c.corner===label);return `${fmt(c.time,3,' s')}<small>${fmt(c.mean_speed,1,' km/h')} mean · ${fmt(c.minimum,1)} min · ${fmt(c.length,0,' m')}</small>`;
      })])));
    html+=card('Downforce index','Unavailable: no defensible direct estimate from public telemetry alone.','<p class="performance-note">High-speed corner performance is the measurable alternative. It is not relabelled as downforce or aerodynamic efficiency.</p>');
  } else if(activeMetric==='straight') {
    html+=card('Straight-line observations','Not an engine-power or drag ranking. Tow, DRS/straight mode, deployment, setup and corner exit can all change these speeds.',
      table(['Team','Peak speed','Full-throttle P95','Lap / samples'],loaded.map(t=>[teamLabel(t),fmt(e.traces[t.team].top_speed,1,' km/h'),fmt(e.traces[t.team].full_throttle_p95,1,' km/h'),`${escape(t.lap.driver)} L${t.lap.lap} · ${e.traces[t.team].samples}`])));
  } else {
    html+=card('Braking zones','Brake-on events with at least 40 km/h speed loss over ≥0.5 s. Mean deceleration is derived from speed, not brake pressure. Zones with different entry/exit speeds are not directly rankable.',
      table(['Team','Start distance','Entry → exit','Braking distance','Duration','Mean deceleration'],loaded.flatMap(t=>e.traces[t.team].braking.map(b=>[
        teamLabel(t),fmt(b.start,0,' m'),`${fmt(b.entry,0)} → ${fmt(b.exit,0)} km/h`,fmt(b.distance,0,' m'),fmt(b.duration,2,' s'),fmt(b.mean_g,2,' g')]))));
  }
  return html;
}

function render() {
  if(!context) return;
  const teams=aggregate();
  const modes=[['pace','Pace & sectors'],['corners','Cornering'],['straight','Straight line'],['braking','Braking'],['tyres','Tyre trend'],['trend','Development & updates'],['results','Reliability & results']];
  root.innerHTML=`<div class="performance-mode" role="group" aria-label="Performance metric">${modes.map(([key,label])=>`<button type="button" data-performance-metric="${key}" aria-pressed="${activeMetric===key}">${label}</button>`).join('')}</div>`+
    errors.map(e=>`<p class="performance-error">${escape(e.event.name)} · ${e.session==='Q'?'Qualifying':'Race'}: ${escape(e.message)}</p>`).join('')+
    (activeMetric==='pace'?renderPace(teams):activeMetric==='tyres'?renderRace(teams):activeMetric==='results'?renderResults(teams):activeMetric==='trend'?renderTrend(teams):renderTrace(teams));
}

async function loadTraces() {
  if(running||traceRunning||!context) return;
  controller?.abort(); controller=new AbortController(); const signal=controller.signal,id=++generation;
  const e=events[0];
  const jobs=(e?.Q?.teams || []).filter(t=>t.lap&&selectedTeams.has(t.team));
  traceRunning=true; $('performanceCancel').hidden=false; render();
  async function worker() {
    while(jobs.length&&!signal.aborted) {
      const t=jobs.shift(),lap=t.lap;
      $('performanceStatus').textContent=`Retrieving ${t.team} · ${lap.driver} L${lap.lap} telemetry…`;
      try {
        const p=new URLSearchParams({year:context.year,gp:e.name,driver_number:lap.number,start:lap.start,end:lap.end});
        const result=await get(`/api/performance/trace?${p}`,signal);
        if(id!==generation) return;
        e.traces[t.team]=result;
      } catch(err) { if(signal.aborted) return; e.traces[t.team]={error:err.message}; }
      render();
    }
  }
  await Promise.all([worker(),worker()]);
  if(id!==generation) return;
  traceRunning=false; $('performanceCancel').hidden=true;
  $('performanceStatus').textContent='Telemetry analysis complete. Missing or unreliable measurements are excluded.';
  render();
}

document.querySelectorAll('[data-analysis-view]').forEach(button=>button.addEventListener('click',()=>{
  const performance=button.dataset.analysisView==='performance';
  document.body.classList.toggle('performance-view',performance);
  $('carPerformance').hidden=!performance;
  document.querySelectorAll('[data-analysis-view]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
  if(!performance) { if(running||traceRunning) stop(); window.dispatchEvent(new Event('resize')); }
  if(performance&&!initialized) {
    initialized=true;
    const year=new Date().getFullYear();
    $('performanceYear').innerHTML=Array.from({length:year-2017},(_,i)=>`<option>${year-i}</option>`).join('');
    loadCalendar();
  }
}));
$('performanceYear').addEventListener('change',()=>{reset();loadCalendar();});
for(const id of ['performanceEvent','performancePhase','performanceTraffic','performanceScope']) $(id).addEventListener('change',()=>{
  reset(); $('performanceEventField').hidden=$('performanceScope').value==='season';
});
$('performanceLoad').addEventListener('click',analyse);
$('performanceCancel').addEventListener('click',stop);
root.addEventListener('click',event=>{
  const metric=event.target.closest('[data-performance-metric]');
  if(metric) {activeMetric=metric.dataset.performanceMetric;render();}
  const sort=event.target.closest('[data-performance-sort]');
  if(sort) {sortDirection=sortKey===sort.dataset.performanceSort?-sortDirection:1;sortKey=sort.dataset.performanceSort;render();}
  if(event.target.closest('#performanceTraceLoad')) loadTraces();
});
root.addEventListener('change',event=>{
  const team=event.target.dataset.performanceTeam;
  if(team) {event.target.checked?selectedTeams.add(team):selectedTeams.delete(team);render();}
});
