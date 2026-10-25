import {connectedRaceCornerScores,ageAdjustedRaceCornerScores} from './race-cornering.js';
import {qualifyingRepresentatives} from './corner-geometry.js';
import {fastestTeamTelemetrySelections} from './qualifying-telemetry.js';
import {SPEED_DOMAIN_METRICS,speedDomainSeason,speedDomainEventValues,speedDomainPhases} from './speed-domain.js';
// APEX - Car Performance Section
// Full parity with Session Analysis design language: Apple UI, official team logos, GP country flags, custom select menus.
// Scientific rigor aligned with Astra GPT-6 Hybrid principles: no speculative physical regressions, sampling-aware bounds.

import {$,escape,finite,avg,median,percentile,summarize,middle50Label,fmt,color,signed} from './performance-format.js';
import {VERIFIED_DRY_ALLOCATIONS,TYRE_ALLOCATION_SOURCES,verifiedDryGrade,grandPrixCountryCode,teamLabel} from './performance-identity.js';

function rebase(rows, keys) {
  for(const key of keys) {
    const values=rows.map(row=>row[key]).filter(finite);
    if(!values.length)continue;
    const best=Math.min(...values);
    for(const row of rows)if(finite(row[key]))row[key]=Math.max(0,((100+row[key])/(100+best)-1)*100);
  }
  return rows;
}

async function get(path, signal, cache='default') {
  const measured=/^\/api\/(race|qualifying)-corners/.test(path);
  if(refreshPerformance&&!refreshedPaths.has(path)){refreshedPaths.add(path);path+=(path.includes('?')?'&':'?')+(measured?'refresh=1':'fresh=true');}
  if(measured&&window.apexMeasurementRequest)return window.apexMeasurementRequest(path,signal);
  if(window.apexDataRequest&&!path.startsWith('/api/race-corners'))return window.apexDataRequest(path,signal);
  for(let attempt=0;attempt<4;attempt++) {
    try {
      const response=await fetch(path.startsWith('/api/race-corners')?path:'/api/data?'+new URLSearchParams({path}), {signal,cache});
      const payload=await response.json().catch(()=>{if(!response.ok)return {};const error=new Error('API returned an invalid response');error.status=502;throw error;});
      if(response.ok)return payload;
      const error=new Error(typeof payload.detail==='string'?payload.detail:`Request failed (${response.status})`);
      error.status=response.status;throw error;
    } catch(error) {
      if(signal?.aborted||error.name==='AbortError'||attempt===3||error.status&&!([408,429,502,503,504].includes(error.status)))throw error;
      await new Promise((resolve,reject)=>{
        const abort=()=>{clearTimeout(timer);reject(signal.reason||new DOMException('Stopped','AbortError'));};
        const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},1000*2**attempt);
        signal?.addEventListener('abort',abort,{once:true});
        if(signal?.aborted)abort();
      });
    }
  }
}

function performanceSessionTime(value) {
  if(!value)return NaN;
  const text=String(value).trim();
  const iso=text.replace(/^(\d{4}-\d{2}-\d{2}) /,'$1T');
  return Date.parse(/^\d{4}-\d{2}-\d{2}T/.test(iso)&&!/(Z|[+-]\d{2}:?\d{2})$/i.test(iso)?iso+'Z':iso);
}
function completed(event, session, now=Date.now()) {
  const status=String(event.session_statuses?.[session]||'').toLowerCase();
  if(['completed','finished','final','ended'].includes(status))return true;
  if(['live','started','running','in_progress','interrupted','suspended','cancelled','canceled','aborted','upcoming'].includes(status))return false;
  const end=performanceSessionTime(event.session_end_dates?.[session]);
  return Number.isFinite(end)&&end<=now;
}
function sessionAvailable(event, session, now=Date.now()) {
  const status=String(event.session_statuses?.[session]||'').toLowerCase();
  if(['cancelled','canceled','aborted'].includes(status))return false;
  if(completed(event,session,now)||['live','started','running','in_progress','interrupted','suspended'].includes(status))return true;
  const start=performanceSessionTime(event.session_dates?.[session]);
  // Permission to request observations, not a promise that the source has
  // already published usable laps. A stale "upcoming" flag cannot add a delay.
  return Number.isFinite(start)&&start<=now;
}
function provisionalPerformanceSessions(items,now=Date.now()) {
  return items.flatMap(event=>['Q','R','S'].flatMap(code=>{
    if(!event[code])return [];
    const label=code==='Q'?'Qualifying':code==='S'?'Sprint':'Race';
    return !completed(event,label,now)||event[code].complete===false||event[code].data_complete===false
      ? [`${event.name} · ${label}`] : [];
  }));
}

function syncSelect(select) {
  if (!select) return;
  const shell = select.closest('.select-shell');
  if (shell && shell.dataset.enhanced !== 'true' && typeof window.enhanceSelect === 'function') {
    window.enhanceSelect(select);
  }
  if (typeof window.syncSelectUI === 'function') {
    window.syncSelectUI(select);
  }
}

let initialized=false, calendar=[], calendarInventory=[], calendarLoading=false,calendarController, controller, pitController, generation=0;
let events=[], errors=[], activeMetric='pace', running=false, traceRunning=false, sortKey='qualy', sortDirection=1;
let pitRunning=false,traceController=null;
const telemetryAttempts=new WeakMap();
const raceCornerAttempts=new Map();
function firstTelemetryAttempt(event,key,automatic){
  const attempts=telemetryAttempts.get(event)||new Map();
  if(automatic&&attempts.get(key)===generation)return false;
  attempts.set(key,generation);telemetryAttempts.set(event,attempts);return true;
}
let activeScope='season'; // 'season' | 'tracks'
let selectedTracks=new Set();
let context=null;
// Shareable URL state (see the url-state.js section below).
let calendarReady=null,restoringUrl=false,restoringView=false;
let refreshPerformance=false,refreshedPaths=new Set();
let tyreView='OVERALL';
let tyreMetric='age'; // 'age' | 'relative'
let tyreSubject='team'; // 'team' | 'driver'
let pitSubject='team'; // 'team' | 'driver'
let pitMeasure='stop'; // 'stop' | 'lane'
let pitChartMetric='median'; // 'mean' | 'median' | 'spread'
let pitLaneBasis='raw'; // 'raw' | 'event'
let paceSeasonStat='mean'; // 'mean' | 'median'
const racePaceModel='nonlinear';
const telemetrySeasonStat='mean'; // 'mean' | 'median'
let cornerGraphBand='all';
let cornerSession='qualy',telemetrySubject='team',qualifyingMetricsRunning=false,qualifyingMetricsController=null;
const raceCornerModel='matched';
// 'speed': equal-speed comparison (car_physics.py, default); 'window': established window timing.
// Loading is tracked per subject so switching Teams/Drivers never waits on the other.
let speedDomainMethod='speed',speedDomainRunning={team:false,driver:false},speedDomainController={team:null,driver:null};
function telemetrySubjectControls() {
  return `<div class="performance-scope-toggle" role="group" aria-label="Telemetry subject">${[['team','Teams'],['driver','Drivers']].map(([key,label])=>`<button type="button" data-telemetry-subject="${key}" aria-pressed="${telemetrySubject===key}">${label}</button>`).join('')}</div>`;
}
function cornerSessionControls() {
  return `<div class="performance-scope-toggle" role="group" aria-label="Cornering session">${[['qualy','Qualifying'],['race','Race']].map(([key,label])=>`<button type="button" data-corner-session="${key}" aria-pressed="${cornerSession===key}">${label}</button>`).join('')}</div>`;
}
async function loadQualifyingMetrics(retry=false,automatic=false) {
  if(qualifyingMetricsRunning||!context||activeMetric==='corners'&&cornerSession==='race')return;
  const subject=telemetrySubject,wantCorners=activeMetric==='corners',id=generation,year=context.year;
  const jobs=events.filter(e=>e.Q&&(!(wantCorners?e.cornerSubjects?.[subject]:e.driverTelemetryReady)||retry)
    &&firstTelemetryAttempt(e,(wantCorners?'corners:':'telemetry:')+subject,automatic));
  if(!jobs.length)return;
  qualifyingMetricsController=new AbortController();const signal=qualifyingMetricsController.signal;
  qualifyingMetricsRunning=true;render();
  async function worker(){while(jobs.length&&!signal.aborted){
    const event=jobs.shift();
    updateStatus(`Qualifying ${wantCorners?'corners':'driver telemetry'} · ${event.name} · ${subject}…`,true);
    try{
      if(wantCorners){
        const p=new URLSearchParams({year,gp:event.name,round:event.round,subject,...(retry?{refresh:'1'}:{})});
        const measured=await get('/api/qualifying-corners?'+p,signal);
        if(id!==generation||signal.aborted)return;
        if(subject==='driver')event.qualifyingDrivers=measured.entrants;
        event.cornerMeasurements ||= {};event.cornerMeasurements[subject]={};
        event.cornerLegacyMeasurements ||= {};event.cornerLegacyMeasurements[subject]={};
        for(const entity of measured.entrants||[]){
          const trace=measured.traces?.[entity.driver];
          event.cornerMeasurements[subject][entity.team]=trace?{...trace,corner_selection:trace.selection}:
            {selection:entity.lap,corners:[],categories:{},corner_contribution:null,corner_missing:['Native lap or circuit geometry unavailable']};
          const old=measured.legacyTraces?.[entity.driver];
          event.cornerLegacyMeasurements[subject][entity.team]=old?{...old,corner_selection:old.selection}:event.cornerMeasurements[subject][entity.team];
        }
        event.cornerSubjects ||= {};event.cornerSubjects[subject]=measured.complete;
        event.cornerAudit ||= {};event.cornerAudit[subject]={expected:(measured.markers||[]).map(z=>z.corner),
          bands:(measured.markers||[]).map(z=>({corner:z.corner,band:z.band,speed:z.speed,apexMethod:z.apexMethod,
            apexConfidence:z.apexConfidence,apexShiftMetres:z.apexShiftMetres,apexReason:z.apexReason})),error:measured.error,
          entries:measured.received,requested:measured.requested,
          requestErrors:(measured.requestErrors||[]).map(e=>e.driver+': '+e.reason),
          incomplete:(measured.entrants||[]).filter(e=>!measured.traces?.[e.driver]||measured.traces[e.driver].corner_missing?.length).map(e=>e.team)};
      }else{
        const base=new URLSearchParams({year,gp:event.name,round:event.round,session:'Q'});
        event.qualifyingSession ||= await get('/api/session?'+base,signal);
        const session={...event.qualifyingSession,year,event:event.name};
        const rows=qualifyingRepresentatives(session,subject,event.Q.teams);
        const identities=rows.map(row=>({team:row.driver.code,color:row.driver.team_color,displayName:row.driver.name,
          logoTeam:row.driver.team,driver:row.driver.code,lap:{driver:row.driver.code,number:row.driver.number,
            lap:row.lap,time:row.time,start:row.lap_start_seconds,end:row.lap_end_seconds,
            sectors:[row.s1,row.s2,row.s3],phase:row.phase,compound:row.compound}}));
        event.qualifyingDrivers=identities;
        const windows=identities.map(t=>({...t.lap,team:t.team,team_name:t.team,driver_number:t.lap.number,
          qualifying_best_time:t.lap.time,qualifying_best_driver:t.lap.driver,qualifying_best_lap:t.lap.lap}));
        const batch=windows.length>=3?await get('/api/performance/trace-batch?'+new URLSearchParams({year,gp:event.name,windows:JSON.stringify(windows)}),signal):{teams:{}};
        if(id!==generation||signal.aborted)return;
        event.driverTraces=batch.teams||{};event.driverTraceExcluded=batch.excluded||{};
        if(batch.speed_domain?.cars)(event.speedDomain ||= {}).driver=batch.speed_domain;
        event.driverTelemetryReady=!batch.error&&!Object.keys(event.driverTraceExcluded).length;
        event.driverNativeSpeedObservations=batch.native_speed_observations||{};
        for(const trace of Object.values(event.driverTraces)){trace.braking_selection_policy='fastest-qualifying-lap-only';trace.braking_selection ||= trace.selection;}
      }
      delete event.qualifyingMetricsError;
    }catch(error){if(signal.aborted)return;event.qualifyingMetricsError=error.message;}
    scheduleRender();
  }}
  try{await Promise.all([worker(),worker()]);}
  finally{if(id===generation){qualifyingMetricsRunning=false;updateStatus(signal.aborted?'Qualifying stopped; supported data retained.':'Qualifying updated. Cached measurements are reused; unsupported windows remain disclosed.');render();if(!signal.aborted)loadActiveTelemetry();}}
}
let raceCornerRunning=false,raceCornerController=null;
const raceCornerCache=new Map();
async function loadRaceCorners(automatic=false) {
  if(raceCornerRunning||!context)return;
  const id=generation,year=context.year,subject=telemetrySubject,model=typeof raceCornerModel==='undefined'?'matched':raceCornerModel;
  const suffix=model==='matched'?'':':'+model,extra=model==='matched'?{}:{model};
  const jobs=events.filter(e=>e.R&&!raceCornerCache.get(year+':'+e.name+':'+subject+suffix)?.complete
    &&(!automatic||raceCornerAttempts.get(year+':'+e.name+':'+subject+suffix)!==id));
  if(!jobs.length)return;
  raceCornerController=new AbortController();const signal=raceCornerController.signal;
  raceCornerRunning=true;let sourcePaused=false;render();
  try {
    for(const event of jobs){
      const key=year+':'+event.name+':'+subject+suffix;if(raceCornerCache.get(key)?.complete)continue;
      raceCornerAttempts.set(key,id);
      updateStatus(`Race cornering · matching laps at ${event.name}…`,true);
      const observations=[],legacyObservations=[],requestErrors=[];let entrants=[],sourceCoverage=null,lastPaint=0;
      try {
        const cached=await get('/api/race-corners?'+new URLSearchParams({year,gp:event.name,round:event.round,subject,cached:'1',...extra}),signal);
        entrants=cached.entrants||[];
        sourceCoverage=cached.source_coverage?{...cached.source_coverage,timingLaps:cached.plan?.timingLaps,eligibleLaps:cached.plan?.conditionEligibleLaps}:null;
        const groups=cached.groups||[];
        if(!groups.length)requestErrors.push('No matched clean race laps: check green-flag, traffic, compound and tyre-age support.');
        // Show every cached snapshot first: a cold source request must not hold
        // already-verified comparisons behind the worker queue.
        const cachedGroups=new Set();let finished=0;
        try{
          for(const hit of cached.snapshots||[]){
            if(!groups.some(g=>g.lap===hit.lap&&g.compound===hit.compound&&g.cohort===hit.cohort)||!hit.snapshot?.complete)continue;
            cachedGroups.add(hit.lap+':'+hit.compound+':'+hit.cohort);observations.push(...hit.snapshot.observations||[]);finished++;
            legacyObservations.push(...hit.snapshot.legacyObservations||[]);
          }
          if(id!==generation||signal.aborted)return;
          raceCornerCache.set(key,{observations:[...observations],legacyObservations:[...legacyObservations],entrants,sourceCoverage,groups:groups.length,finished,complete:groups.length>0&&finished===groups.length,requestErrors:[]});render();
        }catch(error){if(signal.aborted)throw error;}
        const jobs=[...groups.entries()].filter(([,g])=>!cachedGroups.has(g.lap+':'+g.compound+':'+g.cohort));
        async function snapshotWorker(){while(jobs.length){const [index,group]=jobs.shift();
          if(signal.aborted||id!==generation)return;
          updateStatus(`Race cornering · ${event.name} · snapshot ${index+1}/${groups.length} · L${group.lap} ${group.compound.toLowerCase()}…`,true);
          try{
            const snapshot=await get('/api/race-corners?'+new URLSearchParams({year,gp:event.name,round:event.round,lap:group.lap,compound:group.compound,cohort:group.cohort,subject,...extra}),signal);
            observations.push(...snapshot.observations||[]);requestErrors.push(...snapshot.requestErrors||[]);
            if(snapshot.sourcePaused){sourcePaused=true;jobs.length=0;requestErrors.push('Native source rate limited; retry after one minute. Completed cached observations are retained.');}
            legacyObservations.push(...snapshot.legacyObservations||[]);
            if(!snapshot.complete)requestErrors.push(`L${group.lap}: ${snapshot.reason||'Incomplete matched telemetry'}`);
          }catch(error){if(signal.aborted)throw error;requestErrors.push('L'+group.lap+': '+error.message);}
          if(id!==generation)return;
          // Publish each supported snapshot immediately, not after the last GP.
          finished++;raceCornerCache.set(key,{observations:[...observations],legacyObservations:[...legacyObservations],entrants,sourceCoverage,groups:groups.length,finished,complete:false,requestErrors:[...requestErrors]});
          if(Date.now()-lastPaint>=250){lastPaint=Date.now();render();}
        }}
        await Promise.all([snapshotWorker(),snapshotWorker()]);
        if(id!==generation||signal.aborted)return;
        raceCornerCache.set(key,{observations,legacyObservations,entrants,sourceCoverage,groups:groups.length,finished,complete:requestErrors.length===0,requestErrors});
      } catch(error){if(signal.aborted)break;raceCornerCache.set(key,{observations,legacyObservations,entrants,sourceCoverage,complete:false,error:error.message,requestErrors});}
      render();
    }
  } finally {
    if(id!==generation)return;
    raceCornerRunning=false;
    updateStatus(signal.aborted?'Race cornering stopped; completed observations retained.':sourcePaused?'Race source busy. Cached results retained; retry after one minute.':'Race cornering · available groups processed and cached.');
    render();
    if(!signal.aborted)loadActiveTelemetry();
  }
}

