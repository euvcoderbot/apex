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
let context=null;
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
  stop(); events=[]; errors=[]; context=null; root.replaceChildren();
  $('performanceStatus').textContent='Selection changed. Choose Analyse to load fresh results.';
}

async function analyse() {
  controller?.abort(); controller=new AbortController(); const signal=controller.signal, id=++generation;
  events=[]; errors=[]; running=true;
  context={year:$('performanceYear').value, season:$('performanceScope').value==='season'};
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
        const params=new URLSearchParams({year:context.year,gp:job.event.name,session:job.session});
        const data=await get(`/api/performance?${params}`,signal);
        if(id!==generation) return;
        let item=events.find(e=>e.name===job.event.name);
        if(!item) { item={...job.event,traces:{}}; events.push(item); }
        item[job.session]=data;
      } catch(e) { if(signal.aborted) return; errors.push({...job,message:e.message}); }
      done++; render();
    }
  }
  await Promise.all([worker(),worker()]);
  if(id!==generation) return;
  const traceJobs=events.filter(event=>event.Q?.teams?.some(team=>team.lap));
  let tracesDone=0;
  traceRunning=true;
  async function traceWorker() {
    while(traceJobs.length&&!signal.aborted) {
      const event=traceJobs.shift();
      $('performanceStatus').textContent=`Analysing telemetry · ${tracesDone}/${events.length} circuits complete · ${event.name}`;
      const selections=event.Q.teams.filter(team=>team.lap).map(team=>({
        team:team.team,driver_number:team.lap.number,start:team.lap.start,end:team.lap.end,
      }));
      try {
        const params=new URLSearchParams({year:context.year,gp:event.name,windows:JSON.stringify(selections)});
        const result=await get(`/api/performance/trace-batch?${params}`,signal);
        if(id!==generation)return;
        event.traces=result.teams||{};
      } catch(e) {
        if(signal.aborted)return;
        errors.push({event,session:'T',message:e.message});
      }
      tracesDone++; render();
    }
  }
  await Promise.all([traceWorker(),traceWorker()]);
  if(id!==generation) return;
  traceRunning=false;
  running=false; $('performanceLoad').disabled=false; $('performanceCancel').hidden=true;
  $('performanceStatus').textContent=`${context.year} · all qualifying phases · ${events.length}/${picked.length} events with data${errors.length ? ` · ${errors.length} data requests unavailable` : ''}. Fresh retrieval complete.`;
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
  return card('Pace overview','Fastest teammate in each available qualifying phase, averaged across Q1/Q2/Q3. Race pace uses matched dry, traffic-filtered laps. Percentages are relative; lower is better.',
    table(['Team',sortHeader('qualy','Qualifying deficit'),sortHeader('race','Race pace deficit'),'Matched race laps'],sorted.map(t=>[
      teamLabel(t),`${fmt(t.qualy,3,'%')}<small>${t.qCount} event${t.qCount===1?'':'s'}</small>`,
      `${fmt(t.race,3,'%')}<small>${t.rCount} event${t.rCount===1?'':'s'}</small>`,t.samples])))+
    card('Sector deficits','Fastest teammate in each phase against the fastest selected-lap sector in that phase, then averaged across available phases and events. Not theoretical best sectors.',
      table(['Team','Sector 1','Sector 2','Sector 3'],teams.map(t=>[teamLabel(t),...t.sectors.map(s=>fmt(avg(s),3,'%'))])));
}

