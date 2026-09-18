// Isolated workspace: importing this module does not retrieve session/telemetry data.
const $ = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const finite = value => typeof value === 'number' && Number.isFinite(value);
const avg = values => { const a = values.filter(finite); return a.length ? a.reduce((s,v)=>s+v,0)/a.length : null; };
const median = values => { const a=values.filter(finite).sort((a,b)=>a-b), i=Math.floor(a.length/2); return a.length ? a.length%2 ? a[i] : (a[i-1]+a[i])/2 : null; };
const fmt = (n, digits=2, suffix='') => finite(n) ? `${n.toFixed(digits)}${suffix}` : '—';
const color = value => /^#[a-f\d]{6}$/i.test(value || '') ? value : '#888888';
const teamLabel = team => `<span class="performance-team" style="--team-color:${color(team.color)}">${escape(team.team)}</span>`;
function rebase(rows, keys) {
  for(const key of keys) {
    const values=rows.map(row=>row[key]).filter(finite);
    if(!values.length)continue;
    const best=Math.min(...values);
    for(const row of rows)if(finite(row[key]))row[key]=Math.max(0,((100+row[key])/(100+best)-1)*100);
  }
  return rows;
}
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
      const selections=event.Q.teams.filter(team=>team.lap).flatMap(team=>(team.telemetry_candidates?.length?team.telemetry_candidates:[team.lap]).map((lap,i)=>({
        team:`${team.team}:${i}`,team_name:team.team,driver_number:lap.number,
        driver:lap.driver,lap:lap.lap,start:lap.start,end:lap.end,
      })));
      try {
        const params=new URLSearchParams({year:context.year,gp:event.name,windows:JSON.stringify(selections)});
        const result=await get(`/api/performance/trace-batch?${params}`,signal);
        if(id!==generation)return;
        event.traces=result.teams||{};
        event.traceReference=result.reference_team;
        if(result.error)errors.push({event,session:'T',message:result.error});
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
      if(!map.has(t.team)) map.set(t.team,{team:t.team,color:t.color,q:[],r:[],sectors:[[],[],[]],points:0,pointsKnown:true,starts:0,finishes:0,mechanical:0,incidents:0,other:0,positions:[],samples:0,coverage:[],stints:[],results:0,fastestRaceDrivers:[]});
      const item=map.get(t.team);
      if(session==='Q') {
        item.q.push({round:e.round,event:e.name,pace:t.pace,lap:t.lap});
        t.sector_deficits?.forEach((v,i)=>{if(finite(v))item.sectors[i].push(v);});
      } else {
        item.r.push(t.pace); item.samples+=t.samples; item.coverage.push(t.traffic_coverage);
        if(t.fastest_race_driver)item.fastestRaceDrivers.push(t.fastest_race_driver);
        item.points+=t.points; item.pointsKnown&&=t.points_known; item.starts+=t.starts; item.finishes+=t.finishes;
        item.mechanical+=t.mechanical; item.incidents+=t.incidents; item.other+=t.other_retirements;
        item.positions.push(...t.positions); item.results++;
        item.stints.push(...(t.degradation || []).map(s=>({...s,event:e.name})));
      }
    }
  }
  return rebase([...map.values()].map(t=>({...t,qualy:avg(t.q.map(q=>q.pace)),race:avg(t.r),coverage:avg(t.coverage),
    s1:avg(t.sectors[0]),s2:avg(t.sectors[1]),s3:avg(t.sectors[2]),
    qCount:t.q.filter(q=>finite(q.pace)).length,rCount:t.r.filter(finite).length})),['qualy','race','s1','s2','s3']);
}