const raceCornerFitCache=new WeakMap();
function renderRaceCorners() {
  const adjustedAge=typeof raceCornerModel!=='undefined'&&raceCornerModel==='age-adjusted';
  const cacheKey=e=>context.year+':'+e.name+':'+telemetrySubject+(adjustedAge?':age-adjusted':'');
  const pending=events.filter(e=>e.R&&!raceCornerCache.get(cacheKey(e))?.complete);
  const reports=events.filter(e=>e.R).map(event=>{
    const cached=raceCornerCache.get(cacheKey(event));
    const source=cached?.observations||[];
    const observations=source.map(o=>({...o,logoTeam:o.team,displayName:telemetrySubject==='driver'?o.driver:o.team,team:telemetrySubject==='driver'?o.driver:o.team})),rows=new Map();
    // Fit only the visible band and reuse it until observations or controls
    // change. Display/sort interactions must not refit four whole races.
    let fits=raceCornerFitCache.get(source);if(!fits){fits=new Map();raceCornerFitCache.set(source,fits);}
    const fitKey=[cornerGraphBand,telemetrySubject,telemetrySeasonStat,adjustedAge].join(':');
    if(!fits.has(fitKey))fits.set(fitKey,adjustedAge?ageAdjustedRaceCornerScores(observations,cornerGraphBand,telemetrySubject):connectedRaceCornerScores(observations,cornerGraphBand,telemetrySubject,telemetrySeasonStat));
    const model=fits.get(fitKey);
    for(const team of [...new Set(observations.map(o=>o.team))]){
      const own=observations.filter(o=>o.team===team),values={};
      values[cornerGraphBand]=model.scores.get(team);
      rows.set(team,{team,color:own[0].color,displayName:own[0].displayName,logoTeam:own[0].logoTeam,values,samples:new Set(own.map(o=>o.driver+':'+o.lap)).size,
        comparisons:model.support.get(team)||0,drivers:[...new Set(own.map(o=>o.driver))].join(', ')});
    }
    return {event,summary:{rows},model};
  });
  const season=connectedRaceCornerScores(reports.flatMap(({event,summary})=>[...summary.rows.values()].map(row=>({...row,snapshot:event.name}))),cornerGraphBand,'team',telemetrySeasonStat),adjusted=season.scores;
  const teams=new Map();
  for(const {event,summary} of reports)for(const row of summary.rows.values()){
    if(!teams.has(row.team))teams.set(row.team,{...row,events:0,samples:0,comparisons:0});
    const t=teams.get(row.team);t.events++;t.samples+=row.samples;t.comparisons+=row.comparisons;
  }
  for(const event of events)for(const entry of raceCornerCache.get(cacheKey(event))?.entrants||[])if(!teams.has(entry.team))
    teams.set(entry.team,{...entry,values:{},events:0,samples:0,comparisons:0});
  const rows=[...teams.values()].map(t=>({...t,gap:adjusted.get(t.team)}));
  const visibleSupport=rows.length?`${rows.filter(r=>finite(r.gap)).length} of ${rows.length} ${telemetrySubject==='driver'?'drivers':'teams'} connected by matched comparisons. Scores are estimated through overlapping rivals, not a direct all-field test. ${raceCornerRunning?'Still collecting snapshots; rankings can change.':rows.some(r=>r.samples<3)?'Sparse results remain provisional.':'Driver, tyre and traffic effects remain.'}`:raceCornerRunning?'Matched race telemetry is loading. Valid snapshots appear as soon as they are ready.':running?'Waiting for the race session before matching corners.':'No supported matched race snapshots yet. Use Calculate matched race corners or inspect the missing-data details below.';
  // Rendered by src/views/RaceCornersView.tsx; data-corner-band / data-race-corners-* buttons are handled below.
  return reactView('race-corners',{band:cornerGraphBand,
    action:raceCornerRunning?'stop':pending.length?(rows.length?'load-remaining':'calculate'):null,
    support:visibleSupport,
    coverage:reports.map(({event})=>{const c=raceCornerCache.get(cacheKey(event))?.sourceCoverage;return c?`${event.name} · ${c.kind==='live-native-with-retained-fallback'?`${c.plannedDriverLaps} selected native driver-laps across the race · ${c.laps} retained fallback laps`:`${c.laps} native driver-laps available`}${finite(c.timingLaps)?' · '+c.timingLaps+' timing records':''}. ${c.message}`:null;}).filter(Boolean),
    ageModel:adjustedAge?`Separate model: same race lap, compound and physical corner, with a fitted shared compound-age slope. Driver and age effects must be independently identifiable across at least three race laps. This is not matched-condition evidence. ${reports.filter(r=>r.model.reason).map(r=>r.event.name+': '+r.model.reason).join(' · ')}`:null,
    chart:{rows,options:{title:`${cornerGraphBand==='all'?'All corners':cornerGraphBand+'-speed corners'} · average time gap per corner`,valueKey:'gap',unit:' s',digits:3,signedValue:true,zeroBaseline:true}},
    sort:{team:sortHeaderModel('raceCornerTeam',telemetrySubject==='driver'?'Driver':'Team'),gap:sortHeaderModel('raceCornerGap','Gap / corner'),gps:sortHeaderModel('raceCornerGPs','GPs',-1),samples:sortHeaderModel('raceCornerSamples','Driver-laps',-1)},
    rows:sorted(rows,{raceCornerTeam:r=>r.team,raceCornerGap:r=>r.gap,raceCornerGPs:r=>r.events,raceCornerSamples:r=>r.samples},'raceCornerGap')
      .map(r=>({team:r,gap:finite(r.gap)?r.gap:null,events:r.events,samples:r.samples,comparisons:r.comparisons})),
    snapshots:reports.flatMap(({event})=>(raceCornerCache.get(cacheKey(event))?.observations||[]).map(o=>({event:event.name,team:String(o.team),driver:String(o.driver),lap:o.lap,
      compound:String(o.compound),age:o.tyreAge,corners:o.corners,alignment:String(o.alignment||o.geometrySource||'Approximate')}))),
    problems:reports.flatMap(r=>{const cached=raceCornerCache.get(cacheKey(r.event));return cached?[cached.error,...cached.requestErrors||[]].filter(Boolean).map(reason=>r.event.name+' · '+reason):[];})});
}
let telemetryCoverageMode='common';
const tyreSeasonStat='median'; // 'mean' | 'median' | 'p75'
const tyreFitMode='curve',tyreCoverageMode='available';
const tyreLapMode='all'; // 'all' | 'clear'
const tyreConditionMode='screened';
const pitVisitMode='service';
let tyreCorrection='fuel'; // 'fuel' | 'raw'
const tyreFuelRate=.060; // Fixed disclosed assumption, not measured fuel.
const tyreWeighting='balanced'; // 'balanced' | 'laps'
let tyreRunKey='';
let tyreShowExcluded=false;
let tyrePlotTeam='',tyrePlotDriver='',tyrePlotEvent='';
let resultsChartMetric='points'; // 'points' | 'perStart' | 'finishRate' | 'mechanicalRate'
let trendView='observed';
let showPerformanceDescriptions=window.ApexAnalysis?.preference('descriptions',false)===true;
const tableSortStates=new Map();
const tableSortGroups=new Map();
const lazyEvidence=new Map();
// Default 'adjusted': teams knocked out in Q1 have no access to the 0.7-1.3 s
// of track evolution Q3 runners get (2026), so raw fastest laps overstate their gaps.
let qualyPaceMode='adjusted'; // 'overall' | 'q1' | 'adjusted'
const root=$('performanceResults');
window.addEventListener('apex-descriptions',event=>{showPerformanceDescriptions=event.detail===true;if(initialized)render();});

function updateTrackCount() {
  const countEl = $('performanceTrackCount');
  if (countEl) {
    const n = selectedTracks.size;
    countEl.textContent = `${n} selected`;
  }
  const loadBtn = $('performanceLoad');
  if (loadBtn) {
    loadBtn.disabled = !calendar.length || (activeScope === 'tracks' && selectedTracks.size === 0);
  }
}

function renderTrackPills() {
  const container = $('performanceTrackPills');
  if (!container) return;
  if (!calendar.length) {
    container.innerHTML = `<span class="performance-note" style="margin:0;">${calendarLoading?'Loading race calendar…':'No qualifying sessions have started yet.'}</span>`;
    updateTrackCount();
    return;
  }
  container.innerHTML = calendar.map(e => {
    const code = grandPrixCountryCode(e);
    const flagHtml = code ? `<img class="gp-flag" src="assets/flags/${code.toLowerCase()}.svg" alt="${code}" width="18" height="13">` : '';
    const isSelected = selectedTracks.has(e.name);
    return `<button type="button" class="track-pill" data-track-name="${escape(e.name)}" aria-pressed="${isSelected}">
      ${flagHtml}
      <span class="track-round">R${e.round}</span>
      <span class="track-name">${escape(e.name)}</span>
    </button>`;
  }).join('');
  updateTrackCount();
}

async function loadCalendar() {
  calendarController?.abort(); calendarController=new AbortController();
  const signal=calendarController.signal;
  calendarInventory=[];
  calendarLoading=true;updateStatus('Loading race calendar…',true);renderTrackPills();
  $('performanceLoad').disabled=true;
  if ($('performanceEvent')) {
    $('performanceEvent').innerHTML='<option>Loading calendar…</option>';
    syncSelect($('performanceEvent'));
  }
  try {
    calendarInventory=await get(`/api/events?year=${$('performanceYear').value}`,signal);
    calendar=calendarInventory.filter(e=>sessionAvailable(e,'Qualifying'));
    if ($('performanceEvent')) {
      $('performanceEvent').innerHTML=calendar.map(e=>{
        const country = grandPrixCountryCode(e) || '';
        return `<option value="${escape(e.name)}" data-country="${country}">R${e.round} · ${escape(e.name)}</option>`;
      }).join('');
      $('performanceEvent').value=calendar.at(-1)?.name || '';
      syncSelect($('performanceEvent'));
    }
    calendarLoading=false;renderTrackPills();
    updateStatus(calendar.length ? 'Ready. Data loads only when you choose Analyse; live or incomplete results are provisional.' : 'No qualifying sessions have started yet for this season.');
    updateTrackCount();
  } catch(e) {
    if(signal.aborted) return;
    calendarLoading=false;renderTrackPills();
    updateStatus(`Calendar unavailable: ${e.message}. Change season to retry.`);
    if ($('performanceEvent')) {
      $('performanceEvent').innerHTML='<option>Calendar unavailable</option>';
      syncSelect($('performanceEvent'));
    }
  }
}

function updateStatus(msg, isRunning = false) {
  const el = $('performanceStatus');
  const card = $('performanceStatusCard');
  if (el) el.textContent = msg;
  if (card) card.classList.toggle('is-running', isRunning);
}

function stop() {
  traceController?.abort();
  qualifyingMetricsController?.abort();
  raceCornerController?.abort();
  for(const key of ['team','driver']){speedDomainController[key]?.abort();speedDomainRunning[key]=false;}
  controller?.abort(); pitController?.abort(); generation++; running=false; traceRunning=false; pitRunning=false;
  $('performanceCancel').hidden=true;
  $('performanceLoad').hidden=false;
  updateTrackCount();
  updateStatus('Stopped. Completed results remain visible.', false);
  render();
}

function reset() {
  stop(); events=[]; errors=[]; context=null; root.replaceChildren();
  updateStatus('Selection changed. Choose Analyse to load fresh results.', false);
  render();
}

function refreshPerformanceAvailability() {
  if(calendarLoading||!calendarInventory.length)return;
  const next=calendarInventory.filter(e=>sessionAvailable(e,'Qualifying'));
  if(next.length===calendar.length&&next.every((e,i)=>e===calendar[i]))return;
  calendar=next;
  renderTrackPills();
}
// Only re-evaluate the already-loaded schedule; no speculative data fetches.
// This avoids permanently hiding a newly started session in an open tab.
window.setInterval?.(()=>{
  if(initialized&&!$('carPerformance').hidden&&!running&&!document.hidden)refreshPerformanceAvailability();
},15000);

async function analyse(refresh=false) {
  refreshPerformanceAvailability();
  traceController?.abort();
  refreshPerformance=refresh===true;refreshedPaths.clear();
  if(refreshPerformance)raceCornerCache.clear();
  qualifyingMetricsController?.abort();
  raceCornerController?.abort();
  for(const key of ['team','driver']){speedDomainController[key]?.abort();speedDomainRunning[key]=false;}
  controller?.abort(); pitController?.abort(); pitRunning=false; controller=new AbortController(); const signal=controller.signal, id=++generation;
  traceRunning=false;qualifyingMetricsRunning=false;raceCornerRunning=false;
  events=[]; errors=[]; running=true;
  const isSeason = activeScope === 'season';
  const picked = isSeason
    ? [...calendar]
    : calendar.filter(e => selectedTracks.has(e.name));

  context = {
    year: $('performanceYear').value,
    scope: activeScope,
    season: isSeason || picked.length > 1,
    singleTrack: picked.length === 1,
    selectedTracks: [...selectedTracks]
  };

  const jobs=picked.flatMap(event=>['Q','R','S'].filter(s=>s==='Q'||sessionAvailable(event,s==='S'?'Sprint':'Race')).map(session=>({event,session})));
  const total=jobs.length;
  let done=0;
  $('performanceLoad').disabled=true; $('performanceLoad').hidden=true; $('performanceCancel').hidden=false;
  updateStatus(`Analysing ${context.year} · starting session retrieval…`, true);
  render();
  // Pit timing is independent of qualifying/race laps and telemetry. Fetch it
  // immediately when that view is open, rather than waiting for every trace.
  if(activeMetric==='pits') loadPitData();
  if((activeMetric==='corners'&&cornerSession==='qualy')||telemetrySubject==='driver'&&['straight','braking'].includes(activeMetric))void loadQualifyingMetrics();

  async function worker() {
    while(jobs.length && !signal.aborted) {
      const job=jobs.shift();
      updateStatus(`Analysing ${context.year} · ${done}/${total} session results received · ${job.event.name}`, true);
      try {
        const params=new URLSearchParams({year:context.year,gp:job.event.name,session:job.session,...(job.session==='S'?{round:job.event.round}:{})});
        // Sprint classification only: never feed sprint laps into race pace,
        // tyre trends or race reliability denominators.
        const data=await get(`${job.session==='S'?'/api/performance/sprint':'/api/performance'}?${params}`,signal);
        if(id!==generation) return;
        let item=events.find(e=>e.name===job.event.name);
        if(!item) { item={...job.event,traces:{}}; events.push(item); }
        item[job.session]=data;
      } catch(e) { if(signal.aborted) return; errors.push({...job,message:e.message}); }
      done++; scheduleRender();loadActiveTelemetry();
    }
  }

  await Promise.all([worker(),worker(),worker(),worker()]);
  if(id!==generation) return;

  running=false;$('performanceLoad').disabled=false;$('performanceLoad').hidden=false;$('performanceCancel').hidden=true;
  updateStatus(`${context.year} · ${events.length}/${picked.length} events with data. Cached results are reused; telemetry loads only for the selected category.`,false);
  render();
  if(activeMetric==='pits')loadPitData();
  loadActiveTelemetry();
  // Prefetch the car-telemetry measurements in the background so Cornering,
  // Straight line and Braking are usually ready by the time they are opened.
  if(!speedDomainActive())void loadSpeedDomain(true);
}

function speedDomainActive() {
  return speedDomainMethod==='speed'&&(activeMetric==='braking'||activeMetric==='straight'||activeMetric==='corners'&&cornerSession==='qualy');
}
// Speed-domain metrics come from the same trace-batch as straight line and
// braking: the fastest qualifying lap per team (or per driver).
function driverSelectionsFromQualifying(teams) {
  const best=new Map();
  for(const team of teams||[])for(const p of team.phase_details||[]){
    if(!finite(p.time)||!finite(p.start)||!finite(p.end)||p.lap==null||p.number==null||!p.driver)return null;
    if(!best.has(p.driver)||p.time<best.get(p.driver).time)best.set(p.driver,{...p,teamName:team.team,color:team.color});
  }
  return best.size>=3?[...best.values()]:null;
}
async function loadSpeedDomain(automatic=false) {
  if(!context||speedDomainRunning[telemetrySubject])return;
  const subject=telemetrySubject,id=generation,year=context.year;
  const jobs=events.filter(e=>e.Q&&!e.speedDomain?.[subject]&&firstTelemetryAttempt(e,'speed-domain:'+subject,automatic));
  if(!jobs.length)return;
  speedDomainController[subject]=new AbortController();const signal=speedDomainController[subject].signal;
  speedDomainRunning[subject]=true;render();
  async function worker(){while(jobs.length&&!signal.aborted){const event=jobs.shift();
    updateStatus(`Speed-domain metrics · ${event.name} · ${subject}…`,true);
    try{
      let windows;
      if(subject==='team')windows=fastestTeamTelemetrySelections(event.Q.teams);
      else if(driverSelectionsFromQualifying(event.Q.teams)){
        // Each driver's fastest qualifying lap is already in the qualifying
        // analysis; loading the whole session again cost ~20 s per GP cold.
        const picked=driverSelectionsFromQualifying(event.Q.teams);
        event.qualifyingDrivers ||= picked.map(p=>({team:p.driver,color:p.color,displayName:p.driver,logoTeam:p.teamName,driver:p.driver}));
        windows=picked.map(p=>({driver:p.driver,number:p.number,lap:p.lap,time:p.time,start:p.start,end:p.end,sectors:p.sectors,phase:p.phase,
          compound:p.compound,team:p.driver,team_name:p.driver,driver_number:p.number,qualifying_best_time:p.time,qualifying_best_driver:p.driver,qualifying_best_lap:p.lap}));
      }
      else{
        const base=new URLSearchParams({year,gp:event.name,round:event.round,session:'Q'});
        event.qualifyingSession ||= await get('/api/session?'+base,signal);
        const identities=qualifyingRepresentatives({...event.qualifyingSession,year,event:event.name},subject,event.Q.teams).map(row=>({team:row.driver.code,
          color:row.driver.team_color,displayName:row.driver.name,logoTeam:row.driver.team,driver:row.driver.code,lap:{driver:row.driver.code,number:row.driver.number,
          lap:row.lap,time:row.time,start:row.lap_start_seconds,end:row.lap_end_seconds,sectors:[row.s1,row.s2,row.s3],phase:row.phase,compound:row.compound}}));
        event.qualifyingDrivers ||= identities;
        windows=identities.map(t=>({...t.lap,team:t.team,team_name:t.team,driver_number:t.lap.number,
          qualifying_best_time:t.lap.time,qualifying_best_driver:t.lap.driver,qualifying_best_lap:t.lap.lap}));
      }
      if(windows.length<3)throw new Error('Fewer than three qualifying laps have exact timing boundaries.');
      // Speed-only: skip the retired window-timing alignment on the server.
      const result=await get('/api/performance/trace-batch?'+new URLSearchParams({year,gp:event.name,windows:JSON.stringify(windows),measures:'speed'}),signal);
      if(id!==generation||signal.aborted)return;
      if(!Object.keys(result.speed_domain?.cars||{}).length)throw new Error(result.speed_domain?.error||result.error||'Qualifying telemetry returned no measured entrants. Retry this GP when the source is available.');
      (event.speedDomain ||= {})[subject]=result.speed_domain;
      delete event.speedDomainError;
    }catch(error){if(signal.aborted)return;event.speedDomainError=error.message;}
    scheduleRender();
  }}
  try{await Promise.all([worker(),worker()]);}
  // A subject or tab switch during this run was refused above; start whatever
  // the page needs now, or the new view would wait forever.
  finally{if(id===generation){speedDomainRunning[subject]=false;updateStatus(signal.aborted?'Speed-domain loading stopped; measured GPs retained.':'Speed-domain metrics updated. Results are cached.');render();if(!signal.aborted)loadActiveTelemetry();}}
}
function loadActiveTelemetry() {
  if(!context)return;
  if(speedDomainActive())return void loadSpeedDomain(true);
  if(activeMetric==='corners'&&cornerSession==='race')void loadRaceCorners(true);
}

async function loadPitData(retry=false) {
  if(pitRunning || !context) return;
  const picked=context.scope==='season'
    ? calendar
    : calendar.filter(e=>context.selectedTracks.includes(e.name));
  for(const event of picked.filter(e=>sessionAvailable(e,'Race'))) {
    if(!events.some(e=>e.name===event.name)) events.push({...event,traces:{}});
  }
  if(retry) for(const event of events) {
    delete event.pitError;
    if(event.pits?.stationary_status!=='complete')delete event.pits;
  }
  const jobs=events.filter(e=>sessionAvailable(e,'Race') && !e.pits && !e.pitError);
  if(!jobs.length) return;
  pitController?.abort(); pitController=new AbortController();
  const signal=pitController.signal, id=generation;
  pitRunning=true; render();
  async function worker() {
    while(jobs.length && !signal.aborted && id===generation) {
      const event=jobs.shift();
      try {
        const params=new URLSearchParams({year:context.year,gp:event.name,source:'dhl-fallback-v2'});
        if(retry)params.set('fresh','true');
        event.pits=await get(`/api/performance/pits?${params}&schema=3`,signal,retry?'no-store':'default');
      } catch(error) {
        if(signal.aborted) return;
        event.pitError=error.message;
      }
      if(id===generation) render();
    }
  }
  await Promise.all([worker(),worker(),worker()]);
  if(id===generation) {pitRunning=false;render();}
}

function qualifyingEvolutionSample(teams) {
  const dry=new Set(['SOFT','MEDIUM','HARD','HYPERSOFT','ULTRASOFT','SUPERSOFT','SUPERHARD']);
  const details=teams.flatMap(t=>(t.phase_details||[]).map(p=>({...p,team:t.team})))
    .filter(p=>finite(p.time)&&dry.has(String(p.compound).toUpperCase())&&p.rain!==true);
  const support=[...new Set(details.map(p=>p.compound))].map(compound=>({compound,
    count:Math.min(...['Q1','Q2','Q3'].map(phase=>new Set(details.filter(p=>p.compound===compound&&p.phase===phase).map(p=>p.driver)).size))}));
  const selected=support.sort((a,b)=>b.count-a.count||a.compound.localeCompare(b.compound))[0];
  return selected?.count>0?details.filter(p=>p.compound===selected.compound):[];
}