function renderRace(teams) {
  const rows=[];
  const compoundOrder=['HYPERSOFT','ULTRASOFT','SUPERSOFT','SOFT','MEDIUM','HARD','SUPERHARD'];
  for(const team of teams) for(const compound of compoundOrder) {
    const stints=team.stints.filter(s=>s.compound===compound);
    const byEvent=new Map();
    for(const stint of stints) {
      if(!byEvent.has(stint.event))byEvent.set(stint.event,[]);
      byEvent.get(stint.event).push(stint.slope);
    }
    const eventValues=[...byEvent.values()].map(median).filter(finite);
    if(eventValues.length) rows.push([teamLabel(team),compound,fmt(avg(eventValues),3,' s/lap'),eventValues.length,stints.length]);
  }
  return card('Tyre-age lap-time trend','Dry traffic-filtered stints are combined by event and compound first, then events receive equal weight. Positive means lap times increased with tyre age; fuel burn, track evolution and management are not removed.',
    table(['Team','Compound','Average observed slope','Events','Stints'],rows));
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

function eventTelemetry(event) {
  const entrants=(event.Q?.teams||[]).filter(team=>event.traces?.[team.team]?.corners);
  const labels=[...new Set(entrants.flatMap(team=>event.traces[team.team].corners.map(c=>c.corner)))];
  const minimumCoverage=Math.max(3,Math.ceil(entrants.length*.6));
  const groups={low:[],medium:[],high:[]};
  for(const label of labels) {
    const observations=entrants.map(team=>event.traces[team.team].corners.find(c=>c.corner===label)).filter(Boolean);
    if(observations.length<minimumCoverage)continue;
    const speed=median(observations.map(c=>c.minimum));
    groups[speed<150?'low':speed<230?'medium':'high'].push(label);
  }
  const rows=new Map();
  for(const team of entrants) {
    const trace=event.traces[team.team], categories={};
    for(const [name,labels] of Object.entries(groups)) {
      const corners=trace.corners.filter(c=>labels.includes(c.corner));
      categories[name]=corners.length ? {
        speed:corners.reduce((sum,c)=>sum+c.length,0)/corners.reduce((sum,c)=>sum+c.time,0)*3.6,
        corners:corners.length,
      }:null;
    }
    rows.set(team.team,{team:team.team,color:team.color,lap:team.lap,trace,categories,
      brakeG:median(trace.braking.map(zone=>zone.mean_g)),
      brakeDistance:median(trace.braking.map(zone=>zone.distance)),
      brakeDuration:median(trace.braking.map(zone=>zone.duration)),
      brakeZones:trace.braking.length});
  }
  return {rows,groups,entrants};
}

function seasonTelemetry() {
  const map=new Map();
  for(const event of events) {
    const summary=eventTelemetry(event);
    for(const row of summary.rows.values()) {
      if(!map.has(row.team))map.set(row.team,{team:row.team,color:row.color,low:[],medium:[],high:[],top:[],full:[],brakeG:[],brakeDistance:[],brakeDuration:[],events:0,zones:0});
      const item=map.get(row.team); item.events++;
      for(const name of ['low','medium','high'])if(finite(row.categories[name]?.speed))item[name].push(row.categories[name].speed);
      if(finite(row.trace.top_speed))item.top.push(row.trace.top_speed);
      if(finite(row.trace.full_throttle_p95))item.full.push(row.trace.full_throttle_p95);
      if(finite(row.brakeG))item.brakeG.push(row.brakeG);
      if(finite(row.brakeDistance))item.brakeDistance.push(row.brakeDistance);
      if(finite(row.brakeDuration))item.brakeDuration.push(row.brakeDuration);
      item.zones+=row.brakeZones;
    }
  }
  return [...map.values()];
}

function renderTrace() {
  if(context?.season) {
    const season=seasonTelemetry();
    if(!season.length)return card('Telemetry season average','Circuit telemetry is still loading. Completed circuits will appear progressively.','<p>No reliable telemetry has completed yet.</p>');
    if(activeMetric==='corners')return card('Season cornering performance','Each circuit first produces one low-, medium- and high-speed value per team. Circuit values are then equally averaged, so tracks with more corners do not dominate the season. Higher observed mean speed is better only within this controlled comparison; tyres, setup and driver execution remain included.',
      table(['Team','Low <150','Medium 150–230','High ≥230','Circuits'],season.map(team=>[teamLabel(team),
        `${fmt(avg(team.low),1,' km/h')}<small>${team.low.length} circuits</small>`,
        `${fmt(avg(team.medium),1,' km/h')}<small>${team.medium.length} circuits</small>`,
        `${fmt(avg(team.high),1,' km/h')}<small>${team.high.length} circuits</small>`,team.events])))+
      card('Downforce index','Unavailable: public telemetry cannot isolate aerodynamic load.','<p class="performance-note">The high-speed corner season average is the measurable proxy shown directly, without renaming it as downforce.</p>');
    if(activeMetric==='straight')return card('Season straight-line performance','Peak and full-throttle P95 speeds are calculated per circuit, then circuits are equally averaged. Tow, DRS/straight mode, deployment, gearing and corner exits remain confounders.',
      table(['Team','Average peak speed','Average full-throttle P95','Circuits'],season.map(team=>[teamLabel(team),fmt(avg(team.top),1,' km/h'),fmt(avg(team.full),1,' km/h'),team.events])));
    return card('Season braking performance','Each circuit contributes its median qualifying braking-zone observation; circuit values are then equally averaged. This compares observed deceleration, distance and duration—not brake pressure or isolated hardware capability.',
      table(['Team','Mean deceleration','Braking distance','Duration','Circuits / zones'],season.map(team=>[teamLabel(team),fmt(avg(team.brakeG),2,' g'),fmt(avg(team.brakeDistance),1,' m'),fmt(avg(team.brakeDuration),2,' s'),`${team.events} / ${team.zones}`])));
  }
  const event=events[0], summary=eventTelemetry(event||{}), loaded=[...summary.rows.values()];
  if(!loaded.length)return card('Telemetry comparison','Qualifying telemetry for every team is loaded automatically.','<p>No reliable telemetry is available for this event.</p>');
  if(activeMetric==='corners') {
    const common=[...new Set(Object.values(summary.groups).flat())];
    return card('Low / medium / high-speed cornering','Categories are shared across the field. Mean speed uses total category distance ÷ time. Lap execution, tyres and setup remain in the observation.',
      table(['Team','Low <150','Medium 150–230','High ≥230'],loaded.map(row=>[teamLabel(row),...['low','medium','high'].map(name=>{
        const value=row.categories[name];return value?`${fmt(value.speed,1,' km/h')}<small>${value.corners} corners</small>`:'—';
      })])))+card('Corner measurements','Fixed windows are clipped at neighbouring corner midpoints. Inspect time and speed together; tiny hundredths are below the intended precision.',
      table(['Corner',...loaded.map(row=>escape(row.team))],common.map(label=>[escape(label),...loaded.map(row=>{
        const corner=row.trace.corners.find(c=>c.corner===label);return corner?`${fmt(corner.time,3,' s')}<small>${fmt(corner.mean_speed,1,' km/h')} mean · ${fmt(corner.minimum,1)} min</small>`:'—';
      })])))+card('Downforce index','Unavailable: public telemetry cannot isolate aerodynamic load.','<p class="performance-note">High-speed corner performance is shown directly instead.</p>');
  }
  if(activeMetric==='straight')return card('Straight-line observations','Not an engine-power or drag ranking. Tow, DRS/straight mode, deployment, setup and corner exit can all change these speeds.',
    table(['Team','Peak speed','Full-throttle P95','Representative lap'],loaded.map(row=>[teamLabel(row),fmt(row.trace.top_speed,1,' km/h'),fmt(row.trace.full_throttle_p95,1,' km/h'),`${escape(row.lap.driver)} L${row.lap.lap}`])));
  return card('Braking observations','Circuit-level medians across detected qualifying braking zones. Mean deceleration comes from speed change, not brake pressure.',
    table(['Team','Median deceleration','Median distance','Median duration','Zones'],loaded.map(row=>[teamLabel(row),fmt(row.brakeG,2,' g'),fmt(row.brakeDistance,1,' m'),fmt(row.brakeDuration,2,' s'),row.brakeZones])));
}

function render() {
  if(!context) return;
  const teams=aggregate();
  const modes=[['pace','Pace & sectors'],['corners','Cornering'],['straight','Straight line'],['braking','Braking'],['tyres','Tyre trend'],['trend','Development & updates'],['results','Reliability & results']];
  root.innerHTML=`<div class="performance-mode" role="group" aria-label="Performance metric">${modes.map(([key,label])=>`<button type="button" data-performance-metric="${key}" aria-pressed="${activeMetric===key}">${label}</button>`).join('')}</div>`+
    errors.map(e=>`<p class="performance-error">${escape(e.event.name)} · ${e.session==='Q'?'Qualifying':e.session==='R'?'Race':'Telemetry'}: ${escape(e.message)}</p>`).join('')+
    (activeMetric==='pace'?renderPace(teams):activeMetric==='tyres'?renderRace(teams):activeMetric==='results'?renderResults(teams):activeMetric==='trend'?renderTrend(teams):renderTrace());
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
for(const id of ['performanceEvent','performanceScope']) $(id).addEventListener('change',()=>{
  reset(); $('performanceEventField').hidden=$('performanceScope').value==='season';
});
$('performanceLoad').addEventListener('click',analyse);
$('performanceCancel').addEventListener('click',stop);
root.addEventListener('click',event=>{
  const metric=event.target.closest('[data-performance-metric]');
  if(metric) {activeMetric=metric.dataset.performanceMetric;render();}
  const sort=event.target.closest('[data-performance-sort]');
  if(sort) {sortDirection=sortKey===sort.dataset.performanceSort?-sortDirection:1;sortKey=sort.dataset.performanceSort;render();}
});