function table(headers,rows) {
  return `<div class="performance-table-wrap"><table class="performance-table"><thead><tr>${headers.map(h=>`<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.map(row=>`<tr>${row.map(v=>`<td>${v}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${headers.length}">No eligible data yet.</td></tr>`}</tbody></table></div>`;
}
function card(title,note,body) { return `<section class="dashboard-card performance-card"><h2>${title}</h2><p class="performance-note">${note}</p>${body}</section>`; }
function sortHeader(key,label,defaultDirection=1) {return `<button data-performance-sort="${key}" data-sort-direction="${defaultDirection}">${label}${sortKey===key ? sortDirection===1 ? ' ↑':' ↓' : ' ↕'}</button>`;}
function sorted(items,getters,defaultKey,defaultDirection=1) {
  const key=getters[sortKey]?sortKey:defaultKey, direction=sortKey===key?sortDirection:defaultDirection;
  const value=getters[key];
  return [...items].sort((a,b)=>{
    const av=value(a),bv=value(b);
    if(finite(av)&&finite(bv))return (av-bv)*direction;
    if(finite(av))return -1;
    if(finite(bv))return 1;
    return String(av??'').localeCompare(String(bv??''))*direction;
  });
}

function renderPace(teams) {
  const ordered=sorted(teams,{team:t=>t.team,qualy:t=>t.qualy,race:t=>t.race,samples:t=>t.samples},'qualy');
  const sectors=sorted(teams,{team:t=>t.team,s1:t=>t.s1,s2:t=>t.s2,s3:t=>t.s3},'s1');
  return card('Pace overview','The leading team is 0%; other teams show their percentage deficit. Qualifying averages the fastest teammate in Q1/Q2/Q3. Race pace uses clean-air laps with shared race-lap, compound and tyre-age adjustments; the faster eligible teammate represents the team.',
    table([sortHeader('team','Team'),sortHeader('qualy','Qualifying deficit'),sortHeader('race','Estimated race pace deficit'),sortHeader('samples','Eligible race laps',-1)],ordered.map(t=>[
      teamLabel(t),`${fmt(t.qualy,3,'%')}<small>${t.qCount} event${t.qCount===1?'':'s'}</small>`,
      `${fmt(t.race,3,'%')}<small>${t.fastestRaceDrivers?.length?`Fastest: ${escape([...new Set(t.fastestRaceDrivers)].join(', '))} · `:''}${t.rCount} event${t.rCount===1?'':'s'}</small>`,t.samples])))+
    card('Sector deficits','Fastest teammate in each phase against the fastest selected-lap sector in that phase, then averaged across available phases and events. Not theoretical best sectors.',
      table([sortHeader('team','Team'),sortHeader('s1','Sector 1'),sortHeader('s2','Sector 2'),sortHeader('s3','Sector 3')],sectors.map(t=>[teamLabel(t),...['s1','s2','s3'].map(s=>fmt(t[s],3,'%'))])));
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
  const data=rows.map(row=>({row,team:row[0].replace(/<[^>]+>/g,''),compound:row[1],slope:Number.parseFloat(row[2]),events:+row[3],stints:+row[4]}));
  const ordered=sorted(data,{tyreTeam:r=>r.team,compound:r=>r.compound,tyreSlope:r=>r.slope,tyreEvents:r=>r.events,tyreStints:r=>r.stints},'tyreSlope');
  return card('Tyre-age lap-time trend','Dry traffic-filtered stints are combined by event and compound first, then events receive equal weight. Positive means lap times increased with tyre age; fuel burn, track evolution and management are not removed.',
    table([sortHeader('tyreTeam','Team'),sortHeader('compound','Compound'),sortHeader('tyreSlope','Average observed slope'),sortHeader('tyreEvents','Events',-1),sortHeader('tyreStints','Stints',-1)],ordered.map(item=>item.row)));
}

function renderResults(teams) {
  const ordered=sorted(teams,{resultTeam:t=>t.team,points:t=>t.points,finish:t=>avg(t.positions),finishRate:t=>t.starts?t.finishes/t.starts:null,mechanical:t=>t.mechanical,incidents:t=>t.incidents,other:t=>t.other},'points',-1);
  return card('Reliability and results','Race classifications only; sprints excluded. Points and finishing position describe results conversion, not a car-performance score. Unknown retirement causes remain separate.',
    table([sortHeader('resultTeam','Team'),sortHeader('points','Points',-1),sortHeader('finish','Avg. finish'),sortHeader('finishRate','Finished / starts',-1),sortHeader('mechanical','Mechanical'),sortHeader('incidents','Incidents'),sortHeader('other','Other / unknown')],ordered.map(t=>[
      teamLabel(t),t.results&&t.pointsKnown?t.points:'—',fmt(avg(t.positions),1),`${t.finishes} / ${t.starts}`,
      t.mechanical,t.incidents,t.other])));
}

function renderTrend(teams) {
  const trendRows=teams.map(t=>{
    const valid=t.q.filter(q=>finite(q.pace)),first=avg(valid.slice(0,3).map(q=>q.pace)),last=avg(valid.slice(-3).map(q=>q.pace));
    return {team:t,valid,first,last,change:valid.length>=6?last-first:null};
  });
  const ordered=sorted(trendRows,{trendTeam:r=>r.team.team,trendFirst:r=>r.first,trendLast:r=>r.last,trendChange:r=>r.change},'trendChange');
  return card('Development trend','Qualifying deficit by event, equal-weighted. Lower is better. Missing sessions are gaps, not zero. Track mix and driver execution remain confounders.',
    table([sortHeader('trendTeam','Team'),'Event-by-event deficit',sortHeader('trendFirst','First 3 → last 3'),sortHeader('trendChange','Change')],ordered.map(row=>{
      const t=row.team,valid=row.valid,first=row.first,last=row.last;
      const enough=valid.length>=6;
      const ceiling=Math.max(1,...teams.flatMap(t=>t.q.map(q=>q.pace).filter(finite)));
      return [teamLabel(t),`<div class="performance-trend" style="--team-color:${color(t.color)}">${t.q.map(q=>`<span style="height:${finite(q.pace)?Math.max(2,q.pace/ceiling*100):0}%;${finite(q.pace)?'':'background:transparent'}" title="R${q.round} ${escape(q.event)}: ${fmt(q.pace,3,'%')}" aria-label="R${q.round}: ${fmt(q.pace,3,'%')}"></span>`).join('')}</div><div class="performance-trend-label"><span>R${t.q[0]?.round??'—'}</span><span>R${t.q.at(-1)?.round??'—'}</span></div>`,
        enough?`${fmt(first,3,'%')} → ${fmt(last,3,'%')}`:'Needs 6 eligible events',enough?fmt(last-first,3,' pp'):'—'];
    })))+card('FIA updates','Use the official Car Presentation Submissions for the event. Upgrade counts are not weighted by importance, and a before/after pace change cannot establish causation.',
      '<p><a href="https://www.fia.com/documents" target="_blank" rel="noopener">Open FIA event documents ↗</a></p><p class="performance-note">Automatic report ingestion and component-to-trend annotations are not available in this version. No upgrade counts or claimed gains are inferred.</p>');
}

function eventTelemetry(event) {
  const entrants=(event.Q?.teams||[]).filter(team=>event.traces?.[team.team]?.corners);
  const labels=entrants[0] ? event.traces[entrants[0].team].corners.map(c=>c.corner)
    .filter(label=>entrants.every(team=>event.traces[team.team].corners.some(c=>c.corner===label))) : [];
  const groups={low:[],medium:[],high:[]};
  for(const label of labels) {
    const observations=entrants.map(team=>event.traces[team.team].corners.find(c=>c.corner===label)).filter(Boolean);
    const speed=median(observations.map(c=>c.minimum));
    groups[speed<=120?'low':speed<=200?'medium':'high'].push(label);
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
    rows.set(team.team,{team:team.team,color:team.color,lap:trace.selection||team.lap,trace,categories:trace.categories||categories});
  }
  for(const name of ['low','medium','high']) {
    const best=Math.max(...[...rows.values()].map(row=>row.categories[name]?.speed).filter(finite));
    for(const row of rows.values())if(!row.trace.categories&&finite(row.categories[name]?.speed))row.categories[name].deficit=(best/row.categories[name].speed-1)*100;
  }
  const bestTop=Math.max(...[...rows.values()].map(row=>row.trace.top_speed).filter(finite));
  const bestFull=Math.max(...[...rows.values()].map(row=>row.trace.full_throttle_p95).filter(finite));
  for(const row of rows.values()) {
    row.topDeficit=finite(row.trace.top_speed)?(bestTop/row.trace.top_speed-1)*100:null;
    row.fullDeficit=finite(row.trace.full_throttle_p95)?(bestFull/row.trace.full_throttle_p95-1)*100:null;
  }
  // Match the same physical braking zones before comparing cars. FastF1 and
  // OpenF1 publish only an on/off brake channel, never brake pressure.
  const reference=[...rows.values()].sort((a,b)=>b.trace.braking.length-a.trace.braking.length)[0];
  const matched=new Map([...rows.keys()].map(team=>[team,[]]));
  const used=new Map([...rows.keys()].map(team=>[team,new Set()]));
  for(const referenceZone of reference?.trace.braking||[]) {
    const candidates=[];
    let complete=true;
    for(const row of rows.values()) {
      const referencePosition=referenceZone.start/reference.trace.lap_distance;
      const options=row.trace.braking.map((zone,index)=>({zone,index,distance:Math.abs(zone.start/row.trace.lap_distance-referencePosition)}))
        .filter(item=>!used.get(row.team).has(item.index)&&item.distance<=.02)
        .sort((a,b)=>a.distance-b.distance);
      if(!options.length){complete=false;break;}
      candidates.push([row.team,options[0]]);
    }
    if(!complete)continue;
    for(const [team,item] of candidates){used.get(team).add(item.index);matched.get(team).push(item.zone);}
  }
  for(const row of rows.values()) {
    const zones=matched.get(row.team);
    row.brakeG=median(zones.map(zone=>zone.mean_g));
    row.brakeDistance=median(zones.map(zone=>zone.distance));
    row.brakeDuration=median(zones.map(zone=>zone.duration));
    row.brakeZones=zones.length;
  }
  return {rows,groups,entrants};
}

function seasonTelemetry() {
  const map=new Map();
  for(const event of events) {
    const summary=eventTelemetry(event);
    for(const row of summary.rows.values()) {
      if(!map.has(row.team))map.set(row.team,{team:row.team,color:row.color,low:[],medium:[],high:[],lowDeficit:[],mediumDeficit:[],highDeficit:[],top:[],full:[],topDeficit:[],fullDeficit:[],straightDeficit:[],straightContribution:[],cornerContribution:[],brakeG:[],brakeDistance:[],brakeDuration:[],events:0,zones:0});
      const item=map.get(row.team); item.events++;
      for(const name of ['low','medium','high'])if(finite(row.categories[name]?.speed)) {
        item[name].push(row.categories[name].speed);
        item[`${name}Deficit`].push(row.categories[name].deficit);
      }
      if(finite(row.trace.top_speed))item.top.push(row.trace.top_speed);
      if(finite(row.trace.full_throttle_p95))item.full.push(row.trace.full_throttle_p95);
      if(finite(row.topDeficit))item.topDeficit.push(row.topDeficit);
      if(finite(row.fullDeficit))item.fullDeficit.push(row.fullDeficit);
      if(finite(row.trace.straight_deficit))item.straightDeficit.push(row.trace.straight_deficit);
      if(finite(row.trace.straight_contribution))item.straightContribution.push(row.trace.straight_contribution);
      if(finite(row.trace.corner_contribution))item.cornerContribution.push(row.trace.corner_contribution);
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
    if(activeMetric==='corners') {
      const values=rebase(season.map(team=>({...team,lowValue:avg(team.low),mediumValue:avg(team.medium),highValue:avg(team.high),lowGap:avg(team.lowDeficit),mediumGap:avg(team.mediumDeficit),highGap:avg(team.highDeficit)})),['lowGap','mediumGap','highGap']);
      const ordered=sorted(values,{cornerTeam:t=>t.team,lowGap:t=>t.lowGap,mediumGap:t=>t.mediumGap,highGap:t=>t.highGap,cornerEvents:t=>t.events},'lowGap');
      return card('Season cornering performance','The leading team in each band is 0%. Shared GPS-aligned corner windows include braking and exit; each corner is scored before averaging the band, then circuits receive equal weight. Bands use field-median apex speed: low ≤120, medium ≤200, high >200 km/h. Flat-out bends count toward the straights.',
      table([sortHeader('cornerTeam','Team'),sortHeader('lowGap','Low-speed deficit'),sortHeader('mediumGap','Medium-speed deficit'),sortHeader('highGap','High-speed deficit'),sortHeader('cornerEvents','Circuits',-1)],ordered.map(team=>[teamLabel(team),
        `${fmt(team.lowGap,3,'%')}<small>${fmt(team.lowValue,1,' km/h')} · ${team.low.length} circuits</small>`,
        `${fmt(team.mediumGap,3,'%')}<small>${fmt(team.mediumValue,1,' km/h')} · ${team.medium.length} circuits</small>`,
        `${fmt(team.highGap,3,'%')}<small>${fmt(team.highValue,1,' km/h')} · ${team.high.length} circuits</small>`,team.events])))+
      card('Downforce index','Unavailable: public telemetry cannot isolate aerodynamic load.','<p class="performance-note">The high-speed corner season average is the measurable proxy shown directly, without renaming it as downforce.</p>');
    }
    if(activeMetric==='straight') {
      const values=rebase(season.map(team=>({...team,straightGap:avg(team.straightDeficit),peak:avg(team.top),sustained:avg(team.full)})),['straightGap']);
      const ordered=sorted(values,{straightTeam:t=>t.team,straightGap:t=>t.straightGap,peak:t=>t.peak,sustained:t=>t.sustained,straightEvents:t=>t.events},'straightGap');
      return card('Season straight-line performance','Elapsed time across the same straights is compared at each circuit, then circuits are equally averaged. The season leader is 0%. Braking and corner exits belong to the corner; flat-out bends remain in the straights. Peak speed and full-throttle P95 are supporting observations.',
      table([sortHeader('straightTeam','Team'),sortHeader('straightGap','Straight-time deficit'),sortHeader('peak','Average peak speed',-1),sortHeader('sustained','Sustained full-throttle speed (P95)',-1),sortHeader('straightEvents','Circuits',-1)],ordered.map(team=>[teamLabel(team),fmt(team.straightGap,3,'%'),fmt(team.peak,1,' km/h'),fmt(team.sustained,1,' km/h'),team.events])));
    }
    const values=season.map(team=>({...team,g:avg(team.brakeG),distance:avg(team.brakeDistance),duration:avg(team.brakeDuration)}));
    const ordered=sorted(values,{brakeTeam:t=>t.team,brakeG:t=>t.g,brakeDistance:t=>t.distance,brakeDuration:t=>t.duration,brakeZones:t=>t.zones},'brakeG',-1);
    return card('Season braking performance','Only braking zones matched by lap position across the compared field are averaged. This uses observed deceleration, distance and duration—not brake pressure, which the public telemetry does not provide.',
      table([sortHeader('brakeTeam','Team'),sortHeader('brakeG','Mean deceleration',-1),sortHeader('brakeDistance','Braking distance'),sortHeader('brakeDuration','Duration'),sortHeader('brakeZones','Matched zones',-1)],ordered.map(team=>[teamLabel(team),fmt(team.g,2,' g'),fmt(team.distance,1,' m'),fmt(team.duration,2,' s'),`${team.events} circuits · ${team.zones}`])));
  }
  const event=events[0], summary=eventTelemetry(event||{}), loaded=[...summary.rows.values()];
  if(!loaded.length)return card('Telemetry comparison','Qualifying telemetry for every team is loaded automatically.','<p>No reliable telemetry is available for this event.</p>');
  if(activeMetric==='corners') {
    const common=[...new Set(Object.values(summary.groups).flat())];
    const ordered=sorted(loaded,{eventCornerTeam:r=>r.team,eventLow:r=>r.categories.low?.deficit,eventMedium:r=>r.categories.medium?.deficit,eventHigh:r=>r.categories.high?.deficit},'eventLow');
    return card('Low / medium / high-speed cornering','Shared GPS-aligned windows include braking and exit. Each corner is scored separately before the band is averaged; the band leader is 0%. Bands use field-median apex speed. Flat-out bends count as straights.',
      table([sortHeader('eventCornerTeam','Team'),sortHeader('eventLow','Low ≤120'),sortHeader('eventMedium','Medium 120–200'),sortHeader('eventHigh','High >200')],ordered.map(row=>[teamLabel(row),...['low','medium','high'].map(name=>{
        const value=row.categories[name];return value?`${fmt(value.deficit,3,'%')}<small>${fmt(value.speed,1,' km/h')} · ${value.corners} corners</small>`:'—';
      })])))+card('Corner measurements','Windows follow the field’s braking, apex and acceleration. Zone labels are used when reliable map corner numbers are unavailable.',
      table(['Corner',...loaded.map(row=>escape(row.team))],common.map(label=>[escape(label),...loaded.map(row=>{
        const corner=row.trace.corners.find(c=>c.corner===label);return corner?`${fmt(corner.time,3,' s')}<small>${fmt(corner.mean_speed,1,' km/h')} mean · ${fmt(corner.minimum,1)} min</small>`:'—';
      })])))+card('Downforce index','Unavailable: public telemetry cannot isolate aerodynamic load.','<p class="performance-note">High-speed corner performance is shown directly instead.</p>');
  }
  if(activeMetric==='straight') {
    const ordered=sorted(loaded,{eventStraightTeam:r=>r.team,eventStraightGap:r=>r.trace.straight_deficit,eventPeak:r=>r.trace.top_speed,eventSustained:r=>r.trace.full_throttle_p95},'eventStraightGap');
    return card('Straight-line performance','Time across the same measured straights, including flat-out bends. The fastest team is 0%. The lap breakdown below uses one common reference lap, so straight and corner contributions add up to the lap gap.',
      table([sortHeader('eventStraightTeam','Team'),sortHeader('eventStraightGap','Straight-time deficit'),sortHeader('eventPeak','Peak speed',-1),sortHeader('eventSustained','Sustained full-throttle speed (P95)',-1),'Representative lap'],ordered.map(row=>[teamLabel(row),fmt(row.trace.straight_deficit,3,'%'),fmt(row.trace.top_speed,1,' km/h'),fmt(row.trace.full_throttle_p95,1,' km/h'),`${escape(row.lap.driver)} L${row.lap.lap}`])))+
      card('Where the lap gap comes from',`Relative to ${escape(event.traceReference||'the fastest measured team')}’s qualifying lap. A negative contribution means time gained in that part of the lap.`,
      table(['Team','Straights','Corners','Lap gap'],ordered.map(row=>[teamLabel(row),fmt(row.trace.straight_contribution,3,'%'),fmt(row.trace.corner_contribution,3,'%'),fmt(row.trace.lap_gap,3,'%')])));
  }
  const ordered=sorted(loaded,{eventBrakeTeam:r=>r.team,eventBrakeG:r=>r.brakeG,eventBrakeDistance:r=>r.brakeDistance,eventBrakeDuration:r=>r.brakeDuration,eventBrakeZones:r=>r.brakeZones},'eventBrakeG',-1);
  return card('Braking observations','Only zones matched by lap position across the field are included. Mean deceleration comes from speed change; the public brake channel is on/off and contains no brake-pressure value.',
    table([sortHeader('eventBrakeTeam','Team'),sortHeader('eventBrakeG','Median deceleration',-1),sortHeader('eventBrakeDistance','Median distance'),sortHeader('eventBrakeDuration','Median duration'),sortHeader('eventBrakeZones','Matched zones',-1)],ordered.map(row=>[teamLabel(row),fmt(row.brakeG,2,' g'),fmt(row.brakeDistance,1,' m'),fmt(row.brakeDuration,2,' s'),row.brakeZones])));
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
  if(sort) {sortDirection=sortKey===sort.dataset.performanceSort?-sortDirection:Number(sort.dataset.sortDirection||1);sortKey=sort.dataset.performanceSort;render();}
});