let aggregateMemo=null;
function aggregate() {
  const sources=events.map(e=>[e.name,e.round,e.Q,e.R]);
  if(aggregateMemo?.year===context?.year&&aggregateMemo.raceModel===(typeof racePaceModel==='undefined'?'nonlinear':racePaceModel)&&sources.length===aggregateMemo.sources.length&&sources.every((s,i)=>s.every((v,j)=>v===aggregateMemo.sources[i][j])))return structuredClone(aggregateMemo.value);
  const value=calculateAggregate();aggregateMemo={year:context?.year,sources,raceModel:typeof racePaceModel==='undefined'?'nonlinear':racePaceModel,value:structuredClone(value)};return value;
}
function calculateAggregate() {
  const map=new Map();
  const eventQ1Deficits = new Map();
  const eventAdjDeficits = new Map();

  for (const e of events) {
    if (!e.Q?.teams) continue;
    const qTeams = e.Q.teams;

    // Q1 deficit (all teams present on identical green track)
    const q1Times = new Map();
    for (const t of qTeams) {
      const p1 = t.phase_details?.find(p => p.phase === 'Q1');
      if (p1 && finite(p1.time)) q1Times.set(t.team, p1.time);
    }
    const minQ1 = Math.min(...q1Times.values());
    const q1Map = new Map();
    if (finite(minQ1) && minQ1 > 0) {
      for (const [tm, tmTime] of q1Times.entries()) {
        q1Map.set(tm, Math.max(0, (tmTime / minQ1 - 1) * 100));
      }
    }
    eventQ1Deficits.set(e.name, q1Map);

    // Track evolution adjusted deficit (Q3 baseline)
    // Only compute deltas when dry, >= 6 common drivers, deltas in [-0.2, 1.5] s, and MAD <= 0.35 s
    const q1_d = new Map();
    const q2_d = new Map();
    const q3_d = new Map();
    const q1_tm = new Map();
    const q2_tm = new Map();
    const q3_tm = new Map();
    const isDryComp = c => ['SOFT','MEDIUM','HARD','HYPERSOFT','ULTRASOFT','SUPERSOFT','SUPERHARD'].includes(String(c).toUpperCase());
    const dryDetails=qualifyingEvolutionSample(qTeams);
    const matchedCompound=dryDetails[0]?.compound;

    for (const t of qTeams) {
      for (const p of (t.phase_details || [])) {
        if (!finite(p.time)) continue;
        const dry = isDryComp(p.compound)&&p.compound===matchedCompound&&p.rain!==true;
        if(!dry)continue;
        if (p.phase === 'Q1') {
          if (dry && p.driver) q1_d.set(p.driver, p.time);
          if (!q1_tm.has(t.team) || p.time < q1_tm.get(t.team)) q1_tm.set(t.team, p.time);
        } else if (p.phase === 'Q2') {
          if (dry && p.driver) q2_d.set(p.driver, p.time);
          if (!q2_tm.has(t.team) || p.time < q2_tm.get(t.team)) q2_tm.set(t.team, p.time);
        } else if (p.phase === 'Q3') {
          if (dry && p.driver) q3_d.set(p.driver, p.time);
          if (!q3_tm.has(t.team) || p.time < q3_tm.get(t.team)) q3_tm.set(t.team, p.time);
        }
      }
    }

    const deltas12 = [];
    for (const [drv, t1] of q1_d.entries()) {
      if (q2_d.has(drv)) {
        const d = t1 - q2_d.get(drv);
        if (Math.abs(d) <= 1.5) deltas12.push(d);
      }
    }
    const deltas23 = [];
    for (const [drv, t2] of q2_d.entries()) {
      if (q3_d.has(drv)) {
        const d = t2 - q3_d.get(drv);
        if (Math.abs(d) <= 1.5) deltas23.push(d);
      }
    }

    const med12 = deltas12.length ? median(deltas12) : null;
    const mad12 = (deltas12.length && finite(med12))
      ? median(deltas12.map(d => Math.abs(d - med12)))
      : null;
    const gate12Valid = deltas12.length >= 6 && finite(mad12) && mad12 <= 0.35;

    const med23 = deltas23.length ? median(deltas23) : null;
    const mad23 = (deltas23.length && finite(med23))
      ? median(deltas23.map(d => Math.abs(d - med23)))
      : null;
    const gate23Valid = deltas23.length >= 6 && finite(mad23) && mad23 <= 0.35;

    const evolutionValid = gate12Valid && gate23Valid;

    if (evolutionValid) {
      const ev12 = med12;
      const ev23 = med23;
      const adjTimes = new Map();
      for (const t of qTeams) {
        const tm = t.team;
        // Best of every phase this team reached, each moved to Q3 track
        // conditions; a scrappy Q3 lap must not hide a stronger Q2 lap.
        const options = [q3_tm.has(tm) ? q3_tm.get(tm) : null,
          q2_tm.has(tm) ? q2_tm.get(tm) - ev23 : null,
          q1_tm.has(tm) ? q1_tm.get(tm) - ev12 - ev23 : null].filter(finite);
        if (options.length) adjTimes.set(tm, Math.min(...options));
      }
      const minAdj = Math.min(...adjTimes.values());
      const adjMap = new Map();
      if (finite(minAdj) && minAdj > 0) {
        for (const [tm, tmTime] of adjTimes.entries()) {
          adjMap.set(tm, Math.max(0, (tmTime / minAdj - 1) * 100));
        }
      }
      eventAdjDeficits.set(e.name, adjMap);
    } else {
      // Evolution not identifiable (wet, too few comparable sets): keep the
      // GP with its fastest-lap gap rather than dropping it from the season.
      eventAdjDeficits.set(e.name, new Map(qTeams.filter(t => finite(t.pace)).map(t => [t.team, t.pace])));
    }
  }

  for(const e of [...events].sort((a,b)=>a.round-b.round)) for(const session of ['Q','R']) {
    for(const t of e[session]?.teams || []) {
      if(!map.has(t.team)) {
        map.set(t.team,{
          team:t.team,color:t.color,q:[],r:[],
          sectors:[[],[],[]],idealSectors:[[],[],[]],idealGaps:[],
          q1Deficits:[],adjDeficits:[],
          points:0,pointsKnown:true,starts:0,finishes:0,mechanical:0,incidents:0,other:0,
          completedLaps:0,lapExposureEntries:0,
          puRetirements:0,chassisRetirements:0,incidentRetirements:0,otherRetirements:0,unknownRetirements:0,
          positions:[],samples:0,coverage:[],stints:[],tyreAgeStints:[],results:0,
          fastestRaceDrivers:[],retirements:[],phaseDetails:[],raceDrivers:[],raceCoverage:[],
          sampleTiers:[],sensitivityBrackets:[],provisionalFlags:[],fallbackFlags:[],
          trafficSensitivity:{'1.5s':[],'2.0s':[],'2.5s':[]},teammateSpreads:[],
          fieldNormalizedStints:[]
        });
      }
      const item=map.get(t.team);
      if(session==='Q') {
        const adjustedPace=eventAdjDeficits.get(e.name)?.get(t.team);
        item.q.push({
          round:e.round,event:e.name,pace:t.pace,adjusted:finite(adjustedPace)?adjustedPace:t.pace,
          conditionAdjusted:t.pace_condition_adjusted,conditionDiagnostic:t.qualifying_condition_diagnostic,
          paceDeltaS:t.pace_delta_s,
          idealPace:t.ideal_pace,
          idealPaceDeltaS:t.ideal_pace_delta_s,
          idealLapTime:t.ideal_lap_time,
          idealGapS:t.ideal_vs_complete_gap_s,
          idealCompound:t.ideal_compound,
          idealSectors:t.ideal_sectors,
          completedSectors:t.completed_sectors,
          lap:t.lap
        });
        item.phaseDetails.push(...(t.phase_details||[]).map(p=>({...p,event:e.name})));
        t.sector_deficits?.forEach((v,i)=>{if(finite(v))item.sectors[i].push(v);});
        t.ideal_sector_deficits?.forEach((v,i)=>{if(finite(v))item.idealSectors[i].push(v);});
        if (finite(t.ideal_vs_complete_gap_s)) item.idealGaps.push(t.ideal_vs_complete_gap_s);
        const q1Def = eventQ1Deficits.get(e.name)?.get(t.team);
        if (finite(q1Def)) item.q1Deficits.push(q1Def);
        const adjDef = eventAdjDeficits.get(e.name)?.get(t.team);
        if (finite(adjDef)) item.adjDeficits.push(adjDef);
      } else {
        item.r.push(typeof racePaceModel!=='undefined'&&racePaceModel==='linear'?t.race_linear_diagnostic?.pace:t.pace);
        item.samples+=t.samples;
        item.raceCoverage.push({event:e.name,supported:finite(t.pace),basis:t.race_pace_basis||'clear-air',
          provisional:!!t.provisional,samples:t.samples||0});
        if(finite(t.pace)&&t.sample_tier) item.sampleTiers.push(t.sample_tier);
        if(t.traffic_sensitivity_bracket) item.sensitivityBrackets.push(t.traffic_sensitivity_bracket);
        if(finite(t.pace)&&t.provisional) item.provisionalFlags.push(t.provisional);
        if(t.fallback_used) item.fallbackFlags.push(t.fallback_used);
        if(finite(t.traffic_coverage)) item.coverage.push(t.traffic_coverage);
        if(t.fastest_race_driver)item.fastestRaceDrivers.push(t.fastest_race_driver);
        item.points+=t.points; item.pointsKnown&&=t.points_known; item.starts+=t.starts; item.finishes+=t.finishes;
        item.completedLaps+=t.completed_laps||0;item.lapExposureEntries+=t.lap_exposure_entries||0;
        item.mechanical+=t.mechanical;
        item.puRetirements+=(t.pu_retirements||0);
        item.chassisRetirements+=(t.chassis_retirements||0);
        item.incidentRetirements+=(t.incident_retirements||(t.incidents||0));
        item.otherRetirements+=(t.other_retirements||0);
        item.unknownRetirements+=(t.unknown_retirements||0);
        item.incidents+=t.incidents; item.other+=t.other_retirements;
        item.positions.push(...t.positions); item.results++;
        item.stints.push(...(t.degradation || []).map(s=>({
          ...s,
          event:e.name,
          relativeSlope: s.relative_slope ?? s.field_normalized_slope ?? null,
          usedStart: s.used_start ?? (finite(s.min_age) && s.min_age > 3),
          minAge:s.min_age,
          maxAge:s.max_age,
          ageSpan:s.age_span,
          matchedLaps:s.matched_laps,
          fieldSupport:s.field_support,
          lowSample:s.low_sample,
          cliffDetected:s.cliff_detected,
          cliffAge:s.cliff_age
        })));
        item.tyreAgeStints.push(...(t.tyre_age_stints||[]).map(s=>({
          ...s,event:e.name,round:e.round,
          compound_grade:verifiedDryGrade(context?.year,e.round,s.compound)
        })));
        item.retirements.push(...(t.retirements||[]).map(r=>({...r,event:e.name})));
        item.raceDrivers.push(...(t.race_drivers||[]).map(r=>({...r,event:e.name,selected:r.driver===t.fastest_race_driver})));
        const s15 = t.traffic_sensitivity?.['1.5s'] ?? t.traffic_sensitivity?.loose_15;
        const s20 = t.traffic_sensitivity?.['2.0s'] ?? t.traffic_sensitivity?.standard_20;
        const s25 = t.traffic_sensitivity?.['2.5s'] ?? t.traffic_sensitivity?.strict_25;
        if (finite(s15)) item.trafficSensitivity['1.5s'].push(s15);
        if (finite(s20)) item.trafficSensitivity['2.0s'].push(s20);
        if (finite(s25)) item.trafficSensitivity['2.5s'].push(s25);
        if (finite(t.teammate_spread)) item.teammateSpreads.push(t.teammate_spread);
      }
    }
  }
  return rebase([...map.values()].map(t=>({
    ...t,
    qualy:avg(t.q.map(q=>q.pace)),
    qualyQ1:avg(t.q1Deficits),
    qualyAdjusted:avg(t.adjDeficits),
    race:avg(t.r),
    paceDeltaS:t.q.length ? t.q.at(-1)?.paceDeltaS : null,
    idealGapS:t.idealGaps.length ? avg(t.idealGaps) : null,
    idealCompound:t.q.length ? t.q.at(-1)?.idealCompound : null,
    idealLapTime:t.q.length ? t.q.at(-1)?.idealLapTime : null,
    s1:avg(t.sectors[0]),s2:avg(t.sectors[1]),s3:avg(t.sectors[2]),
    idealS1:avg(t.idealSectors[0]),idealS2:avg(t.idealSectors[1]),idealS3:avg(t.idealSectors[2]),
    sampleTier:t.sampleTiers.at(-1) || 'normal',
    sensitivityBracket:events.filter(e=>e.R).length===1?(t.sensitivityBrackets.at(-1)||null):null,
    provisional:t.provisionalFlags.some(Boolean),
    fallbackUsed:t.fallbackFlags.some(Boolean),
    qCount:t.q.filter(q=>finite(q.pace)).length,
    rCount:t.r.filter(finite).length
  })),['qualy','qualyQ1','qualyAdjusted','race','s1','s2','s3','idealS1','idealS2','idealS3']);
}

function table(headers,rows) {
  const markup=`<div class="performance-table-wrap${headers.length<=6?' is-compact-table':''}" tabindex="0" role="region" aria-label="Measurement table"><table class="performance-table"><thead><tr>${headers.map(h=>`<th scope="col"${h.includes('data-sort-state="ascending"')?' aria-sort="ascending"':h.includes('data-sort-state="descending"')?' aria-sort="descending"':''}>${h}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.map(row=>`<tr>${row.map(v=>`<td>${v}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${headers.length}" class="section-empty">No eligible data yet.</td></tr>`}</tbody></table></div>`;
  const supporting=/data-performance-sort="(?:straightTeam|eventStraightTeam|brakeTeam|eventBrakeTeam)"/.test(headers.join(''));
  return supporting?`<details class="performance-evidence primary-measurements"><summary>Measurements and timing support</summary>${markup}</details>`:markup;
}

function card(title,note,body) {
  return `<section class="dashboard-card performance-card">
    <div class="panel-heading">
      <h2>${title}</h2>
    </div>
    <p class="performance-note">${note}</p>
    <div class="performance-card-body">${body}</div>
  </section>`;
}

// Sort state for one column header; React views (src/components/DataTable)
// render the same model, so both kinds of table sort through one handler.
function sortHeaderModel(key,label,defaultDirection=1) {
  const group=tableSortGroups.get(key), saved=group&&tableSortStates.get(group);
  const isCurrent = saved?saved.key===key:sortKey === key;
  const ascending=(saved?.direction??sortDirection)===1;
  return {key,label,state:isCurrent?(ascending?'ascending':'descending'):'none',group:group||key,direction:defaultDirection};
}
function sortHeader(key,label,defaultDirection=1) {
  const {state,group}=sortHeaderModel(key,label,defaultDirection),isCurrent=state!=='none',ascending=state==='ascending';
  const path=isCurrent?(ascending?'M3 8 6 5 9 8':'M3 5 6 8 9 5'):'M3 7 6 4 9 7 M3 11 6 14 9 11';
  return `<button class="perf-sort-btn ${isCurrent ? 'is-sorted' : ''}" data-sort-state="${state}" data-performance-sort="${key}" data-sort-table="${group}" data-sort-direction="${defaultDirection}" title="Sort by ${escape(label)}" type="button"><span>${label}</span><svg class="sort-icon" aria-hidden="true" width="12" height="16" viewBox="0 0 12 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"/></svg></button>`;
}
// React views (react-islands.js): renderX() stores its view data here and
// returns a placeholder; render() mounts them before the layout pass.
let reactViewProps=new Map();
function reactView(name,props) {
  reactViewProps.set(name,props);
  if(!window.ApexReact)return '<p class="performance-error">This view did not load. Reload the page.</p>';
  return `<div data-react-view="${name}" style="display:contents"></div>`;
}

function sorted(items,getters,defaultKey,defaultDirection=1) {
  const group=activeMetric+':'+defaultKey+':'+telemetrySubject+':'+(context?.season?'multi':'single');
  for(const key of Object.keys(getters))tableSortGroups.set(key,group);
  const saved=tableSortStates.get(group);
  const key=saved&&getters[saved.key]?saved.key:getters[sortKey]?sortKey:defaultKey;
  const direction=saved&&key===saved.key?saved.direction:sortKey===key?sortDirection:defaultDirection;
  tableSortStates.set(group,{key,direction});
  return window.ApexAnalysis.sortRows(items,getters,key,direction);
}

function summarisePaceTeams(teams,raceStat) {
  return rebase(teams.map(t=>({...t,
    qualy:summarize(t.q.map(q=>q.pace),'mean'),
    qualyAdjusted:summarize(t.adjDeficits,'mean'),
    qualyCondition:summarize(t.q.map(q=>q.conditionAdjusted),'mean'),
    race:summarize(t.r,raceStat)
  })),['qualy','qualyAdjusted','qualyCondition','race']);
}

function renderPace(teams) {
  if (qualyPaceMode === 'q1') qualyPaceMode = 'adjusted';

  const regEnv = events[0]?.Q?.regulatory_energy_envelope || events[0]?.R?.regulatory_energy_envelope || events[0]?.regulatory_energy_envelope;
  const is2026 = (context?.year >= 2026) || (events[0]?.year >= 2026) || (regEnv && regEnv.year >= 2026);
  const paceKey = qualyPaceMode === 'condition' ? 'qualyCondition' : qualyPaceMode === 'adjusted' ? 'qualyAdjusted' : 'qualy';
  const paceTeams=summarisePaceTeams(teams,paceSeasonStat);
  const ordered = sorted(paceTeams, {
    team: t => t.team,
    qualy: t => t.qualy,
    qualyAdjusted: t => t.qualyAdjusted,
    qualyCondition: t => t.qualyCondition,
    race: t => t.race,
    samples: t => t.samples
  }, paceKey);

  const chartMeta = qualyPaceMode === 'overall' ? {
    title: 'Qualifying Pace Deficit · Overall Best Lap',
    subtitle: 'Fastest official lap across Q1–Q3 per GP · season summary rebased to fastest team',
    note: 'Each GP uses each constructor’s single fastest valid lap across Q1–Q3 from either driver, compared with that GP’s pole lap. The selected season statistic is then rebased so the fastest supported team is 0.000%.'
  } : qualyPaceMode==='condition'?{
    title:'Qualifying pace · timestamp / fresh-set diagnostic',subtitle:'Estimated, not official · no extrapolation to Q3',
    note:'Uses actual completion timestamps from repeated fresh, low-age sets on one dry compound. Driver effects and a shared timestamp slope are fitted inside common observed time support. Selected fastest laps must match that cohort. Weather, wind and execution are not independently measured corrections; unsupported fits stay blank.'
  } : {
    title: 'Qualifying Pace Deficit · Track-Evolution Adjusted (% to Q3 Baseline)',
    subtitle: 'Same dry compound and advancing drivers · estimated Q1/Q2 evolution, not a measured correction',
    note: 'Estimates the shared improvement between qualifying phases from advancing drivers. Tyres, driver execution and changing conditions can also contribute; this is a diagnostic rather than an official lap result.'
  };

  const loadedQ=events.filter(e=>e.Q?.teams?.length).length,loadedR=events.filter(e=>e.R?.teams?.length).length;
  const qualyColLabel = qualyPaceMode === 'overall'
    ? 'Qualifying · Best lap'
    : qualyPaceMode==='condition'?'Timestamp / set diagnostic':'Evolution-adjusted deficit';
  // Rendered by src/views/PaceView.tsx; data-pace-stat / data-qualy-mode buttons are handled below.
  return reactView('pace',{regulatory:!!is2026,note:chartMeta.note,
    stat:{show:loadedR>2,value:paceSeasonStat},
    qualyMode:qualyPaceMode,qualyBadge:qualyPaceMode==='overall'?'Best delivered lap · Q1–Q3':qualyPaceMode==='condition'?'Estimated within common observed time support':'Estimated phase evolution',
    qualyChart:{rows:ordered,options:{title:chartMeta.title,subtitle:`${chartMeta.subtitle} · Mean across GPs`,valueKey:paceKey,unit:'%',digits:3}},
    raceChart:{rows:paceTeams,options:{title:'Estimated Race Pace Deficit (% to Benchmark)',
      subtitle:`Shared race-lap, compound and tyre-age model · ${paceSeasonStat==='mean'?'Mean':'Median'} GP estimate · Lower is faster`,valueKey:'race',unit:'%',digits:3}},
    sort:{team:sortHeaderModel('team','Team'),pace:sortHeaderModel(paceKey,qualyColLabel),race:sortHeaderModel('race','Estimated race pace deficit'),samples:sortHeaderModel('samples','Modelled race laps',-1)},
    rows:ordered.map(t=>{
      const spread=middle50Label(qualyPaceMode==='adjusted'?t.adjDeficits:t.q.map(q=>q.pace),'%');
      const estimated=t.raceCoverage.filter(r=>r.supported&&r.basis!=='clear-air').length;
      return {team:t,samples:t.samples,
        pace:{value:fmt(t[paceKey],3,'%'),note:`${t.qCount} of ${loadedQ} loaded qualifying events${spread?` · GP P25–P75 ${spread}`:''}${t.qCount===1&&t.q[0]?.lap?` · ${t.q[0].lap.driver} ${fmt(t.q[0].lap.time,3,' s')}`:''}`},
        race:{value:fmt(t.race,3,'%'),provisional:!!t.provisional,
          note:`${t.fastestRaceDrivers?.length?`${[...new Set(t.fastestRaceDrivers)].join(', ')} · `:''}${t.rCount}/${loadedR} races supported${estimated?` · ${estimated} estimated`:''}${t.sensitivityBracket?` · Bracket [${fmt(t.sensitivityBracket[0],3,'%')}, ${fmt(t.sensitivityBracket[1],3,'%')}]`:''}`}};
    }),
    coverage:teams.flatMap(t=>t.raceDrivers.filter(r=>r.selected).map(r=>{
      const result=events.find(e=>e.name===r.event)?.R?.teams?.find(row=>row.team===t.team);
      const range=result?.traffic_sensitivity_bracket,model=r.model_diagnostics||result?.race_model_diagnostics||{},common=result?.traffic_common_cohort;
      return {team:t,event:r.event,driver:r.driver,laps:r.race_lap_range?.join('–')||'—',stints:r.stints??'—',compounds:r.compounds?.join(', ')||'—',
        range:range?`${fmt(range[0],3,'%')}–${fmt(range[1],3,'%')}`:'—',
        common:common&&Object.keys(common.values||{}).length===3?{value:[1.5,2,2.5].map(th=>signed(common.values[String(th)],3,'%')).join(' / '),note:`vs ${common.reference_driver} · ${common.drivers.length} common drivers`}:null,
        leave:model.leave_stint_out_range?{value:`${fmt(model.leave_stint_out_range[0],3,'%')}–${fmt(model.leave_stint_out_range[1],3,'%')}`,note:`${model.leave_stint_out_fits} deletion fits`}:null,
        noise:fmt(model.contrast_noise_gain,3)};
    })),
    laps:teams.flatMap(t=>t.q.filter(q=>q.lap).map(q=>({team:t,event:q.event,phase:q.lap.phase,driver:q.lap.driver,time:q.lap.time}))),
    drivers:teams.flatMap(t=>t.raceDrivers.map(r=>({team:t,event:r.event,driver:`${r.driver}${r.selected?' · selected':''}`,estimate:fmt(r.pace,3,'%'),samples:r.samples,
      basis:`${r.estimate_basis==='traffic-adjusted'?'Traffic-adjusted · provisional':r.estimate_basis==='sparse-clear-air'?'Short clean-air sample · provisional':'Clear-air'}${r.model_diagnostics?.clear_air_extrapolation?' · extrapolated':''}`,
      residual:`${fmt(r.residual_spread,3,'%')} residual`})))});
}



function tyreStintKey(entity,stint){
  return encodeURIComponent(JSON.stringify([entity.team,stint.event,stint.driver,stint.stint,stint.segment||0]));
}

// Geometry for one run's lap-time plot; drawn by src/components/TyreStintPlot.tsx.
function tyreStintPlotModel(entity,stint){
  const points=(stint.points||[]).filter(p=>finite(p.age)&&finite(p.time)&&finite(p.lap));
  const laps=[...points.map(p=>({...p,status:'Used'})),...(stint.excluded_points||[]).filter(p=>finite(p.lap)&&finite(p.time)).map(p=>({...p,status:p.reason||'Excluded'}))]
    .sort((a,b)=>a.lap-b.lap).map(p=>({lap:p.lap,age:finite(p.age)?p.age:null,time:p.time,status:String(p.status)}));
  const base={teamColor:entity.color,laps,exclusions:null,axis:{lo:0,hi:0,grid:[]},curve:null,points:[],excluded:[],noTrend:false,caption:''};
  if(!points.length)return {...base,title:`${stint.driver} · ${stint.event} · stint ${stint.stint}`,empty:true};
  const fuel=tyreCorrection==='fuel'?tyreFuelRate:0;
  const origin=points[0].lap;
  const values=points.map(p=>p.time+fuel*(p.lap-origin));
  const excluded=(typeof tyreShowExcluded!=='undefined'&&tyreShowExcluded?stint.excluded_points||[]:[]).filter(p=>finite(p.age)&&finite(p.time)&&finite(p.lap));
  const excludedValues=excluded.map(p=>p.time+fuel*(p.lap-origin));
  const ages=[...points,...excluded].map(p=>p.age);
  const baseline=Math.min(...values),lo=Math.min(...ages),hi=Math.max(...ages);
  const rate=stint.trendValue;
  const intercept=summarize(points.map((p,i)=>values[i]-rate*p.age),'median');
  const curved=typeof tyreFitMode!=='undefined'&&tyreFitMode==='curve'&&stint.nonlinear?.curve?.length;
  const curve=finite(rate)?curved?stint.nonlinear.curve.map(p=>({age:p.age,time:p.time+fuel*(p.age-points[0].age)})):[{age:lo,time:intercept+rate*lo},{age:hi,time:intercept+rate*hi}]:[];
  const fit=curve.map(p=>p.time);
  const min=Math.min(baseline,...fit,...excludedValues),max=Math.max(...values,...fit,...excludedValues),span=Math.max(.1,max-min);
  const x=a=>55+(a-lo)/Math.max(1,hi-lo)*590,y=v=>180-(v-min)/span*145;
  return {...base,empty:false,title:`${stint.driver} · ${stint.event} · ${stint.compound_grade||'Unknown grade'} · stint ${stint.stint}`,noTrend:!finite(rate),
    caption:`${tyreCorrection==='fuel'?'Fuel estimate applied':'Recorded times'} · dots are laps${curve.length?', dashed line is the trend':''}${excluded.length?' · hollow dots are excluded':''}`,
    exclusions:stint.excluded_points?.length?{pressed:excluded.length>0,label:`${excluded.length?'Hide':'Show'} ${stint.excluded_points.length} excluded lap${stint.excluded_points.length===1?'':'s'}`}:null,
    axis:{lo,hi,grid:[0,.5,1].map(f=>{const v=min+span*f;return {y:y(v),label:(v-baseline).toFixed(3)};})},
    curve:curve.length?curve.map((p,i)=>`${i?'L':'M'} ${x(p.age)} ${y(p.time)}`).join(' '):null,
    points:points.map((p,i)=>({cx:x(p.age),cy:y(values[i]),title:`Lap ${p.lap} · age ${p.age} · ${p.time.toFixed(3)} s observed · ${(values[i]-baseline).toFixed(3)} s above best ${tyreCorrection==='fuel'?'corrected ':''}lap in this run`})),
    excluded:excluded.map((p,i)=>({cx:x(p.age),cy:y(excludedValues[i]),title:`Excluded lap ${p.lap} · age ${p.age} · ${p.time.toFixed(3)} s · ${p.reason} · residual ${fmt(p.residual_s,3,' s')}`}))};
}

// View data for the tyre-age mode of src/views/TyresView.tsx.
function tyreAgeView(teams) {
  const allocations=VERIFIED_DRY_ALLOCATIONS[context?.year] || [];
  const compounds=[...new Set(allocations.join('').split('').filter(Boolean).map(n=>`C${n}`))].sort((a,b)=>Number(a.slice(1))-Number(b.slice(1)));
  if(!compounds.length) return {noGrades:true};
  const choices=['OVERALL',...compounds];
  if(!choices.includes(tyreView))tyreView='OVERALL';
  const loadedRaces=events.filter(e=>e.R);
  const mappedRaces=loadedRaces.filter(e=>Boolean(allocations[Number(e.round)-1])).length;
  const unmappedStints=teams.flatMap(t=>t.tyreAgeStints||[]).filter(s=>!s.compound_grade).length;
  const source=TYRE_ALLOCATION_SOURCES[context?.year];
  const entities=[];
  for(const team of teams) {
    const stints=(team.tyreAgeStints||[]).map(s=>{
      // Default: all cars' clean-air laps fitted together with a shared
      // race-lap effect (fuel and track evolution from the data), relative to
      // the field on the same compound. Older cached results fall back below.
      if(finite(s.joint_relative_slope))return {...s,trendValue:s.joint_relative_slope,trendSensitivity:null,trendSupported:true,
        trendSamples:s.clean_air?.samples??s.samples,samples:s.clean_air?.samples??s.samples,original:s};
      const fit=tyreLapMode==='clear'?s.clean_air:s;
      if(!fit)return {...s,trendValue:null,trendSupported:false,trendSamples:0};
      const fuel=tyreCorrection==='fuel'?tyreFuelRate:0;
      const curveMode=typeof tyreFitMode!=='undefined'&&tyreFitMode==='curve'&&finite(fit.nonlinear?.steady_slope);
      const raw=curveMode?fit.nonlinear.steady_slope:finite(fit.raw_slope)?fit.raw_slope:finite(fit.fuel_adjusted_slope)?fit.fuel_adjusted_slope-(fit.fuel_assumption_s_per_lap??.060):null;
      const value=finite(raw)?raw+fuel:null;
      const sensitivity=curveMode?null:fit.block_sensitivity_raw?.map(rate=>rate+fuel);
      const supported=fit.supported??(fit.samples>=6&&(!finite(fit.min_age)||!finite(fit.max_age)||fit.max_age-fit.min_age>=5));
      return {...s,...fit,trendValue:value,trendSensitivity:sensitivity,trendSupported:supported&&(tyreConditionMode==='all'||fit.stable_condition_screen===true),trendSamples:fit.samples,original:s};
    });
    if(tyreSubject==='team')entities.push({team:team.team,color:team.color,displayName:team.team,stints});
    else for(const driver of [...new Set(stints.map(s=>s.driver).filter(Boolean))])
      entities.push({team:team.team,color:team.color,displayName:`${driver} · ${team.team}`,driver,stints:stints.filter(s=>s.driver===driver)});
  }
  const rows=entities.map(entity=>{
    const summaries={};
    for(const compound of compounds) {
      const grouped=new Map();
      for(const stint of entity.stints)if(stint.compound_grade===compound && stint.trendSupported && finite(stint.trendValue)) {
        if(!grouped.has(stint.event))grouped.set(stint.event,[]);
        grouped.get(stint.event).push(stint);
      }
      const eventValues=new Map([...grouped].map(([event,stints])=>[event,(()=>{
        if(tyreWeighting==='laps'){
          const weight=stints.reduce((sum,s)=>sum+s.samples,0);
          return stints.reduce((sum,s)=>sum+s.trendValue*s.samples,0)/weight;
        }
        const drivers=new Map();
        for(const s of stints){
          if(!drivers.has(s.driver))drivers.set(s.driver,new Map());
          const driverStints=drivers.get(s.driver),key=s.stint??s;
          if(!driverStints.has(key))driverStints.set(key,[]);
          driverStints.get(key).push(s.trendValue);
        }
        return avg([...drivers.values()].map(driverStints=>summarize([...driverStints.values()].map(values=>summarize(values,'median')),'median')));
      })()]));
      if(eventValues.size) {
        const used=[...grouped.values()].flat();
        summaries[compound]={value:summarize([...eventValues.values()],tyreSeasonStat),eventValues,events:eventValues.size,used,stints:used.length,laps:used.reduce((sum,s)=>sum+s.samples,0),outliers:used.reduce((sum,s)=>sum+(s.outlier_laps||0),0),lowSample:used.some(s=>s.low_sample),usedStart:used.filter(s=>s.used_start).length};
      }
    }
    const selectedGrades=tyreView==='OVERALL'?compounds:[tyreView];
    const available=selectedGrades.map(c=>summaries[c]).filter(Boolean);
    const p75Shortfall=tyreSeasonStat==='p75'
      ? selectedGrades.filter(c=>summaries[c] && summaries[c].events<4)
          .map(c=>`${c}: ${summaries[c].events}/4 GPs`)
      : [];
    const eventGrades=new Map();
    for(const summary of available) for(const [event,value] of summary.eventValues) {
      if(!eventGrades.has(event))eventGrades.set(event,[]);
      eventGrades.get(event).push(value);
    }
    const gpSlopes=[...eventGrades.values()].map(avg);
    const short=entity.stints.filter(s=>selectedGrades.includes(s.compound_grade)&&!s.trendSupported).length;
    return {...entity,summaries,value:tyreSeasonStat==='p75'&&(gpSlopes.length<4||p75Shortfall.length)?null:summarize(gpSlopes,tyreSeasonStat),p75Shortfall,compounds:available.length,events:eventGrades.size,stints:available.reduce((sum,s)=>sum+s.stints,0),laps:available.reduce((sum,s)=>sum+s.laps,0),outliers:available.reduce((sum,s)=>sum+s.outliers,0),usedStart:available.reduce((sum,s)=>sum+s.usedStart,0),lowSample:available.some(s=>s.lowSample),short};
  });
  let commonTyreCoverage=null;
  if(typeof tyreCoverageMode!=='undefined'&&tyreCoverageMode==='common'){
    const blocks=new Map();for(const row of rows)for(const [grade,summary]of Object.entries(row.summaries))if(tyreView==='OVERALL'||grade===tyreView)for(const [gp,value]of summary.eventValues){
      const key=gp+' · '+grade;if(!blocks.has(key))blocks.set(key,new Map());blocks.get(key).set(row.displayName,{team:row.displayName,value});}
    const reports=[...blocks].map(([name,values])=>({event:{name},summary:{rows:values}}));
    const scores=eventAdjustedScores(reports,r=>r.value,'mean','common','teams');commonTyreCoverage=scores.coverage||{teams:[],events:[]};
    for(const row of rows){const byGP=new Map(),gradeGPs=new Map();let count=0;
      for(const key of commonTyreCoverage.events){const value=blocks.get(key)?.get(row.displayName)?.value;if(!finite(value))continue;
        const [gp,grade]=key.split(' · ');if(!byGP.has(gp))byGP.set(gp,[]);byGP.get(gp).push(value);
        if(!gradeGPs.has(grade))gradeGPs.set(grade,new Set());gradeGPs.get(grade).add(gp);count++;}
      const own=[...byGP.values()].map(avg),enoughP75=own.length>=4&&[...gradeGPs.values()].every(g=>g.size>=4);
      row.value=commonTyreCoverage.teams.includes(row.displayName)&&(tyreSeasonStat!=='p75'||enoughP75)?summarize(own,tyreSeasonStat):null;
      row.commonPairs=count;row.events=byGP.size;row.compounds=gradeGPs.size;
      row.p75Shortfall=tyreSeasonStat==='p75'?[...gradeGPs].filter(([,gps])=>gps.size<4).map(([grade,gps])=>`${grade}: ${gps.size}/4 common GPs`):[];
      if(tyreSeasonStat==='p75'&&!count)row.p75Shortfall=['No common GP + grade pairs'];}
  }
  const ordered=sorted(rows,{tyreAgeName:r=>r.displayName,tyreAgeValue:r=>r.value,tyreAgeEvents:r=>r.events,tyreAgeStints:r=>r.stints,tyreAgeLaps:r=>r.laps},'tyreAgeValue');
  const scored=ordered.filter(r=>finite(r.value));
  const extent=Math.max(.01,...scored.map(r=>Math.abs(r.value)));
  const plotRuns=entities.flatMap(entity=>entity.stints.filter(s=>(tyreView==='OVERALL'||s.compound_grade===tyreView)&&(s.points?.length||s.excluded_points?.length)).map(s=>({entity,stint:s,key:tyreStintKey(entity,s)})));
  let selectedRun=plotRuns.find(r=>r.key===tyreRunKey);
  const choose=(list,value,key)=>list.some(r=>key(r)===value)?list.filter(r=>key(r)===value):list;
  let filteredRuns=choose(plotRuns,tyrePlotTeam,r=>r.entity.team);
  filteredRuns=choose(filteredRuns,tyrePlotDriver,r=>r.stint.driver);
  filteredRuns=choose(filteredRuns,tyrePlotEvent,r=>r.stint.event);
  selectedRun=selectedRun||filteredRuns.sort((a,b)=>String(a.entity.team).localeCompare(String(b.entity.team))||String(a.stint.driver).localeCompare(String(b.stint.driver))||Number(a.stint.round)-Number(b.stint.round)||a.stint.stint-b.stint.stint)[0];
  const runsFor=(team,driver,event)=>plotRuns.filter(r=>r.entity.team===team&&(driver==null||r.stint.driver===driver)&&(event==null||r.stint.event===event));
  const legacy=teams.some(t=>(t.tyreAgeStints||[]).some(s=>!s.nonlinear));
  const jointRanking=teams.some(t=>(t.tyreAgeStints||[]).some(s=>finite(s.joint_relative_slope)));
  const fuelFor=s=>tyreCorrection==='fuel'?tyreFuelRate:0;
  return {compound:{choices,value:tyreView,overallLabel:'All C grades'},correction:tyreCorrection,
    correctionText:tyreCorrection==='fuel'?'Assumes 0.060 s/lap fuel gain; not measured fuel or isolated tyre degradation.':'Observed lap-time change includes fuel burn and track conditions.',
    note:`The number is the change in lap time for each additional lap on the tyre: +0.050 s/lap means a 0.500-second loss over ten tyre-age steps if the trend continues. Each driver's stint is fitted separately over its observed ages; pit, wet and neutralised laps are excluded. Runs are split at SC/VSC/red flags and unusual laps are screened around the fitted trend. ${tyreLapMode==='clear'?'Clean air requires more than 2 seconds to the car ahead at timing checkpoints.':'All usable laps includes traffic and race management.'} ${tyreCorrection==='fuel'?`The rate adds an assumed ${tyreFuelRate.toFixed(3)} s per race lap for fuel burn. This fixed sensitivity assumption is not a measured fuel load or a calibrated value for any season.`:'Observed rates include the benefit of burning fuel.'} ${tyreWeighting==='balanced'?'Median stints describe each driver, then both drivers receive equal weight within each GP and C grade.':'Stints receive weight proportional to their usable laps within each GP and C grade.'} Each GP receives equal weight in the season summary. Overall averages only the C grades observed in each GP, so differing compound and circuit coverage can affect comparisons. Track evolution, temperature, driving targets and energy management can still influence these estimates.`,
    quality:`${tyreConditionMode==='screened'?'Wet/transition context and rapid field-wide improvement are excluded from the ranking; all fitted runs remain inspectable.':'Diagnostic: all statistically supported pace trends are included, even in changing conditions.'} ${jointRanking?'Ranked from clean-air laps only, all cars fitted together per race: a shared race-lap effect absorbs fuel burn and track evolution, and each car is compared with the field on the same compound (s/lap of tyre age; negative is less degradation). Slower cars put less energy into their tyres, so low degradation is not the same as a fast car. ':''}This measures observed pace change, not physical tyre wear. ${typeof tyreFitMode!=='undefined'&&tyreFitMode==='curve'?'The headline uses the steady segment; warm-up and supported late falloff remain in the plotted curve. Short runs use a labelled linear diagnostic.':'The headline summarizes the entire observed age span; nonlinear phases remain evidence.'}`,
    commonCoverage:commonTyreCoverage?`Same observed GP + grade pairs: ${commonTyreCoverage.events.join(', ')||'none'} · ${commonTyreCoverage.teams.length} comparable entrants. These are still own-run absolute slopes, not rival-subtracted or rebased scores.`:null,
    coverage:{mapped:mappedRaces,loaded:loadedRaces.length,unmapped:unmappedStints,source:String(source||'')},legacy,
    chart:scored.length?{title:`Tyre-age lap-time change · ${tyreView==='OVERALL'?'verified C grades':tyreView}`,rows:scored,extent}:null,
    emptyMessage:tyreSeasonStat==='p75'?'P75 needs at least four supported Grands Prix for every included C grade. The table shows each missing grade and its GP count.':tyreLapMode==='clear'?'No supported clean-air fits. Try All usable laps to inspect traffic-affected trends.':'No runs with at least six usable laps spanning five tyre-age steps. Short runs remain in the evidence table.',
    sort:{name:sortHeaderModel('tyreAgeName',tyreSubject==='team'?'Team':'Driver · team'),value:sortHeaderModel('tyreAgeValue','Change per tyre-age lap'),
      events:sortHeaderModel('tyreAgeEvents','Events',-1),stints:sortHeaderModel('tyreAgeStints','Usable green runs',-1),laps:sortHeaderModel('tyreAgeLaps','Usable laps',-1)},
    rows:ordered.map(r=>({team:r,value:finite(r.value)?r.value:null,shortfall:r.p75Shortfall.length?r.p75Shortfall.join(', '):null,events:r.events,stints:r.stints,laps:r.laps,outliers:r.outliers,
      coverage:`${r.compounds} C grade${r.compounds===1?'':'s'}${r.lowSample||r.events<3?' · limited evidence':''}${r.short?` · ${r.short} unsupported run${r.short===1?'':'s'}`:''}${r.usedStart?` · ${r.usedStart} used start${r.usedStart===1?'':'s'}`:''}`})),
    picker:selectedRun?{teams:plotRuns.map(r=>r.entity.team).sort(),team:selectedRun.entity.team,
      drivers:runsFor(selectedRun.entity.team).map(r=>r.stint.driver),driver:selectedRun.stint.driver,
      events:runsFor(selectedRun.entity.team,selectedRun.stint.driver).map(r=>r.stint.event),event:selectedRun.stint.event,
      runs:runsFor(selectedRun.entity.team,selectedRun.stint.driver,selectedRun.stint.event).map(r=>({key:r.key,label:`Stint ${r.stint.stint} · ${r.stint.compound_grade} · age ${r.stint.min_age}–${r.stint.max_age}${r.stint.segment?` · run ${r.stint.segment+1}`:''}`})),
      run:selectedRun.key,total:plotRuns.length,teamCount:new Set(plotRuns.map(r=>r.entity.team)).size}:null,
    plot:selectedRun?tyreStintPlotModel(selectedRun.entity,selectedRun.stint):null,
    evidence:entities.flatMap(entity=>entity.stints.filter(s=>tyreView==='OVERALL'||s.compound_grade===tyreView).map(s=>({team:entity,driver:s.driver||'—',event:s.event,
      grade:s.compound_grade||'Unmapped',run:`${s.stint}${s.segment?` · green run ${s.segment+1}`:''}`,
      ages:finite(s.min_age)&&finite(s.max_age)?`${s.min_age}–${s.max_age}`:'—',laps:s.trendSamples||0,
      trend:finite(s.trendValue)?signed(s.trendValue,3,' s/lap'):'—',
      earlyLate:finite(s.early_slope)&&finite(s.late_slope)?`${signed(s.early_slope-(s.fuel_assumption_s_per_lap??.060)+fuelFor(s),3,'')} → ${signed(s.late_slope-(s.fuel_assumption_s_per_lap??.060)+fuelFor(s),3,'')} s/lap`:'—',
      error:finite(s.residual_spread_s)?fmt(s.residual_spread_s,3,' s'):'—',
      sensitivity:s.trendSensitivity?`${signed(s.trendSensitivity[0],3,'')} to ${signed(s.trendSensitivity[1],3,'')} s/lap`:'—',
      status:`${s.trendSupported&&s.compound_grade?'Included':'Diagnostic only'}${!s.supported?' · insufficient span or laps':''}${s.condition_flags?.length?` · ${s.condition_flags.join(', ')}`:''}${s.stable_condition_screen==null?' · condition screening unavailable':''}${finite(s.field_trend_s_per_lap)?` · field trend ${signed(s.field_trend_s_per_lap,3,'')} s/lap (${s.field_trend_drivers} drivers)`:''}${!s.compound_grade?' · unverified compound':''}${s.used_start?' · used tyres':''}`,
      inspect:s.points?.length>=3?tyreStintKey(entity,s):null}))),
    auditOpen:!!tyreRunKey};
}

function renderRace(teams) {
  // Rendered by src/views/TyresView.tsx; data-tyre-* buttons and selects are handled below.
  if(tyreMetric==='age')return reactView('tyres',{metric:'age',subject:tyreSubject,...tyreAgeView(teams)});
  const rows=[];
  const usableStint = s => finite(s.relativeSlope) && s.matchedLaps >= 6 && s.fieldSupport >= 2;
  const cohortTeams = new Map();
  for(const team of teams) for(const stint of team.stints || []) if(usableStint(stint)) {
    const key=`${stint.event}\u0000${stint.compound}`;
    if(!cohortTeams.has(key))cohortTeams.set(key,new Set());
    cohortTeams.get(key).add(team.team);
  }
  const minimumSeasonEvents=context?.season ? Math.max(3,Math.ceil(events.filter(e=>e.R).length*.4)) : 1;
  const minimumCompoundEvents=1;
  const compoundOrder=['HYPERSOFT','ULTRASOFT','SUPERSOFT','SOFT','MEDIUM','HARD','SUPERHARD'];
  const choices=['OVERALL','SOFT','MEDIUM','HARD',...compoundOrder.filter(c=>!['SOFT','MEDIUM','HARD'].includes(c)&&teams.some(t=>t.stints.some(s=>s.compound===c)))];
  if(!choices.includes(tyreView)) tyreView='OVERALL';

  for(const team of teams) {
    const observedStints=(team.stints||[]).filter(s=>finite(s.slope) && (tyreView==='OVERALL'?['SOFT','MEDIUM','HARD'].includes(s.compound):s.compound===tyreView));
    // Used-start tyres are retained only when their race-phase/age-matched
    // comparison passes the same support checks, and are flagged in the table.
    const validStints = (team.stints || []).filter(s => usableStint(s)
      && (cohortTeams.get(`${s.event}\u0000${s.compound}`)?.size||0)>=3);
    const usedStartCount = validStints.filter(s => s.usedStart || s.used_start).length;

    // Group valid stints by event and compound for hierarchical aggregation
    // Hierarchy: Driver-level aggregation with capped weight min(samples, 20)
    // -> team compound estimate within event
      // -> equal event weighting using the selected season statistic
    const eventCompStints = new Map(); // event -> compound -> array of stints
    const summaries = {};

    for(const compound of compoundOrder) {
      const compStints = validStints.filter(s => s.compound === compound);
      const byEventRaw = new Map();
      const byEventNorm = new Map();
      let cliffCount = 0;
      let minAgeObs = Infinity;
      let maxAgeObs = -Infinity;
      const cliffAges = [];

      for(const stint of compStints) {
        if(!eventCompStints.has(stint.event)) eventCompStints.set(stint.event, new Map());
        if(!eventCompStints.get(stint.event).has(compound)) eventCompStints.get(stint.event).set(compound, []);
        eventCompStints.get(stint.event).get(compound).push(stint);

        if(finite(stint.minAge)) minAgeObs = Math.min(minAgeObs, stint.minAge);
        if(finite(stint.maxAge)) maxAgeObs = Math.max(maxAgeObs, stint.maxAge);
        if(stint.cliffDetected || stint.cliff_detected) {
          cliffCount++;
          if(finite(stint.cliffAge)) cliffAges.push(stint.cliffAge);
        }
      }

      // Compute driver-weighted estimate for each event for this compound
      for(const [ev, stints] of (eventCompStints.entries())) {
        const cStints = stints.get(compound);
        if(!cStints || !cStints.length) continue;
        let wRawSum = 0, wRawVal = 0;
        let wNormSum = 0, wNormVal = 0;
        for(const s of cStints) {
          const w = Math.min(s.matchedLaps || 0, 20);
          wRawSum += w;
          wRawVal += w * s.slope;
          const rel = finite(s.relativeSlope) ? s.relativeSlope : s.field_normalized_slope;
          if(finite(rel)) {
            wNormSum += w;
            wNormVal += w * rel;
          }
        }
        if(wRawSum > 0) byEventRaw.set(ev, wRawVal / wRawSum);
        if(wNormSum > 0) byEventNorm.set(ev, wNormVal / wNormSum);
      }

      const rawEvValues = [...byEventRaw.values()].filter(finite);
      const normEvValues = [...byEventNorm.values()].filter(finite);
      const compoundLaps = compStints.reduce((sum, s) => sum + (s.matchedLaps || 0), 0);

      if(rawEvValues.length || normEvValues.length) {
        summaries[compound] = {
          slope: rawEvValues.length && (tyreSeasonStat!=='p75'||rawEvValues.length>=4) ? summarize(rawEvValues,tyreSeasonStat) : null,
          normSlope: normEvValues.length && (tyreSeasonStat!=='p75'||normEvValues.length>=4) ? summarize(normEvValues,tyreSeasonStat) : null,
          cliffCount,
          cliffAges,
          events: [...byEventRaw.keys()],
          stints: compStints.length,
          laps: compoundLaps,
          minAge: minAgeObs < Infinity ? minAgeObs : null,
          maxAge: maxAgeObs > -Infinity ? maxAgeObs : null,
          fieldSupported: compStints.length > 0 && compStints.every(s => s.fieldSupport >= 2)
        };
      }
    }

    // Now compute OVERALL or single compound score
    let seasonSlope = null;
    let seasonNormSlope = null;
    let complete = false;
    const present = tyreView === 'OVERALL'
      ? ['SOFT', 'MEDIUM', 'HARD'].map(c => summaries[c])
          .filter(c => c && c.events.length >= minimumCompoundEvents)
      : [summaries[tyreView]].filter(Boolean);

    if(tyreView === 'OVERALL') {
       // Average the compound season estimates equally; event weighting is
       // already applied within each compound summary above.
       const compoundRaw = present.map(c => c.slope).filter(finite);
       const compoundNorm = present.map(c => c.normSlope).filter(finite);
       seasonSlope = compoundRaw.length ? avg(compoundRaw) : null;
       seasonNormSlope = compoundNorm.length ? avg(compoundNorm) : null;
       complete = present.length >= 2 && new Set(present.flatMap(c=>c.events)).size >= minimumSeasonEvents && finite(seasonNormSlope);
    } else {
      seasonSlope = summaries[tyreView]?.slope ?? null;
      seasonNormSlope = summaries[tyreView]?.normSlope ?? null;
       complete = Boolean(summaries[tyreView]) && summaries[tyreView].events.length >= minimumSeasonEvents && finite(seasonNormSlope);
    }

    const compNote = tyreView === 'OVERALL' && present.length < 3
      ? `(${present.length}/3 compounds have ≥${minimumCompoundEvents} supported events)` : '';
    const softLaps = summaries['SOFT']?.laps || 0;
    const medLaps = summaries['MEDIUM']?.laps || 0;
    const hardLaps = summaries['HARD']?.laps || 0;
    const totalDryLaps = softLaps + medLaps + hardLaps;
    const compoundBreakdown = totalDryLaps > 0
      ? [
          softLaps > 0 ? `S: ${Math.round((softLaps / totalDryLaps) * 100)}%` : null,
          medLaps > 0 ? `M: ${Math.round((medLaps / totalDryLaps) * 100)}%` : null,
          hardLaps > 0 ? `H: ${Math.round((hardLaps / totalDryLaps) * 100)}%` : null
        ].filter(Boolean).join(' · ')
      : '';

    const minAgeOverall = Math.min(...present.map(c => c.minAge).filter(finite));
    const maxAgeOverall = Math.max(...present.map(c => c.maxAge).filter(finite));
    const cliffAgesAll = present.flatMap(c => c.cliffAges || []);
    const totalCompoundLaps = present.reduce((sum, c) => sum + (c.laps || 0), 0);

    rows.push({
      team: team.team,
      teamObj: team,
      color: team.color,
      slope: seasonSlope,
      normSlope: seasonNormSlope,
      cliffs: present.reduce((s, c) => s + (c.cliffCount || 0), 0),
      cliffAges: cliffAgesAll,
      events: new Set(present.flatMap(c => c.events)).size,
      stints: present.reduce((s, c) => s + c.stints, 0),
      laps: totalCompoundLaps,
      minAge: finite(minAgeOverall) ? minAgeOverall : null,
      maxAge: finite(maxAgeOverall) ? maxAgeOverall : null,
      usedStartCount,
      observedStints:observedStints.length,
      fieldSupported: present.length > 0 && present.every(c => c.fieldSupported),
      complete,
      compNote,
      compoundBreakdown,
      totalDryLaps
    });
  }

  const ordered = sorted(rows, {
    tyreTeam: r => r.team,
    tyreNorm: r => r.complete ? r.normSlope : null,
    tyreSlope: r => r.slope,
    tyreEvents: r => r.events,
    tyreStints: r => r.stints,
    tyreLaps: r => r.laps
  }, 'tyreNorm');

  return reactView('tyres',{metric:'relative',subject:tyreSubject,compound:{choices,value:tyreView,overallLabel:'All compounds'},
    chart:{rows:ordered,options:{title:`Relative tyre-age trend · ${tyreView === 'OVERALL' ? 'Available compounds' : tyreView}`,
      subtitle:`Same-event, same-compound cohorts of ≥3 teams · ${tyreSeasonStat==='p75'?'P75 worse GP':tyreSeasonStat==='median'?'Median GP':'Mean GP'} · Limited samples are provisional`,
      valueKey:'normSlope',unit:' s/lap',digits:3,signedValue:true,zeroBaseline:true}},
    sort:{team:sortHeaderModel('tyreTeam','Team'),norm:sortHeaderModel('tyreNorm','Extra ageing vs rivals'),stints:sortHeaderModel('tyreStints','Matched sample (stints / laps)',-1)},
    rows:ordered.map(r=>({team:r.teamObj,
      norm:{value:finite(r.normSlope)?r.normSlope:null,provisional:!r.complete?`Provisional · ${r.events}/${minimumSeasonEvents} supported events`:null},
      ageRange:(finite(r.minAge)&&finite(r.maxAge))?`L${r.minAge}–L${r.maxAge} (${r.maxAge-r.minAge+1} laps)`:'—',
      sample:`${r.stints} matched stint${r.stints===1?'':'s'} (${r.laps} laps)`,observed:r.observedStints>r.stints?r.observedStints:null,
      fieldSupported:r.fieldSupported,compound:tyreView==='OVERALL'&&r.compoundBreakdown?r.compoundBreakdown:tyreView,
      notes:[...(r.usedStartCount>0?[`${r.usedStartCount} matched stint${r.usedStartCount===1?'':'s'} on used tyres`]:[]),...(r.compNote?[r.compNote]:[])]}))});
}

function sprintPointsForTeam(selectedEvents,team) {
  let points=0,known=true;
  for(const event of selectedEvents){
    if(!sessionAvailable(event,'Sprint'))continue;
    const roster=event.R?.teams?.find(t=>t.team===team)?.drivers||[];
    const drivers=(event.S?.drivers||[]).filter(d=>roster.length?roster.includes(d.code):d.team===team);
    if(!drivers.length||roster.length&&drivers.length!==roster.length||drivers.some(d=>!finite(d.result?.points))){known=false;continue;}
    points+=drivers.reduce((sum,d)=>sum+d.result.points,0);
  }
  return {points,known};
}

function renderResults(teams) {
  const resultRows=teams.map(t=>{
    const sprint=sprintPointsForTeam(events,t.team);
    const known=t.pointsKnown&&sprint.known;
    return {...t,racePoints:t.pointsKnown?t.points:null,sprintPoints:sprint.known?sprint.points:null,
    points:known?t.points+sprint.points:null,
    // This ratio intentionally remains race-only; sprint starts are not races.
    pointsPerStart:t.starts&&t.pointsKnown?t.points/t.starts:null,
    finishRatePct:t.starts?100*t.finishes/t.starts:null,
    mechanicalPer1000Laps:t.completedLaps>0&&t.lapExposureEntries===t.starts?1000*(t.puRetirements+t.chassisRetirements)/t.completedLaps:null,
    mechanicalRatePct:t.starts?100*(t.puRetirements+t.chassisRetirements)/t.starts:null};});
  const ordered=sorted(resultRows,{
    resultTeam:t=>t.team,
    points:t=>t.points,
    pointsPerStart:t=>t.pointsPerStart,
    mechanicalRate:t=>t.mechanicalRatePct,
    mechanicalExposure:t=>t.mechanicalPer1000Laps,
    finish:t=>avg(t.positions),
    finishRate:t=>t.starts?t.finishes/t.starts:null,
    pu:t=>t.puRetirements,
    chassis:t=>t.chassisRetirements,
    incidents:t=>t.incidentRetirements,
    other:t=>t.otherRetirements + t.unknownRetirements
  },'points',-1);
  const selectedResult=resultsChartMetric==='exposure'?'mechanicalPer1000Laps':resultsChartMetric==='perStart'?'pointsPerStart':resultsChartMetric==='finishRate'?'finishRatePct':resultsChartMetric==='mechanicalRate'?'mechanicalRatePct':'points';
  // Rendered by src/views/ResultsView.tsx; the data-results-chart and sort
  // buttons it draws are still handled by the delegated click handler below.
  return reactView('results',{rows:ordered,chartMetric:resultsChartMetric,
    chart:{title:resultsChartMetric==='exposure'?'Confirmed PU/chassis retirements per 1,000 completed laps':resultsChartMetric==='perStart'?'Race points per race start':resultsChartMetric==='finishRate'?'Finish rate':resultsChartMetric==='mechanicalRate'?'Provisional PU/chassis retirements per start':'Points · races + sprints',
      subtitle:resultsChartMetric==='mechanicalRate'?'Cause-labelled retirements only · lower is better · unclassified cases can undercount':'Official race classifications · higher is better · keep start counts in view',
      valueKey:selectedResult,
      unit:resultsChartMetric==='exposure'?' /1,000 laps':['finishRate','mechanicalRate'].includes(resultsChartMetric)?'%':resultsChartMetric==='perStart'?' pts/start':' pts',
      digits:resultsChartMetric==='points'?0:3,signedValue:false,invertBest:!['mechanicalRate','exposure'].includes(resultsChartMetric)},
    sort:Object.fromEntries([['resultTeam','Team',1],['points','Points',-1],['pointsPerStart','Points / start',-1],['finish','Avg. finish',1],
      ['finishRate','Finished / starts',-1],['mechanicalRate','PU/chassis / starts',1],['pu','PU-related',1],['chassis','Chassis / team',1],
      ['incidents','Incidents',1],['other','Other / unverified',1],['mechanicalExposure','PU/chassis / 1,000 laps',1]]
      .map(([key,label,direction])=>[key,sortHeaderModel(key,label,direction)]))});
}

function pitSummary(events, teams) {
  const teamColors=new Map(teams.map(t=>[t.team,t.color]));
  const visits=[];
  const loadedRaces=events.filter(e=>e.pits);
  const groups=new Map(), drivers=new Map();
  // Pit timing should not depend on first loading the unrelated race-pace API.
  for(const event of loadedRaces)for(const entrant of event.pits.entrants||[]) {
    const team=entrant.team||'Unknown team',driver=entrant.driver||`#${entrant.driver_number}`;
    if(!groups.has(team))groups.set(team,{team,color:teamColors.get(team),visits:[],events:new Set()});
    const key=`${team}:${driver}`;
    if(!drivers.has(key))drivers.set(key,{team,driver,color:teamColors.get(team),visits:[],events:new Set()});
  }
  for(const event of loadedRaces) for(const team of event.R?.teams||[]) {
    if(!groups.has(team.team)) groups.set(team.team,{team:team.team,color:teamColors.get(team.team)||team.color,visits:[],events:new Set()});
    for(const driver of team.drivers||[]) {
      const key=`${team.team}:${driver}`;
      if(!drivers.has(key)) drivers.set(key,{team:team.team,color:teamColors.get(team.team)||team.color,driver,visits:[],events:new Set()});
    }
  }
  for(const event of loadedRaces) for(const visit of event.pits.visits||[]) {
    const driver=String(visit.driver||'').trim() || `#${visit.driver_number}`;
    const team=event.R?.teams?.find(t=>t.drivers?.includes(driver))?.team || visit.team || 'Unknown team';
    visits.push({...visit,driver,team,event:event.name,source:event.pits.source});
  }
  for(const visit of visits) {
    // A penalty served in the box is not a pit-crew time; keep it as evidence only.
    if(pitVisitMode==='service'&&(visit.visit_type==='penalty-served'||visit.visit_type!=='service'&&!finite(visit.stop_duration)))continue;
    const teamKey=visit.team, driverKey=`${teamKey}:${visit.driver}`;
    if(!groups.has(teamKey)) groups.set(teamKey,{team:teamKey,color:teamColors.get(teamKey),visits:[],events:new Set()});
    if(!drivers.has(driverKey)) drivers.set(driverKey,{team:teamKey,color:teamColors.get(teamKey),driver:visit.driver,visits:[],events:new Set()});
    for(const group of [groups.get(teamKey),drivers.get(driverKey)]) {
      group.visits.push(visit); group.events.add(visit.event);
    }
  }
  const summarizeTimes=values=>{
    const timed=values.filter(finite);
    const ordered=[...timed].sort((a,b)=>a-b),cut=Math.floor(ordered.length*.1),trimmed=ordered.slice(cut,ordered.length-cut);
    const winsorized=ordered.map((v,i)=>i<cut?ordered[cut]:i>=ordered.length-cut?ordered[ordered.length-cut-1]:v);
    return {mean:avg(timed),median:median(timed),fastest:timed.length?Math.min(...timed):null,
      trimmed:timed.length>=10?avg(trimmed):null,winsorized:timed.length>=10?avg(winsorized):null,
      mad:timed.length>=4?median(timed.map(v=>Math.abs(v-median(timed)))):null,
      p10:timed.length>=10?percentile(timed,.1):null,p25:percentile(timed,.25),p75:percentile(timed,.75),p90:timed.length>=10?percentile(timed,.9):null,count:timed.length};
  };
  const laneByEvent=new Map();
  for(const visit of visits)if(finite(visit.lane_duration)&&(pitVisitMode==='all'||visit.visit_type!=='penalty-served'&&(visit.visit_type==='service'||finite(visit.stop_duration)))){
    if(!laneByEvent.has(visit.event))laneByEvent.set(visit.event,new Map());
    const teamVisits=laneByEvent.get(visit.event);
    if(!teamVisits.has(visit.team))teamVisits.set(visit.team,[]);
    teamVisits.get(visit.team).push(visit.lane_duration);
  }
  // A team making several stops must not move the whole GP's field baseline.
  const laneBaselines=new Map([...laneByEvent].map(([event,teamVisits])=>
    [event,median([...teamVisits.values()].map(median))]));
  const summarize=group=>{
    const stop=summarizeTimes(group.visits.map(v=>v.stop_duration));
    const lane=summarizeTimes(group.visits.map(v=>v.lane_duration));
    const groupEvents=new Map();
    for(const visit of group.visits)if(finite(visit.lane_duration)&&finite(laneBaselines.get(visit.event))){
      if(!groupEvents.has(visit.event))groupEvents.set(visit.event,[]);
      groupEvents.get(visit.event).push(visit.lane_duration);
    }
    const laneRelative=summarizeTimes([...groupEvents].map(([event,times])=>median(times)-laneBaselines.get(event)));
    return {...group,stop,lane,laneRelative,avgStop:stop.mean,avgLane:lane.mean,
      stopCount:stop.count,laneCount:lane.count,eventCount:group.events.size};
  };
  return {teams:[...groups.values()].map(summarize),drivers:[...drivers.values()].map(summarize),visits,
    loaded:loadedRaces.length,total:events.filter(e=>sessionAvailable(e,'Race')).length};
}

function pitMiddleSpread(sample) {
  // A single visit has zero numerical spread but provides no evidence of consistency.
  return sample?.count>=4 && finite(sample.p25) && finite(sample.p75)
    ? sample.p75-sample.p25 : null;
}

function renderPits(teams) {
  const data=pitSummary(events,teams);
  const noStationary=data.visits.length>0 && !data.visits.some(v=>finite(v.stop_duration));
  const isLane=pitMeasure==='lane', relativeLane=isLane&&pitLaneBasis==='event';
  const measure=relativeLane?'laneRelative':isLane?'lane':'stop';
  const isDriver=pitSubject==='driver', rows=isDriver?data.drivers:data.teams;
  const ordered=sorted(rows,{
    pitName:r=>isDriver?r.driver:r.team,
    pitTeam:r=>r.team,
    pitMean:r=>r[measure].mean,
    pitMedian:r=>r[measure].median,
    pitTrimmed:r=>r[measure].trimmed,
    pitWinsorized:r=>r[measure].winsorized,
    pitFastest:r=>r[measure].fastest,
    pitP10:r=>r[measure].p10,
    pitP90:r=>r[measure].p90,
    pitSpread:r=>pitMiddleSpread(r[measure]),
    pitCount:r=>r[measure].count,
    pitEvents:r=>r.eventCount
  },'pitMedian');
  const failures=events.filter(e=>sessionAvailable(e,'Race')&&e.pitError);
  const pending=data.total-data.loaded-failures.length;
  const note=`${data.loaded}/${data.total} race${data.total===1?'':'s'} loaded${pending>0?' · loading pit timing…':''}${failures.length?` · ${failures.length} race${failures.length===1?'':'s'} unavailable`:''}. Stationary is the broadcast-style time stopped at the box; pit-lane time includes the stop. Raw summaries weight every timed visit; GP-relative lane summaries compare each team or driver's GP median with the median of team GP medians, then give each GP equal weight. Mean includes long stops; median shows a typical visit; the middle-50% spread shows consistency (≥4 samples); P10 and P90 show the quick and slow tails (≥10 samples). Missing stationary times are never inferred.`;
  const chartRows=ordered.map(r=>({...r,displayName:isDriver?r.driver:r.team,
    logoTeam:r.team,chartValue:pitChartMetric==='spread'?pitMiddleSpread(r[measure]):r[measure][pitChartMetric]}));
  const chartTitle=pitChartMetric==='trimmed'?'10% trimmed mean':pitChartMetric==='winsorized'?'10% winsorized mean':pitChartMetric==='spread'?'Middle-50% spread':pitChartMetric==='p10'?'P10 quick-end time':pitChartMetric==='p90'?'P90 slow-tail time':pitChartMetric==='mean'?'Mean time':pitChartMetric==='fastest'?(relativeLane?'Best GP gap':'Quickest visit'):'Median time';
  // Rendered by src/views/PitsView.tsx; its data-pit-* buttons are handled below.
  const sample=r=>({...r[measure],spread:pitMiddleSpread(r[measure])});
  return reactView('pits',{note,
    serviceNote:`${pitVisitMode==='service'?'Ranking confirmed service visits only.':'Diagnostic: includes all service, pass-through and unclassified visits.'} ${data.visits.filter(v=>v.visit_type!=='service'&&!finite(v.stop_duration)).length} visits lack confirmed service evidence. Missing stationary timing alone does not identify a pass-through; all visits remain in the evidence table.`,
    failures:failures.map(e=>({name:e.name,error:String(e.pitError)})),noStationary,
    quality:{stationary:data.visits.filter(v=>finite(v.stop_duration)).length,lane:data.visits.filter(v=>finite(v.lane_duration)).length,
      visits:data.visits.length,refresh:events.some(e=>e.pits&&e.pits.stationary_status!=='complete')},
    isLane,isDriver,relativeLane,chartMetric:pitChartMetric,
    chartRows:chartRows.filter(r=>r),chart:{
      title:`${chartTitle} · ${relativeLane?'vs GP median':isLane?'pit lane':'stationary stop'} · ${isDriver?'drivers':'teams'}`,
      subtitle:pitChartMetric==='spread'
        ? `75th minus 25th percentile · at least four ${relativeLane?'GPs':'visits'} · lower is more consistent`
        : pitChartMetric==='p10'||pitChartMetric==='p90'?`${pitChartMetric==='p10'?'10th':'90th'} percentile · at least ten ${relativeLane?'GPs':'visits'} · lower is better`
        : relativeLane?'Equal-weighted GP median gaps; zero is the GP field median':'Visit-weighted seconds · lower is faster',
      valueKey:'chartValue',labelKey:isDriver?'driver':'team',unit:' s',digits:3,signedValue:relativeLane&&pitChartMetric!=='spread',preserveSignedValues:relativeLane&&pitChartMetric!=='spread',zeroBaseline:true},
    emptyMessage:pending>0?'Loading published pit timings… measured visits will appear as each selected race is received.':['trimmed','winsorized','p10','p90'].includes(pitChartMetric)?'This statistic needs at least ten measured visits (or ten GPs in GP-relative mode).':pitChartMetric==='spread'?'At least four samples per team or driver are needed for the middle-50% chart.':pitMeasure==='stop'?'No published stationary-stop times for the selected races. Pit-lane timing is a separate measurement; select Pit lane to view it.':'No timed pit-lane visits for the selected races yet.',
    rows:ordered.map(r=>({...r,sample:sample(r)})),
    sort:Object.fromEntries([['pitName',isDriver?'Driver':'Team',1],['pitTeam','Team',1],['pitMean','Mean',1],['pitMedian','Median',1],
      ['pitFastest',relativeLane?'Best GP gap':'Quickest',1],['pitSpread','Spread (IQR)',1],['pitCount',relativeLane?'GP samples':'Visits',-1],['pitEvents','Races',-1]]
      .map(([key,label,direction])=>[key,sortHeaderModel(key,label,direction)])),
    visits:data.visits.sort((a,b)=>a.event.localeCompare(b.event)||a.lap-b.lap).map(v=>({event:v.event,team:{team:v.team,color:v.color},driver:v.driver,lap:v.lap,
      stop:v.stop_duration,lane:v.lane_duration,source:String(v.source||''),evidence:`${v.visit_type||'unknown'} · ${v.visit_evidence||'classification unavailable'}`}))});
}

function huberRegression(rounds, paces) {
  const n = rounds.length;
  if (n < 2) return { slope: null, intercept: null };
  const meanR = avg(rounds);
  const meanP = avg(paces);
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (rounds[i] - meanR) * (paces[i] - meanP);
    den += (rounds[i] - meanR) * (rounds[i] - meanR);
  }
  let b = den > 0 ? num / den : 0;
  let a = meanP - b * meanR;

  let res = paces.map((p, i) => p - (a + b * rounds[i]));
  let medRes = median(res);
  let mad = median(res.map(r => Math.abs(r - medRes)));
  let s = 1.4826 * mad;
  if (!finite(s) || s < 1e-6) return { slope: b, intercept: a };

  const c = 1.345;
  for (let iter = 0; iter < 50; iter++) {
    let wSum = 0, wXSum = 0, wYSum = 0;
    const weights = [];
    for (let i = 0; i < n; i++) {
      const u = Math.abs(res[i]) / s;
      const w = u <= c ? 1.0 : c / u;
      weights.push(w);
      wSum += w;
      wXSum += w * rounds[i];
      wYSum += w * paces[i];
    }
    if (wSum <= 0) break;
    const wXMean = wXSum / wSum;
    const wYMean = wYSum / wSum;
    let wNum = 0, wDen = 0;
    for (let i = 0; i < n; i++) {
      wNum += weights[i] * (rounds[i] - wXMean) * (paces[i] - wYMean);
      wDen += weights[i] * (rounds[i] - wXMean) * (rounds[i] - wXMean);
    }
    const bNew = wDen > 0 ? wNum / wDen : b;
    const aNew = wYMean - bNew * wXMean;
    if (Math.abs(bNew - b) < 1e-6) {
      b = bNew; a = aNew;
      break;
    }
    b = bNew; a = aNew;
    res = paces.map((p, i) => p - (a + b * rounds[i]));
    const newMad = median(res.map(r => Math.abs(r)));
    s = Math.max(1e-6, 1.4826 * newMad);
  }
  return { slope: b, intercept: a };
}


function renderTrend(teams) {
  // Rendered by src/views/TrendView.tsx; its data-trend-view buttons are handled below.
  if (!context?.season) return reactView('trend',{single:true,event:events[0]?.name||'Grand Prix'});
  const trendRows = teams.map(t => {
    // Track-evolution-adjusted gaps: a team moving from Q1 exits to Q3 runs
    // must not show the ~1% Q1->Q3 track gain as car development.
    const valid = t.q.filter(q => finite(q.adjusted)).map(q => ({...q, pace: q.adjusted})).sort((a,b)=>a.round-b.round);
    let first = null, last = null, label = '';
    let slopePerRound = null;
    let modelledShift = null;
    let leaveEventRange = null, fit = null;
    const n = valid.length;

    if (n >= 2) {
      const k = n >= 4 ? Math.max(2, Math.min(6, Math.floor(n / 4))) : 1;
      first = median(valid.slice(0, k).map(q => q.pace));
      last = median(valid.slice(-k).map(q => q.pace));
      label = n >= 4 ? `Median first ${k} → last ${k}` : `R${valid[0].round} → R${valid.at(-1).round}`;

      const h = huberRegression(valid.map(q => q.round), valid.map(q => q.pace));
      slopePerRound = h.slope;
      if(finite(h.slope)&&finite(h.intercept))fit=[valid[0].round,valid.at(-1).round].map(round=>({round,pace:h.intercept+h.slope*round}));
      const roundSpan = valid.at(-1).round - valid[0].round;
      modelledShift = finite(slopePerRound) ? slopePerRound * roundSpan : null;
      if(n>=5){
        const rates=valid.map((_,i)=>{const subset=valid.filter((_,j)=>j!==i);return huberRegression(subset.map(q=>q.round),subset.map(q=>q.pace)).slope;}).filter(finite);
        if(rates.length)leaveEventRange=[Math.min(...rates),Math.max(...rates)];
      }
    }

    const change = (finite(first) && finite(last)) ? last - first : null;
    const sampleTier = n >= 15 ? 'Broad (≥15 events)' : n >= 10 ? 'Moderate (10–14 events)' : 'Limited (<10 events)';
    const sampleTierClass = n >= 15 ? 'is-fast' : n >= 10 ? 'is-mid' : 'is-slow';
    return { team: t, valid, first, last, change, modelledShift, slopePerRound, fit, leaveEventRange, sampleTier, sampleTierClass, label, count: n };
  });

  const ordered = sorted(trendRows, {
    trendTeam: r => r.team.team,
    trendFirst: r => r.first,
    trendLast: r => r.last,
    trendChange: r => r.change,
    trendModelled: r => r.modelledShift,
    trendSlope: r => r.slopePerRound,
    trendCount: r => r.count
  }, trendView==='fitted'?'trendModelled':'trendChange');
  const showSensitivity=trendView==='fitted'&&ordered.some(row=>row.leaveEventRange);
  const rounds=events.map(e=>Number(e.round)).filter(finite);
  const changeKey=trendView==='fitted'?'trendModelled':'trendChange';
  return reactView('trend',{view:trendView,showSensitivity,
    // Plot exactly the adjusted observations used by the medians and fit.
    spark:{lo:Math.min(...rounds),hi:Math.max(...rounds),ceiling:Math.max(1,...trendRows.flatMap(t=>t.valid.map(q=>q.pace)))},
    sort:{team:sortHeaderModel('trendTeam','Team'),last:sortHeaderModel('trendLast','Start → latest'),
      change:sortHeaderModel(changeKey,'Change')},
    rows:ordered.map(row=>({team:row.team,first:row.first,last:row.last,label:row.label,count:row.count,sampleTier:row.sampleTier,
      change:row.change,fittedChange:row.modelledShift,slopePerRound:row.slopePerRound,range:row.leaveEventRange,fit:row.fit,
      points:row.valid.map(q=>({round:q.round,event:q.event,pace:q.pace}))}))});
}

function eventAdjustedScores(reports, valueOf, mode='mean',coverageMode=typeof telemetryCoverageMode==='undefined'?'inferred':telemetryCoverageMode,supportPriority='observations') {
  let observations=[];
  for(const {event,summary} of reports) {
    const measured=[...summary.rows.values()].map(row=>({team:row.team,value:valueOf(row)}))
      .filter(item=>finite(item.value));
    if(measured.length<3)continue;
    for(const item of measured)observations.push({...item,event:event.name});
  }
  if(!observations.length)return new Map();
  if(coverageMode==='common') {
    const teams=[...new Set(observations.map(o=>o.team))].sort();
    const byEvent=new Map();
    for(const o of observations){if(!byEvent.has(o.event))byEvent.set(o.event,new Map());byEvent.get(o.event).set(o.team,o.value);}
    let best=null;
    // Largest complete observed rectangle: no missing team/GP is imputed.
    const cohorts=new Map();
    for(const observed of byEvent.values()) {
      const own=new Set(observed.keys()),sets=[own,...[...cohorts.values()].map(c=>new Set([...c].filter(t=>own.has(t))))];
      for(const set of sets)if(set.size>=3)cohorts.set([...set].sort().join('\u0000'),set);
    }
    for(const set of [...cohorts.values()].sort((a,b)=>[...a].sort().join().localeCompare([...b].sort().join()))) {
      const cohort=[...set].sort();
      const eventIds=[...byEvent].filter(([,r])=>cohort.every(t=>r.has(t))).map(([id])=>id);
      const support=supportPriority==='teams'?cohort.length:cohort.length*eventIds.length;
      if(eventIds.length&&(!best||support>best.support||support===best.support&&(supportPriority==='teams'?eventIds.length>best.eventIds.length:cohort.length>best.cohort.length)))best={cohort,eventIds,support};
    }
    if(!best)return new Map();
    const centre=mode==='median'?median:avg;
    const values=new Map(best.cohort.map(t=>[t,centre(best.eventIds.map(id=>byEvent.get(id).get(t)))]));
    const baseline=Math.min(...values.values());
    const result=new Map([...values].map(([t,v])=>[t,Math.max(0,v-baseline)]));
    result.coverage={teams:best.cohort,events:best.eventIds};
    return result;
  }
  const graph=new Map();
  const byEvent=new Map();
  for(const observation of observations){
    if(!byEvent.has(observation.event))byEvent.set(observation.event,[]);
    byEvent.get(observation.event).push(observation.team);
  }
  for(const cohort of byEvent.values())for(const team of cohort){
    if(!graph.has(team))graph.set(team,new Set());
    for(const peer of cohort)graph.get(team).add(peer);
  }
  const unseen=new Set(graph.keys()),components=[];
  while(unseen.size){
    const group=new Set(),pending=[unseen.values().next().value];
    while(pending.length){const team=pending.pop();if(group.has(team))continue;group.add(team);unseen.delete(team);for(const peer of graph.get(team))if(!group.has(peer))pending.push(peer);}
    components.push(group);
  }
  components.sort((a,b)=>b.size-a.size||observations.filter(o=>b.has(o.team)).length-observations.filter(o=>a.has(o.team)).length||[...a].sort().join().localeCompare([...b].sort().join()));
  const supported=components[0];
  observations=observations.filter(o=>supported.has(o.team));
  const result=solveEventEffects(observations,mode);
  result.diagnostics.components=components.map(c=>[...c].sort());
  result.diagnostics.excludedComponents=components.slice(1).map(c=>[...c].sort());
  return result;
}

function solveEventEffects(observations,mode='mean',sensitivity=true) {
  // Eliminate GP offsets analytically, then solve the small entrant system.
  // Each GP has unit total weight: a large cohort is not an extra race.
  // Median minimizes a smoothed absolute-residual objective by IRLS; alternating
  // coordinate medians do not in general solve that objective.
  if(!observations.length)return new Map();
  const teams=[...new Set(observations.map(o=>o.team))].sort(),n=teams.length,index=new Map(teams.map((t,i)=>[t,i]));
  const groups=new Map();for(const o of observations){if(!groups.has(o.event))groups.set(o.event,[]);groups.get(o.event).push({...o,i:index.get(o.team)});}
  let weights=[...groups.values()].flatMap(rows=>rows.map(()=>1/rows.length)),effects=Array(n).fill(0),residual=[],iterations=0,converged=false;
  const linearSolve=(matrix,rhs)=>{
    const a=matrix.slice(1).map((r,i)=>[...r.slice(1),rhs[i+1]]);
    for(let c=0;c<n-1;c++){
      let p=c;for(let r=c+1;r<n-1;r++)if(Math.abs(a[r][c])>Math.abs(a[p][c]))p=r;
      [a[p],a[c]]=[a[c],a[p]];const v=a[c][c];if(Math.abs(v)<1e-13)return null;
      for(let j=c;j<n;j++)a[c][j]/=v;
      for(let r=0;r<n-1;r++)if(r!==c){const f=a[r][c];for(let j=c;j<n;j++)a[r][j]-=f*a[c][j];}
    }
    return [0,...a.map(r=>r[n-1])];
  };
  const scale=Math.max(1e-6,...observations.map(o=>Math.abs(o.value)));
  for(let iteration=0;iteration<(mode==='median'?120:1);iteration++){
    const matrix=Array.from({length:n},()=>Array(n).fill(0)),rhs=Array(n).fill(0);let cursor=0;
    for(const rows of groups.values()){
      const w=rows.map(()=>weights[cursor++]),sum=w.reduce((s,v)=>s+v,0),centre=rows.reduce((s,o,j)=>s+w[j]*o.value,0)/sum;
      rows.forEach((o,j)=>{rhs[o.i]+=w[j]*(o.value-centre);matrix[o.i][o.i]+=w[j];
        rows.forEach((p,k)=>matrix[o.i][p.i]-=w[j]*w[k]/sum);});
    }
    const next=linearSolve(matrix,rhs);if(!next)break;
    const change=Math.max(...next.map((v,i)=>Math.abs(v-effects[i])));effects=next;iterations=iteration+1;residual=[];cursor=0;
    for(const rows of groups.values()){
      const w=rows.map(()=>weights[cursor++]),sum=w.reduce((s,v)=>s+v,0);
      const offset=rows.reduce((s,o,j)=>s+w[j]*(o.value-effects[o.i]),0)/sum;
      rows.forEach(o=>residual.push(o.value-effects[o.i]-offset));
    }
    if(mode!=='median'||change<1e-9*scale&&iteration>=15){converged=true;break;}
    const epsilon=Math.max(1e-9*scale,scale*.01*.5**Math.floor(iteration/5));let i=0;
    weights=[];for(const rows of groups.values())for(const o of rows)weights.push(1/rows.length/Math.hypot(residual[i++],epsilon));
  }
  const best=Math.min(...effects),scores=new Map(teams.map((t,i)=>[t,Math.max(0,effects[i]-best)]));
  const residualRMS=residual.length?Math.sqrt(avg(residual.map(v=>v*v))):null;
  scores.coverage={teams,events:[...groups.keys()]};
  scores.diagnostics={method:mode==='median'?'equal-GP absolute-residual fit':'equal-GP least-squares fit',converged,iterations,residualRMS,
    observations:observations.length,groups:groups.size,support:Object.fromEntries(teams.map(t=>[t,observations.filter(o=>o.team===t).length])),leaveGPOut:null};
  // Cluster deletion is assumption sensitivity, not a measurement confidence
  // interval. Never bridge a component created by removing its only link.
  if(sensitivity&&groups.size>=4&&groups.size<=40){
    const ranges=Object.fromEntries(teams.map(t=>[t,[]])),anchor=teams[effects.indexOf(best)];
    for(const event of groups.keys()){
      const retained=observations.filter(o=>o.event!==event),seen=new Set([anchor]);let changed=true;
      while(changed){changed=false;for(const rows of groups.values())if(rows[0].event!==event&&rows.some(o=>seen.has(o.team)))for(const o of rows)if(!seen.has(o.team)){seen.add(o.team);changed=true;}}
      const alternative=solveEventEffects(retained.filter(o=>seen.has(o.team)),mode,false);
      if(!alternative.has(anchor))continue;
      for(const t of teams)if(alternative.has(t))ranges[t].push(alternative.get(t)-alternative.get(anchor));
    }
    scores.diagnostics.leaveGPOut=Object.fromEntries(teams.map(t=>[t,{fits:ranges[t].length,range:ranges[t].length>=3?[Math.min(...ranges[t]),Math.max(...ranges[t])]:null}]));
  }
  return scores;
}

// Straight line: the three measures that carried car-specific signal in
// validation; one is shown at a time. 160-250 km/h alone was the weakest and is
// inside 'Speed'; traction is a corner-exit measure and lives on Cornering.
const STRAIGHT_PILLS=[
  {key:'straight',label:'Speed',title:'Straight-line speed',subtitle:'seconds per straight, 160 km/h to the end of a 500 m run',hint:'Overall straight-line performance',
   note:"Each car's measured full-throttle acceleration, run over the same simulated straight: 160 to 250 km/h, then 500 m from 250 km/h. Comparing at equal speed means a faster corner exit is not credited to the straight. 2025 DRS-open and DRS-closed data are kept separate. Car, setup, tow and energy deployment together, not isolated engine power or drag."},
  {key:'straight_top',label:'Top end',title:'Top end, 250 km/h and above',subtitle:'seconds over a 500 m run from 250 km/h',hint:'Where power-unit deployment separates the cars',
   note:"The same simulated straight from 250 km/h onward. On 2026 cars this is shaped by electrical energy deployment (taper and clipping) as much as by drag or engine power; it is where the power units separate most."},
  {key:'energy',label:'Energy',title:'Speed lost at full throttle',subtitle:'km/h per lap on the audited straights',hint:'Energy clipping on 2026 power units',
   note:"Speed lost while flat out on the straights. At full throttle a car only loses speed when its deployable electrical energy runs out (clipping) or a tow has pushed it past its drag limit. This mainly matters for 2026 power units; 2025 cars rarely clip."}
];
let straightPill='straight';
function speedDomainEntities() {
  const style=new Map();
  for(const event of events){
    const list=telemetrySubject==='driver'?event.qualifyingDrivers||[]:event.Q?.teams||[];
    for(const t of list)if(!style.has(t.team))style.set(t.team,{team:t.team,color:t.color,displayName:t.displayName,logoTeam:t.logoTeam});
  }
  return style;
}
// View data for src/views/SpeedView.tsx (Cornering, Straight line, Braking).
function speedDomainChart(key,title,subtitle) {
  const meta=SPEED_DOMAIN_METRICS[key],season=speedDomainSeason(events,telemetrySubject,key),style=speedDomainEntities();
  const rows=season.rows.map(r=>({...(style.get(r.name)||{team:r.name}),value:r.value,missingReason:r.missingReason,traceProvisional:r.provisional}));
  // While GPs are still loading an empty chart is pending, not a missing measurement.
  if(!rows.length)return {title:title||meta.label,empty:running||speedDomainRunning[telemetrySubject]?'Loading qualifying telemetry…':key.startsWith('corner_')?'No shared supported corner measurement in this band. Missing values are not zero.':'No supported measurement in the loaded GPs. Missing values are not zero.'};
  return {title:title||meta.label,rows,options:{title:title||meta.label,subtitle:`${subtitle?subtitle+' · ':''}${season.gps} supported GP${season.gps===1?'':'s'} of ${events.filter(e=>e.Q).length} selected · ${season.events.join(', ')} · 0 = best${rows.some(r=>r.traceProvisional)?' · ≈ provisional: source gaps >0.6 s':''}`,unit:meta.unit,digits:meta.digits}};
}
function speedDomainLowConfidence(key) {
  return events.map(e=>e.speedDomain?.[telemetrySubject]?.reliability?.[SPEED_DOMAIN_METRICS[key].reliability]).find(Boolean)==='low';
}
function speedDomainEventTable(keys) {
  const style=speedDomainEntities(),rows=[];
  for(const event of events){
    const result=event.speedDomain?.[telemetrySubject];
    if(!result?.cars)continue;
    const values=Object.fromEntries(keys.map(k=>[k,speedDomainEventValues(result,k)]));
    for(const name of Object.keys(result.cars))rows.push({event:event.name,team:style.get(name)||{team:name},
      values:keys.map(k=>signed(values[k][name],SPEED_DOMAIN_METRICS[k].digits,SPEED_DOMAIN_METRICS[k].unit))});
  }
  return {subject:telemetrySubject==='driver'?'driver':'team',labels:keys.map(k=>SPEED_DOMAIN_METRICS[k].label),rows};
}
// Braking / mid-corner / exit split of each band: how a car gains, not just how much.
function speedDomainPhaseTable() {
  const style=speedDomainEntities(),several=events.filter(e=>e.Q).length>1;
  const sections=[['low','Low-speed'],['medium','Medium-speed'],['high','High-speed']].map(([band,label])=>({label,
    rows:speedDomainPhases(events,telemetrySubject,band).sort((a,b)=>(a.braking+a.mid+a.exit)-(b.braking+b.mid+b.exit))
      .map(r=>({team:style.get(r.name)||{team:r.name},braking:signed(r.braking,3,' s'),mid:signed(r.mid,3,' s'),exit:signed(r.exit,3,' s'),total:signed(r.braking+r.mid+r.exit,3,' s'),gps:r.gps}))}))
    .filter(section=>section.rows.length);
  return sections.length?{several,subject:telemetrySubject==='driver'?'driver':'team',sections}:null;
}
// Every corner, with speed-trace estimates, raw timestamps and source support.
function speedDomainCornerTable() {
  const style=speedDomainEntities();
  const measured=events.filter(e=>e.speedDomain?.[telemetrySubject]?.segments?.timed_corners?.length);
  if(!measured.length)return null;
  return {single:measured.length===1?measured[0].name:null,subject:telemetrySubject==='driver'?'driver':'team',
    events:measured.map(event=>({name:event.name,rows:event.speedDomain[telemetrySubject].segments.timed_corners.flatMap(c=>Object.entries(c.cars).sort((a,b)=>a[1].delta_s-b[1].delta_s).map(([name,v],i)=>({
      corner:i?null:{name:c.corner,detail:`${c.band} · ${fmt(c.metres,0,' m')} · field ${fmt(c.field_time_s,2,' s')}`},
      team:style.get(name)||{team:name},delta:signed(v.delta_s,3,' s'),braking:signed(v.phases_s.braking,3,' s'),mid:signed(v.phases_s.mid,3,' s'),exit:signed(v.phases_s.exit,3,' s'),
      speeds:`${fmt(v.entry_kmh,0)} / ${fmt(v.min_kmh,0)} / ${fmt(v.exit_kmh,0)}`,raw:signed(v.raw_delta_s,3,' s'),sensitivity:`±${fmt(v.registration_sensitivity_s,3,' s')}`,
      gap:`${fmt(v.max_packet_gap_s,2,' s')}${v.max_packet_gap_s>.6?' · Provisional':''}`})))}))};
}
function renderSpeedDomain() {
  const loaded=events.filter(e=>e.speedDomain?.[telemetrySubject]?.cars).length,total=events.filter(e=>e.Q).length;
  const failed=events.filter(e=>e.Q&&(e.speedDomainError||e.speedDomain?.[telemetrySubject]?.error));
  // Rendered by src/views/SpeedView.tsx; its data-straight-pill and data-speed-retry buttons are handled below.
  const head={status:{running:!!speedDomainRunning[telemetrySubject],loaded,total},
    failures:failed.map(e=>({name:e.name,error:String(e.speedDomainError||e.speedDomain[telemetrySubject].error)})),
    retry:failed.length&&!speedDomainRunning[telemetrySubject]?failed.length:0};
  if(activeMetric==='corners'){
    // One GP: seconds per lap. Several: % of the field's time in that corner
    // type, because seconds over Baku's nine slow corners and Bahrain's three
    // fast ones are not the same size of deficit.
    const several=events.filter(e=>e.Q).length>1,suffix=several?'_pct':'',per=several?' · % slower than the best':' · seconds per lap';
    return reactView('speed',{...head,metric:'corners',
      note:`Compare the measured speed traces over identical corner distances, with shared braking, mid-corner and exit phases. No hypothetical exit-speed credit or GPS path-length stretch enters the score. This assumes a common path: real racing-line differences are not resolved, and power, setup, driver and entry context still matter. ${several?'Values are % of estimated field time in that corner type, NOT % of lap time; each supported GP has equal weight.':'Values are estimated seconds across this GP’s supported corners in each band.'} Bands use the field minimum: low ≤120 km/h, medium 120–200, high >200. ≈ marks source gaps over 0.6 s; inspect the evidence before treating small gaps as meaningful.`,
      charts:[speedDomainChart('corner_low'+suffix,'Low-speed corners','below 120 km/h'+per),speedDomainChart('corner_medium'+suffix,'Medium-speed corners','120–200 km/h'+per),speedDomainChart('corner_high'+suffix,'High-speed corners','above 200 km/h'+per)],
      phases:speedDomainPhaseTable(),corners:speedDomainCornerTable(),events:speedDomainEventTable(['corner_low','corner_medium','corner_high'].map(k=>k+suffix)),
      traction:{lowConfidence:speedDomainLowConfidence('traction'),chart:speedDomainChart('traction','Traction (corner exit)','70–170 km/h'),events:speedDomainEventTable(['traction'])}});
  }
  if(activeMetric==='straight'){
    const pill=STRAIGHT_PILLS.find(p=>p.key===straightPill)||STRAIGHT_PILLS[0];
    return reactView('speed',{...head,metric:'straight',pill:pill.key,pills:STRAIGHT_PILLS.map(({key,label,hint})=>({key,label,hint})),note:pill.note,
      chart:speedDomainChart(pill.key,pill.title,pill.subtitle),events:speedDomainEventTable([pill.key])});
  }
  return reactView('speed',{...head,metric:'braking',lowConfidence:speedDomainLowConfidence('braking'),
    note:`Average deceleration from brake onset until the car reaches its own apex speed, at every braked corner. Distances come from GPS, and each car is compared with the field at the same speeds, because downforce makes every car brake harder when faster. % longer braking distance than the best ${telemetrySubject==='driver'?'driver':'team'}. The 4 Hz feed places the brake onset only to within a few metres, so differences under about 2% in a single GP are noise.`,
    chart:speedDomainChart('braking','Longer braking distance','same speed drop · % longer than the best'),events:speedDomainEventTable(['braking'])});
}
function renderMetricBoundaryEvidence(kind){
  if(kind==='tyres')return '<p class="performance-note">These derivatives describe fitted pace inside each run’s observed age range. A late slope increase can reflect wear, management or conditions; it is not a certified physical tyre cliff. Fuel adds the selected assumption to every slope. No curve is extrapolated into remaining tyre life.</p>'+table(
    ['Team','GP','Driver / stint','C grade','Age support','Warm-up slope','Steady slope','Late slope','Change age','Model'],aggregate().flatMap(t=>(t.tyreAgeStints||[]).map(s=>{const f=tyreLapMode==='clear'?s.clean_air:s,n=f?.nonlinear,add=tyreCorrection==='fuel'?tyreFuelRate:0;return [teamLabel(t),escape(s.event),`${escape(s.driver)} · ${s.stint}`,escape(s.compound_grade||'Unmapped'),n?.range?.join('–')||'—',fmt(finite(n?.warmup_slope)?n.warmup_slope+add:null,3,' s/lap'),fmt(finite(n?.steady_slope)?n.steady_slope+add:null,3,' s/lap'),fmt(finite(n?.late_slope)?n.late_slope+add:null,3,' s/lap'),n?.change_age??'No supported change',escape(n?.status||'Previous source · refresh')];})));
  return '';
}
function deferPerformanceEvidence(html) {
  lazyEvidence.clear();
  return html.replace(/(<details\b[^>]*>\s*<summary\b[^>]*>[\s\S]*?<\/summary>)([\s\S]*?)(<\/details>)/g,(whole,start,body,end)=>{
    const marker=/data-metric-evidence="([^"]+)"/.exec(body);
    if(!marker&&(!body.includes('performance-table-wrap')||/<details\b/.test(body)))return whole;
    const key=String(lazyEvidence.size);lazyEvidence.set(key,marker?()=>renderMetricBoundaryEvidence(marker[1]):body);
    return start+`<div data-lazy-evidence="${key}"></div>`+end;
  });
}
function hydratePerformanceEvidence(detail) {
  const host=detail.querySelector('[data-lazy-evidence]');if(!host||host.dataset.loaded==='true')return;
  const content=lazyEvidence.get(host.dataset.lazyEvidence);
  host.innerHTML=(typeof content==='function'?content():content)||'';host.dataset.loaded='true';
  if(host.querySelectorAll('tbody tr').length>=10)host.insertAdjacentHTML('afterbegin','<label class="evidence-search">Filter evidence <input type="search" data-evidence-search placeholder="Team, driver, GP or source"></label>');
  window.ApexPresentation?.arrangePerformance(host,activeMetric);
}
root.addEventListener('toggle',event=>{if(event.target.matches('details')&&event.target.open)hydratePerformanceEvidence(event.target);},true);
root.addEventListener('input',event=>{
  if(!event.target.matches('[data-evidence-search]'))return;
  const query=event.target.value.trim().toLowerCase();
  for(const row of event.target.closest('[data-lazy-evidence]').querySelectorAll('tbody tr'))row.hidden=!!query&&!row.textContent.toLowerCase().includes(query);
});

function performanceUIKey(element) {
  if(element.matches('.performance-table-wrap'))return 'table:'+String(element.querySelector('thead')?.textContent||'').replace(/[⇅▲▼]/g,'').replace(/\s+/g,' ').trim();
  return element.className+'|'+(element.getAttribute('aria-label')||'');
}
function capturePerformanceUI(container) {
  const focused=document.activeElement;
  return {
    scroll:[...container.querySelectorAll('.performance-table-wrap,.performance-mode,.performance-scope-toggle,.performance-band-options')]
      .map(el=>({key:performanceUIKey(el),left:el.scrollLeft,top:el.scrollTop,focused:el===focused})),
    details:[...container.querySelectorAll('details[open]')].map(el=>el.querySelector('summary')?.textContent.trim()),
    focus:container.contains(focused)?[...focused.attributes].filter(a=>a.name.startsWith('data-')&&!a.name.startsWith('data-ui-')).map(a=>[a.name,a.value]):[],
  };
}
function restorePerformanceUI(container,state) {
  for(const el of container.querySelectorAll('details'))if(state.details.includes(el.querySelector('summary')?.textContent.trim()))el.open=true;
  for(const el of container.querySelectorAll('.performance-table-wrap,.performance-mode,.performance-scope-toggle,.performance-band-options')) {
    const old=state.scroll.find(row=>row.key===performanceUIKey(el));
    if(old){el.scrollLeft=old.left;el.scrollTop=old.top;if(old.focused)el.focus({preventScroll:true});}
  }
  if(state.focus.length) {
    const selector=state.focus.map(([name,value])=>`[${name}="${CSS.escape(value)}"]`).join('');
    const replacement=container.querySelector(selector);
    if(replacement&&!replacement.disabled)replacement.focus({preventScroll:true});
  }
}
// Background loaders deliver dozens of results in bursts; re-rendering the
// whole view for each one blocked the page. Coalesce them to one per frame.
let renderQueued=false;
function scheduleRender() {
  if(renderQueued)return;
  renderQueued=true;
  // A timer, not requestAnimationFrame: frames pause in background tabs, which
  // froze progress until the whole load finished.
  setTimeout(()=>{renderQueued=false;render();},60);
}
function render() {
  const state=capturePerformanceUI(root);
  reactViewProps=new Map();
  try {renderContent();} finally {
    window.ApexReact?.mountAll(root,reactViewProps);
    window.ApexPresentation?.arrangePerformance(root,activeMetric);
    window.ApexUI?.decorate(root);
    restorePerformanceUI(root,state);
    root.querySelectorAll('details[open]').forEach(hydratePerformanceEvidence);
    syncCarUrl();
  }
}
function renderContent() {
  const modes=[
    ['pace','Pace'],
    ['corners','Cornering'],
    ['straight','Straight line'],
    ['braking','Braking'],
    ['pits','Pit stops'],
    ['tyres','Tyre trend'],
    ['trend','Development & updates'],
    ['results','Reliability & results']
  ];
  $('carPerformance').classList.toggle('is-descriptions-hidden',!showPerformanceDescriptions);
  const navEmoji={pace:'⏱️',corners:'🏎️',straight:'🚀',braking:'🛑',pits:'🔧',tyres:'🛞',trend:'📈',results:'🏆'};
  const modeBar = `<div class="performance-toolbar"><div class="performance-mode" role="tablist" aria-label="Performance metric" aria-orientation="horizontal">${modes.map(([key,label])=>`<button type="button" role="tab" data-performance-metric="${key}" aria-controls="performanceMetricPanel" tabindex="${activeMetric===key?0:-1}" aria-pressed="${activeMetric===key}" aria-selected="${activeMetric===key}"><span class="metric-nav-emoji" aria-hidden="true">${navEmoji[key]}</span>${label}</button>`).join('')}</div><button type="button" class="performance-explain-toggle" data-performance-refresh ${running?'disabled':''} title="Re-fetch the selected events and replace cached measurements. The first refresh can take longer.">Refresh data</button></div>`;

  if(!context || (!events.length && !running)) {
    root.innerHTML = modeBar + `
      <div class="dashboard-card performance-empty" id="performanceMetricPanel" role="tabpanel" aria-label="Performance measurements">
        <div class="empty-icon-badge" aria-hidden="true"></div>
        <h3>${errors.length?'Source retrieval failed':'Ready for analysis'}</h3>
        ${errors.length?errors.map(e=>`<p class="performance-error">${escape(e.event.name)} · ${escape(e.session)}: ${escape(e.message)}</p>`).join('')+'<p>Choose Analyse to retry. Other sessions and supported cached results are not treated as zero.</p>':'<p>Select a season and scope above, then click <strong>Analyse</strong> to calculate car pace, cornering performance, straight-line speeds, and tyre trends.</p>'}
      </div>`;
    return;
  }

  const telemetryMode=['corners','straight','braking'].includes(activeMetric);
  const teams=telemetryMode?[]:aggregate();
  const errorMarkup = errors.map(e=>`<div class="performance-error"><span class="error-dot"></span><span>${escape(e.event.name)} · ${e.session==='Q'?'Qualifying':e.session==='R'?'Race':'Telemetry'}: ${escape(e.message)}</span></div>`).join('');
  const provisional=provisionalPerformanceSessions(events);
  const provisionalNotice=provisional.length?`<p class="performance-note" role="status">Provisional · live, incomplete or unconfirmed session data: ${provisional.map(escape).join('; ')}. Results may change. Use Refresh data for the latest available observations.</p>`:'';
  const recordedNotices=events.flatMap(e=>['Q','R','pits'].filter(s=>e[s]?.source_cache).map(s=>`${e.name} ${s==='Q'?'qualifying':s==='pits'?'pit visits':'race'}${e[s].source_cache.refresh_failed||e[s].source_cache.stale?' (live refresh unavailable)':''}`));
  const sourceNotice=recordedNotices.length?`<details class="performance-source-note"><summary>Retained session sources</summary><p>${recordedNotices.map(escape).join(' · ')}. Recalculated with the current methodology; missing fields remain unknown.</p></details>`:'';
  const speedMode=telemetryMode&&speedDomainActive();
  // One measurement method on the page; the window-timing views were retired
  // as duplicates (see docs/speed-domain-methodology-20261020.md).
  const methodToggle='';
  const telemetryControls=telemetryMode?`<div class="performance-actions">${telemetrySubjectControls()}${methodToggle}${activeMetric==='corners'?cornerSessionControls():''}${qualifyingMetricsRunning?'<button type="button" data-qualifying-stop>Stop telemetry</button>':''}</div>`:'';
  let content = speedMode?renderSpeedDomain():(activeMetric==='pace'?renderPace(teams):activeMetric==='corners'&&cornerSession==='race'?renderRaceCorners():activeMetric==='tyres'?renderRace(teams):activeMetric==='results'?renderResults(teams):activeMetric==='pits'?renderPits(teams):renderTrend(teams));
  const metricEvidence=activeMetric==='tyres'?'<details class="dashboard-card performance-methods"><summary>Warm-up, steady trend and late falloff</summary><div data-metric-evidence="tyres"></div></details>':'';
  const metricHeading=window.ApexPresentation?.metricHeading(activeMetric,{year:context.year,events:events.length,subject:telemetrySubject,session:cornerSession})||'';
  root.innerHTML = deferPerformanceEvidence(modeBar + `<div id="performanceMetricPanel" role="tabpanel" data-metric="${activeMetric}" aria-label="${escape(modes.find(([key])=>key===activeMetric)?.[1]||'Performance')} measurements">`+metricHeading+'<p class="performance-definition">'+escape(window.ApexAnalysis.definitions[activeMetric].description)+'</p>'+telemetryControls + provisionalNotice+sourceNotice+errorMarkup+content+metricEvidence+'</div>');
}

// ---------------------------------------------------------------------------
// Event Listeners & Interactive Wiring
// ---------------------------------------------------------------------------
document.querySelectorAll('[data-analysis-view]').forEach(button=>button.addEventListener('click',event=>{
  // A pointer click cross-fades the two views (motion.js); links, history
  // and keyboard activation switch at once.
  const animate=event.detail>0&&!restoringView&&button.getAttribute('aria-selected')!=='true';
  const run=()=>{
  const performance=button.dataset.analysisView==='performance';
  if(!restoringView)window.ApexUrl?.write(performance?'cars':'session',performance?(initialized?carUrlState():window.ApexUrl.remembered('cars')||{}):window.ApexUrl.remembered('session')||window.sessionUrlState?.()||{});
  document.body.classList.toggle('performance-view',performance);
  $('carPerformance').hidden=!performance;
  document.querySelectorAll('[data-analysis-view]').forEach(b=>{b.setAttribute('aria-selected',String(b===button));b.tabIndex=b===button?0:-1;});
  if(!performance) { if(running||traceRunning) stop(); window.dispatchEvent(new Event('resize')); }
  if(performance&&!initialized) {
    initialized=true;
    const year=new Date().getFullYear();
    $('performanceYear').innerHTML=Array.from({length:year-2017},(_,i)=>`<option value="${year-i}">${year-i}</option>`).join('');
    syncSelect($('performanceYear'));
    if ($('performanceScope')) syncSelect($('performanceScope'));
    calendarReady=loadCalendar();
  }
  else if(performance)refreshPerformanceAvailability();
};
  if(animate&&window.ApexMotion)window.ApexMotion.transition(run);else run();
}));

$('performanceYear').addEventListener('change',()=>{reset();calendarReady=loadCalendar();});

// ---------------------------------------------------------------------------
// Shareable URL (url-state.js): ?view=cars&year&scope&races&metric&subject&session&pill&run
// ---------------------------------------------------------------------------

const URL_METRICS=['pace','corners','straight','braking','pits','tyres','trend','results'];
function carUrlState() {
  // Defaults are left out, so a plain season view stays a short link.
  const races=activeScope==='tracks'?calendar.filter(e=>selectedTracks.has(e.name)).map(e=>e.round).join(','):'';
  return {year:$('performanceYear').value||'',scope:activeScope==='tracks'?'tracks':'',races,
    metric:activeMetric==='pace'?'':activeMetric,subject:telemetrySubject==='driver'?'driver':'',
    session:cornerSession==='race'?'race':'',pill:straightPill==='straight'?'':straightPill,run:context?'1':''};
}
function syncCarUrl() {
  if(restoringUrl||!initialized||$('carPerformance').hidden)return;
  window.ApexUrl?.write('cars',carUrlState());
}
function showAnalysisView(view) {
  // Switch views for a link or the back button without writing a new entry.
  const button=document.querySelector(`[data-analysis-view="${view}"]`);
  if(!button||button.getAttribute('aria-selected')==='true')return;
  restoringView=true;try{button.click();}finally{restoringView=false;}
}
async function applyCarUrl(params) {
  restoringUrl=true;
  try {
    showAnalysisView('performance');
    await calendarReady;
    const year=$('performanceYear');
    if(params.year&&year.value!==params.year&&[...year.options].some(o=>o.value===params.year)){
      year.value=params.year;syncSelect(year);reset();calendarReady=loadCalendar();await calendarReady;
    }
    const scope=params.scope==='tracks'?'tracks':'season';
    if(scope!==activeScope)document.querySelector(`[data-performance-scope="${scope}"]`)?.click();
    if(scope==='tracks'){
      const rounds=new Set(String(params.races||'').split(',').map(Number).filter(Number.isFinite));
      selectedTracks.clear();calendar.filter(e=>rounds.has(Number(e.round))).forEach(e=>selectedTracks.add(e.name));
      renderTrackPills();
    }
    activeMetric=URL_METRICS.includes(params.metric)?params.metric:'pace';
    telemetrySubject=params.subject==='driver'?'driver':'team';
    cornerSession=params.session==='race'?'race':'qualy';
    straightPill=STRAIGHT_PILLS.some(p=>p.key===params.pill)?params.pill:'straight';
    const runnable=scope==='season'||selectedTracks.size>0;
    // Same selection already analysed (back/forward between categories): reuse it.
    const same=context&&String(context.year)===year.value&&String(context.selectedTracks||[])===String(scope==='tracks'?[...selectedTracks]:context.selectedTracks||[]);
    if(params.run==='1'&&runnable&&!(same&&events.length)){void analyse();}
    else {render();if(context)loadActiveTelemetry();}
  } finally {restoringUrl=false;syncCarUrl();}
}
window.ApexUrl?.onRestore('cars',params=>void applyCarUrl(params));
window.ApexShowView=showAnalysisView;
{
  const initial=window.ApexUrl?.read();
  if(initial?.view==='cars')void applyCarUrl(initial.params);
}

// Scope Toggle (Pill Toggle: [ Season to date ] [ Tracks ])
document.querySelectorAll('[data-performance-scope]').forEach(btn => {
  btn.addEventListener('click', () => {
    const scope = btn.dataset.performanceScope;
    if (activeScope === scope) return;
    activeScope = scope;
    document.querySelectorAll('[data-performance-scope]').forEach(b => {
      b.setAttribute('aria-pressed', String(b.dataset.performanceScope === activeScope));
    });
    const isSeason = activeScope === 'season';
    const tray = $('performanceTrackTray');
    if (tray) tray.hidden = isSeason;
    // Satisfy compatibility check: performanceEventField hidden when performanceScope is season
    if ($('performanceEventField')) $('performanceEventField').hidden=($('performanceScope')?.value === 'season' || activeScope === 'season');
    renderTrackPills();
    updateTrackCount();
    reset();
  });
});

// Track Tray Batch Actions
$('performanceSelectAllTracks')?.addEventListener('click', () => {
  calendar.forEach(e => selectedTracks.add(e.name));
  renderTrackPills();
  reset();
});

$('performanceSelectLatestTracks')?.addEventListener('click', () => {
  selectedTracks.clear();
  calendar.slice(-3).forEach(e => selectedTracks.add(e.name));
  renderTrackPills();
  reset();
});

$('performanceClearTracks')?.addEventListener('click', () => {
  selectedTracks.clear();
  renderTrackPills();
  reset();
});

// Track Pill Click Delegation
$('performanceTrackPills')?.addEventListener('click', (ev) => {
  const pill = ev.target.closest('.track-pill');
  if (!pill) return;
  const name = pill.dataset.trackName;
  if (!name) return;
  if (selectedTracks.has(name)) {
    selectedTracks.delete(name);
  } else {
    selectedTracks.add(name);
  }
  pill.setAttribute('aria-pressed', String(selectedTracks.has(name)));
  updateTrackCount();
  reset();
});

// Fallback legacy event listeners if present in DOM
if ($('performanceEvent')) {
  $('performanceEvent').addEventListener('change', () => {
    reset();
    syncSelect($('performanceEvent'));
  });
}
if ($('performanceScope')) {
  $('performanceScope').addEventListener('change', () => {
    reset();
    const isSeason = $('performanceScope').value === 'season';
    if ($('performanceEventField')) $('performanceEventField').hidden = isSeason;
    syncSelect($('performanceScope'));
  });
}

$('performanceLoad').addEventListener('click',analyse);
$('performanceCancel').addEventListener('click',stop);

root.addEventListener('keydown',event=>{
  const current=event.target.closest('[data-performance-metric]');
  if(!current||event.ctrlKey||event.metaKey||event.altKey||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key))return;
  const buttons=[...root.querySelectorAll('[data-performance-metric]')],index=buttons.indexOf(current);
  const next=event.key==='Home'?buttons[0]:event.key==='End'?buttons.at(-1):buttons[(index+(['ArrowRight','ArrowDown'].includes(event.key)?1:-1)+buttons.length)%buttons.length];
  event.preventDefault();const key=next.dataset.performanceMetric;next.click();
  const replacement=root.querySelector(`[data-performance-metric="${key}"]`);
  replacement?.focus({preventScroll:true});replacement?.scrollIntoView({block:'nearest',inline:'nearest'});
});
root.addEventListener('change',event=>{
  const select=event.target.closest('[data-tyre-plot-filter]');
  if(!select)return;
  const kind=select.dataset.tyrePlotFilter;
  const controls=select.closest('.performance-tyre-plot-controls');
  tyrePlotTeam=controls.querySelector('[data-tyre-plot-filter="team"]').value;
  tyrePlotDriver=controls.querySelector('[data-tyre-plot-filter="driver"]').value;
  tyrePlotEvent=controls.querySelector('[data-tyre-plot-filter="event"]').value;
  tyreRunKey=kind==='run'?select.value:'';
  if(kind==='team'){tyrePlotDriver='';tyrePlotEvent='';}
  if(kind==='driver')tyrePlotEvent='';
  const scrollY=window.scrollY;
  render();
  const updatedSelect=root.querySelector(`[data-tyre-plot-filter="${kind}"]`);
  (updatedSelect?.closest('.select-shell')?.querySelector('.select-trigger')||updatedSelect)?.focus({preventScroll:true});
  window.scrollTo({top:scrollY,behavior:'instant'});
});

root.addEventListener('click',event=>{
  const resultsMeasure=event.target.closest('[data-results-chart]');
  if(resultsMeasure){resultsChartMetric=resultsMeasure.dataset.resultsChart;render();return;}
  const compound=event.target.closest('[data-tyre-compound]');
  if(compound){tyreView=compound.dataset.tyreCompound;render();root.querySelector(`[data-tyre-compound="${tyreView}"]`)?.focus({preventScroll:true});return;}

  if(event.target.closest('[data-performance-refresh]')){void analyse(true);return;}
  if(event.target.closest('[data-qualifying-stop]')){qualifyingMetricsController?.abort();return;}
  if(event.target.closest('[data-speed-retry]')){
    for(const e of events){if(e.speedDomainError||e.speedDomain?.[telemetrySubject]?.error){delete e.speedDomainError;if(e.speedDomain)delete e.speedDomain[telemetrySubject];}}
    void loadSpeedDomain(false);return;
  }
  const straightPillButton=event.target.closest('[data-straight-pill]');
  if(straightPillButton){straightPill=straightPillButton.dataset.straightPill;render();return;}
  const subjectButton=event.target.closest('[data-telemetry-subject]');
  if(subjectButton){telemetrySubject=subjectButton.dataset.telemetrySubject;sortKey='';render();loadActiveTelemetry();return;}
  const cornerSessionButton=event.target.closest('[data-corner-session]');
  if(cornerSessionButton){cornerSession=cornerSessionButton.dataset.cornerSession;render();loadActiveTelemetry();return;}
  if(event.target.closest('[data-race-corners-load]')){void loadRaceCorners();return;}
  if(event.target.closest('[data-race-corners-stop]')){raceCornerController?.abort();return;}
  const cornerBandButton=event.target.closest('[data-corner-band]');
  if(cornerBandButton){cornerGraphBand=cornerBandButton.dataset.cornerBand;render();return;}
  const paceStatButton=event.target.closest('[data-pace-stat]');
  if(paceStatButton){paceSeasonStat=paceStatButton.dataset.paceStat;sortKey='race';render();return;}

  const tyreCorrectionButton=event.target.closest('[data-tyre-correction]');

  if(tyreCorrectionButton){tyreCorrection=tyreCorrectionButton.dataset.tyreCorrection;render();return;}

  const tyreRunButton=event.target.closest('[data-tyre-run]');
  if(event.target.closest('[data-tyre-exclusions]')){tyreShowExcluded=!tyreShowExcluded;render();return;}
  if(tyreRunButton){tyreRunKey=tyreRunButton.dataset.tyreRun;render();return;}
  const trendViewButton=event.target.closest('[data-trend-view]');
  if(trendViewButton){trendView=trendViewButton.dataset.trendView;sortKey=trendView==='fitted'?'trendModelled':'trendChange';sortDirection=1;render();return;}
  const metric=event.target.closest('[data-performance-metric]');
  if(metric) {
    const next=metric.dataset.performanceMetric,changed=next!==activeMetric;
    const update=()=>{activeMetric=next;if(events.length&&!running)updateStatus(`Ready · ${events.length} selected event${events.length===1?'':'s'}. Cached results are reused.`);render();if(changed)window.ApexMotion?.enter($('carPerformance'));};
    // Pointer navigation animates (motion.js); keyboard activation needs the new tab in the DOM at once.
    if(changed&&event.detail>0&&window.ApexMotion)window.ApexMotion.transition(update);else update();
    if(next==='pits')loadPitData();loadActiveTelemetry();return;
  }
  if(event.target.closest('[data-pit-retry]')){loadPitData(true);return;}
  const pitMeasureButton=event.target.closest('[data-pit-measure]');
  if(pitMeasureButton&&!pitMeasureButton.disabled){pitMeasure=pitMeasureButton.dataset.pitMeasure;render();return;}
  const pitSubjectButton=event.target.closest('[data-pit-subject]');
  if(pitSubjectButton){pitSubject=pitSubjectButton.dataset.pitSubject;render();return;}
  const pitChartButton=event.target.closest('[data-pit-chart]');
  if(pitChartButton){pitChartMetric=pitChartButton.dataset.pitChart;render();return;}
  const pitLaneBasisButton=event.target.closest('[data-pit-lane-basis]');
  if(pitLaneBasisButton){pitLaneBasis=pitLaneBasisButton.dataset.pitLaneBasis;render();return;}
  const sort=event.target.closest('[data-performance-sort]');
  const tyreMetricButton=event.target.closest('[data-tyre-metric]');
  if(tyreMetricButton){tyreMetric=tyreMetricButton.dataset.tyreMetric;sortKey=tyreMetric==='age'?'tyreAgeValue':'tyreNorm';sortDirection=1;render();return;}
  const tyreSubjectButton=event.target.closest('[data-tyre-subject]');
  if(tyreSubjectButton){tyreSubject=tyreSubjectButton.dataset.tyreSubject;render();return;}


  const qualyModeBtn=event.target.closest('[data-qualy-mode]');
  if(qualyModeBtn){qualyPaceMode=qualyModeBtn.dataset.qualyMode;render();}
  if(sort) {
    const scrollY=window.scrollY;
    const table=sort.closest('.performance-table-wrap');
    const tableIndex=[...root.querySelectorAll('.performance-table-wrap')].indexOf(table);
    const scrollLeft=table?.scrollLeft||0;
    const group=tableSortGroups.get(sort.dataset.performanceSort)||sort.dataset.sortTable;
    const saved=tableSortStates.get(group);
    sortDirection=saved?.key===sort.dataset.performanceSort?-saved.direction:Number(sort.dataset.sortDirection||1);
    sortKey=sort.dataset.performanceSort;
    tableSortStates.set(group,{key:sortKey,direction:sortDirection});
    render();
    const replacement=root.querySelectorAll('.performance-table-wrap')[tableIndex];
    if(replacement) replacement.scrollLeft=scrollLeft;
    window.scrollTo({top:scrollY,behavior:'instant'});
  }
});

// Auto-enhance selects on DOM load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('#carPerformance .select-shell select').forEach(sel => {
      if (typeof window.enhanceSelect === 'function') window.enhanceSelect(sel);
    });
  });
} else {
  document.querySelectorAll('#carPerformance .select-shell select').forEach(sel => {
    if (typeof window.enhanceSelect === 'function') window.enhanceSelect(sel);
  });
}
