/* Session analysis: render orchestration, shareable URL and corner/section analysis. */
// Shareable URL for this view (url-state.js): ?year&round&session&laps=VER.11,NOR.16.
// Round, not name: event names survive venue changes.
function sessionUrlState() {
  if (!sessionEventName || !loadedSessionQuery) return {};
  const query = new URLSearchParams(loadedSessionQuery);
  return {year: query.get('year'), round: query.get('round'), session: query.get('session'),
    laps: loaded.map(lap => `${lap.code}.${lap.lap}`).join(',')};
}
window.sessionUrlState = sessionUrlState;
function syncSessionUrl() {
  if (restoringSessionUrl || !sessionEventName || document.body.classList.contains('performance-view')) return;
  window.ApexUrl?.write('session', sessionUrlState());
}
async function applySessionUrl(params) {
  window.ApexShowView?.('session');
  if (!params?.year || !params?.round) return;
  restoringSessionUrl = true;
  try {
    const year = $('#year');
    if (selectValue(year) !== params.year && [...year.options].some(option => option.value === params.year)) {
      year.value = params.year; syncSelectUI(year); calendarReady = loadCalendar(); await calendarReady;
    } else await calendarReady?.catch(() => {});
    if (!calendar.some(event => String(event.round) === String(params.round))) return;
    customSelectValues.delete($('#gp'));
    $('#gp').value = String(params.round); syncSelectUI($('#gp'));
    populateSessions(params.session || null);
    const loadedQuery = new URLSearchParams(loadedSessionQuery);
    const same = sessionEventName && ['year', 'round', 'session'].every(key => loadedQuery.get(key) === String(currentQuery().get(key)));
    if (!same) await loadRealSession();
    if (!sessionEventName) return;
    // Laps that exist in this session only; an unknown lap is ignored, not invented.
    const wanted = String(params.laps || '').split(',').map(token => token.split('.')).filter(([code, lap]) => code && /^\d+$/.test(lap || ''));
    loaded = [];
    for (const [code, lapText] of wanted) {
      const lap = realDrivers.get(code)?.laps?.find(item => item.lap === Number(lapText));
      if (!lap || (!Number.isFinite(lap.time) && !lap.in_lap && !lap.out_lap)) continue;
      if (!selected.includes(code)) selected.push(code);
      loaded.push({code, lap: lap.lap, time: lap.out_lap ? null : lap.time, real: lap});
    }
    if (loaded.length) mapView = 'comparison';
    renderDrivers(); renderStints(); renderAll();
  } finally {
    restoringSessionUrl = false;
    syncSessionUrl();
  }
}
window.ApexUrl?.onRestore('session', params => void applySessionUrl(params));

function renderAll() {
  const sessionContext = $('#loadedSessionContext');
  if (sessionContext) {
    sessionContext.hidden = !sessionEventName;
    sessionContext.textContent = sessionEventName ? `${sessionYear} · ${sessionEventName} · ${loadedSessionName}` : '';
  }
  updateTelemetryVisibility();
  renderLoaded();
  renderSectors();
  renderTraceVisibilityControls();
  drawAll();
  syncSessionUrl();
}

let cornerSortReverse = false;
function rankCornerMetrics(metrics, category) {
  return [...metrics].sort((a, b) => {
    const av = category === 'minimum' ? a.metric.minimumSpeed : a.metric.sectionTime;
    const bv = category === 'minimum' ? b.metric.minimumSpeed : b.metric.sectionTime;
    if (!Number.isFinite(av)) return Number.isFinite(bv) ? 1 : 0;
    if (!Number.isFinite(bv)) return -1;
    return (category === 'minimum' ? bv - av : av - bv) * (cornerSortReverse ? -1 : 1);
  });
}

function mergeCornerWindows(zones) {
  const merged=[];
  zones.map(z=>({start:z.start,end:z.end})).sort((a,b)=>a.start-b.start).forEach(z=>{
    const last=merged.at(-1);
    if(last && z.start<=last.end)last.end=Math.max(last.end,z.end);
    else merged.push({...z});
  });
  return merged;
}

function sessionPerformanceZones(zones, totalDistance) {
  if (!zones.length) return [];
  const corners = zones.map(zone => ({...zone,kind:'corner'}));
  // Short links are transitions belonging to the adjacent corner complex,
  // not selectable 5 m "straights". Split at a common boundary, count once.
  for(let index=1;index<corners.length;index++){
    const gap=(corners[index].start-corners[index-1].end)*totalDistance;
    if(gap>=0&&gap<100){
      const boundary=gap<1e-6?corners[index-1].end:(corners[index].start+corners[index-1].end)/2;
      corners[index-1].end=boundary;corners[index].start=boundary;
    }
  }
  if(corners[0].start*totalDistance<100)corners[0].start=0;
  if((1-corners.at(-1).end)*totalDistance<100)corners.at(-1).end=1;
  corners.forEach(zone=>zone.metres=Math.round((zone.end-zone.start)*totalDistance));
  for(let index=1;index<corners.length;index++){
    // Canonicalise numerical dust at an already shared boundary. Otherwise
    // a 10^-16-lap "straight" has zero elapsed time and blocks comparisons.
    if(Math.abs(corners[index].start-corners[index-1].end)<1e-9)corners[index].start=corners[index-1].end;
  }
  // Keep stable indices even where two corner windows already meet. Empty
  // links are not offered as selectable zones or counted as measurements.
  const straights = Array.from({length:zones.length+1},(_,index)=>{
    const before=corners[index-1],after=corners[index];
    const start=before?.end??0,end=Math.max(start,after?.start??1);
    const straight=(end-start)*totalDistance>=100&&typeof sessionStraightEvidence==='function'&&sessionStraightEvidence(start,end,totalDistance);
    const prefix=straight?'Straight':'Link';
    const label=before&&after?`${prefix} ${cornerLabel(before)}–${cornerLabel(after)}`
      :before?`${prefix} after ${cornerLabel(before)}`:`${prefix} before ${cornerLabel(after)}`;
    return {kind:straight?'straight':'transition',type:straight?'LOW-CURVATURE STRAIGHT':'TRANSITION / UNVERIFIED GEOMETRY',label,start,end,
      between:[index-1,index],metres:Math.round((end-start)*totalDistance)};
  });
  return [...corners,...straights];
}

function cornerSelectionWindows(zones, indices) {
  return mergeCornerWindows([...new Set(indices)].filter(index=>Number.isInteger(index)&&zones[index]?.end>zones[index]?.start).map(index=>zones[index]));
}

function selectLinkingStraights(zones, selected, previousAutomatic) {
  const selection=new Set([...selected].filter(index=>!previousAutomatic.has(index)));
  const automatic=new Set();
  zones.forEach((zone,index)=>{
    if(zone.kind==='corner'||zone.end<=zone.start)return;
    const [before,after]=zone.between;
    if(zones[before]?.kind==='corner'&&zones[after]?.kind==='corner'&&selection.has(before)&&selection.has(after)&&!selection.has(index))automatic.add(index);
  });
  automatic.forEach(index=>selection.add(index));
  return {selection,automatic};
}

function selectedCornerWindows(zones) {
  return cornerSelectionWindows(zones, selectedCornerIndices);
}

function combinedCornerPerformance(samples,zones,totalDistance,indices=zones.map((_,index)=>index)) {
  const windows=cornerSelectionWindows(zones,indices);
  if(!windows.length||!Number.isFinite(totalDistance)||totalDistance<=0)return null;
  const times=windows.map(w=>performanceSectionDuration(samples,w.start,w.end));
  if(times.some(t=>!Number.isFinite(t)||t<=0))return null;
  const sectionTime=times.reduce((s,t)=>s+t,0);
  const metres=windows.reduce((s,w)=>s+(w.end-w.start)*totalDistance,0);
  return {sectionTime,minimumSpeed:metres/sectionTime*3.6,combined:true};
}

function renderCornerAnalysis() {
  const section = $('#cornerAnalysis');
  const root = $('#cornerMetricGrid');
  const diagnosticOpen = root?.querySelector?.('.corner-phase-evidence')?.open;
  const pickerRoot = $('#cornerPickerRow');
  if (!section || !root || !pickerRoot) return;
  const enabled = loaded.length > 0 || selected.length > 0 || !!sessionEventName;
  section.hidden = !enabled;
  if (!enabled) {
    pickerRoot.innerHTML = ''; cornerPickerMarkup.delete(pickerRoot);
    root.innerHTML = '';
    return;
  }

  if (!loaded.length) {
    pickerRoot.innerHTML = ''; cornerPickerMarkup.delete(pickerRoot);
    root.innerHTML = '';
    return;
  }
  const referenceLap = loaded[0];
  const reference = telemetryCache.get(telemetryKey(referenceLap));
  if (!reference?.length || typeof adaptiveCornerZones !== 'function' || typeof cornerPerformance !== 'function') {
    pickerRoot.innerHTML = ''; cornerPickerMarkup.delete(pickerRoot);
    root.innerHTML = '<span class="section-empty">Corner analysis is waiting for aligned position data.</span>';
    return;
  }
  const totalDistance = reference[reference.length - 1].Distance || 1;
  const markers = resolveCornerMarkers(reference, totalDistance, referenceLap?.cornerMarkers);
  const zones = sessionPerformanceZones(adaptiveCornerZones(markers), totalDistance);
  if (!zones.length) {
    pickerRoot.innerHTML = ''; cornerPickerMarkup.delete(pickerRoot);
    root.innerHTML = '<span class="section-empty">Official corner positions are unavailable for this lap.</span>';
    return;
  }

  selectedCornerIndices=new Set([...selectedCornerIndices].filter(i=>i>=0&&i<zones.length&&zones[i].end>zones[i].start));
  const allMetrics = zones.map(zone => loaded.map(lap => {
    const samples = telemetryCache.get(telemetryKey(lap));
    const metric = zone.end<=zone.start?null:zone.kind!=='corner'?combinedCornerPerformance(samples,[zone],totalDistance):cornerPerformance(samples, zone);
    return metric ? { lap, metric } : null;
  }).filter(Boolean));
  const pickedZones=[...selectedCornerIndices].sort((a,b)=>a-b).map(i=>zones[i]);
  const combined=pickedZones.length>1;
  const selectedIndex = [...selectedCornerIndices][0];
  const zone = combined?{type:'Combined selected sections',metres:Math.round(selectedCornerWindows(zones).reduce((s,w)=>s+(w.end-w.start)*totalDistance,0)),apexMetres:0}:zones[selectedIndex]||{type:'No section selected',metres:0};
  const averageSpeed=combined||zone.kind!=='corner';
  const metrics = combined?loaded.map(lap=>{
    if([...selectedCornerIndices].some(i=>!allMetrics[i].some(m=>m.lap===lap)))return null;
    const metric=combinedCornerPerformance(telemetryCache.get(telemetryKey(lap)),zones,totalDistance,selectedCornerIndices);
    return metric?{lap,metric}:null;
  }).filter(Boolean):allMetrics[selectedIndex]||[];
  const finiteTimes = metrics.map(item => item.metric.sectionTime).filter(Number.isFinite);
  const fastestSection = finiteTimes.length ? Math.min(...finiteTimes) : null;
  const finiteMinimumSpeeds = metrics.map(item => item.metric.minimumSpeed).filter(Number.isFinite);
  const highestMinimumSpeed = finiteMinimumSpeeds.length ? Math.max(...finiteMinimumSpeeds) : null;
  const referenceSection = metrics[0]?.metric.sectionTime;
  const signedDelta = value => `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(3)}s`;
  // Retained model diagnostic, separate from measured timestamps and the
  // current common-distance season estimator. Never expand primary driver rows.
  const cornerOrder=zones.map((z,i)=>[z,i]).filter(([z])=>z.kind==='corner'&&z.end>z.start);
  const nextCorner=cornerOrder.find(([z])=>z.start>=(zone.end??1))?.[0]||cornerOrder[0]?.[0];
  const exitStraight=!combined&&zone.kind==='corner'&&nextCorner?((nextCorner.start-zone.end+(nextCorner.start<zone.end?1:0))*totalDistance):0;
  const referencePhases=!combined&&zone.kind==='corner'&&typeof cornerPhaseBreakdown==='function'?cornerPhaseBreakdown(reference,reference,zone,exitStraight):null;
  const phaseSplit=lap=>{
    if(!referencePhases||lap===referenceLap)return '';
    const own=cornerPhaseBreakdown(telemetryCache.get(telemetryKey(lap)),reference,zone,exitStraight);
    if(!own)return '';
    const d=['braking','mid','exit'].map(k=>own[k]-referencePhases[k]);
    return `<small class="corner-phase-split" title="Modelled, not measured: not the section delta above. It applies the same entry-speed correction and exit-speed credit as the season cornering metric. Includes an assumed entry correction (${own.entryKmh.toFixed(0)} vs REF ${referencePhases.entryKmh.toFixed(0)} km/h) and exit-speed credit over up to ${Math.round(Math.min(500,exitStraight))} m of the next straight.">Braking ${signedDelta(d[0])} · Mid ${signedDelta(d[1])} · Exit ${signedDelta(d[2])} · modelled total ${signedDelta(d[0]+d[1]+d[2])}</small>`;
  };
  const picker = kind=>zones.map((candidate, index) => {
    if(candidate.kind!==kind||candidate.end<=candidate.start)return '';
    const candidateMetrics = allMetrics[index];
    const winner = candidateMetrics.reduce((best, item) => !Number.isFinite(item.metric.sectionTime)
      ? best : !best || item.metric.sectionTime < best.metric.sectionTime ? item : best, null);
    const label=candidate.label||cornerLabel(candidate);
    return `<button class="corner-pick" data-corner-index="${index}" aria-label="${escapeUI(label)}" aria-pressed="false" title="${escapeUI(label)} · fastest ${winner?.lap.code || 'unavailable'}"><strong>${escapeUI(kind==='straight'?label.replace('Straight ',''):label)}</strong><small>${winner?.lap.code || '—'}</small></button>`;
  }).join('');
  const rankedMetrics = rankCornerMetrics(metrics, cornerSort);
  const rows = rankedMetrics.map((item) => {
    const sectionTime = item.metric.sectionTime;
    const toReference = Number.isFinite(sectionTime) && Number.isFinite(referenceSection)
      ? sectionTime - referenceSection : null;
    const deltaClass = !Number.isFinite(toReference) || Math.abs(toReference) < .0005
      ? 'is-reference' : toReference < 0 ? 'is-faster' : 'is-slower';
    const fastest = Number.isFinite(sectionTime) && Number.isFinite(fastestSection)
      && Math.abs(sectionTime - fastestSection) < .0005;
    const highestMinimum = Number.isFinite(item.metric.minimumSpeed) && Number.isFinite(highestMinimumSpeed)
      && Math.abs(item.metric.minimumSpeed - highestMinimumSpeed) < .05;
    return `
      <tr class="corner-measurement-row ${fastest && loaded.length > 1 ? 'is-fastest' : ''} ${highestMinimum && loaded.length > 1 ? 'is-highest-min' : ''}" style="--driver-color:${getLapColor(item.lap)}">
        <th scope="row" class="corner-driver-cell"><span class="corner-driver"><i></i><span class="corner-driver-copy"><b>${item.lap.code}</b><small>L${item.lap.lap}${item.lap === referenceLap ? ' · REF' : ''}</small></span></span></th>
        <td class="corner-time"><strong>${Number.isFinite(sectionTime) ? sectionTime.toFixed(3) : '—'}</strong></td>
        <td class="corner-delta ${deltaClass}"><strong>${Number.isFinite(toReference) ? signedDelta(toReference).replace(/s$/, '') : '—'}</strong></td>
        <td class="corner-speed"><strong>${Number.isFinite(item.metric.minimumSpeed) ? item.metric.minimumSpeed.toFixed(1) : '—'}</strong></td>
      </tr>`;
  }).join('');

  updateCornerPicker(pickerRoot, `<section class="circuit-section-group"><header><h3>Corners</h3><span>Choose one or more</span></header><nav class="corner-picker" aria-label="Select one or more corners">${picker('corner')}</nav></section><section class="circuit-section-group"><header><h3>Straights</h3></header><nav class="corner-picker straight-zone-picker" aria-label="Select straight zones">${picker('straight')||'<small>No supported straight zones.</small>'}</nav></section>`, selectedCornerIndices, automaticStraightIndices);
  const pickedCorners=pickedZones.filter(z=>z.kind==='corner').map(cornerLabel);
  const pickedStraights=pickedZones.filter(z=>z.kind!=='corner');
  const selectionLabel=combined?[...pickedCorners,...(pickedStraights.length?[`${pickedStraights.length} link${pickedStraights.length===1?'':'s'}`]:[])].join(' + '):zone.label||cornerLabel(zone);
  root.innerHTML = !pickedZones.length?'<div class="corner-selection-empty"><strong>Compare a section</strong><span>Select corners or straights above to inspect their times.</span></div>':`
    <article class="corner-detail-card">
      <header class="corner-detail-header">
        <h3>${escapeUI(selectionLabel)}</h3><span class="corner-distance">${zone.metres} m</span>
      </header>
      <div class="corner-measurement-wrap" tabindex="0" role="region" aria-label="Selected section measurements"><table class="corner-measurement-table">
        <caption class="visually-hidden">${escapeUI(selectionLabel)} lap comparison</caption><thead><tr><th scope="col">Driver</th>${[['time','Time','s','time'],['delta','Delta','s','delta'],['minimum',averageSpeed?'Avg':'Min','km/h',averageSpeed?'average speed':'minimum speed']].map(([key,label,unit,name]) => {
          const active=cornerSort===key,descending=(key==='minimum')!==cornerSortReverse;
          return `<th scope="col" aria-sort="${active?(descending?'descending':'ascending'):'none'}"><button type="button" data-corner-sort="${key}" aria-label="Sort by ${name}" title="Sort by ${name}"><span>${label} <small>${unit}</small></span><svg viewBox="0 0 12 16" width="12" height="16" aria-hidden="true"><path d="${active?(descending?'M3 6 6 9 9 6':'M3 9 6 6 9 9'):'M3 5 6 2 9 5 M3 11 6 14 9 11'}"/></svg></button></th>`;
        }).join('')}</tr></thead>
        <tbody>${rows||'<tr><td colspan="4" class="section-empty">Insufficient measured data. Choose another section or lap.</td></tr>'}</tbody>
      </table></div>
      ${referencePhases&&metrics.length>1?`<details class="corner-phase-evidence" ${diagnosticOpen?'open':''}><summary>Modelled entry / exit diagnostic</summary><p>Modelled, not measured: the same entry-speed correction and exit-speed credit the season cornering metric uses, applied to these laps. Separate from the measured section times above.</p>${rankedMetrics.map(item=>{const split=phaseSplit(item.lap);return split?`<div><b>${item.lap.code}</b>${split}</div>`:'';}).join('')}</details>`:''}
    </article>`;
  root.querySelectorAll('[data-corner-sort]').forEach(button => {
    button.onclick = () => { cornerSortReverse = cornerSort === button.dataset.cornerSort ? !cornerSortReverse : false; cornerSort = button.dataset.cornerSort; renderCornerAnalysis(); root.querySelector(`[data-corner-sort="${cornerSort}"]`)?.focus({ preventScroll: true }); };
  });
  pickerRoot.onclick = event => {
    const button = event.target.closest('[data-corner-index]');
    if (!button) return;
    const index=Number(button.dataset.cornerIndex)||0;
    if(selectedCornerIndices.has(index))selectedCornerIndices.delete(index);
    else selectedCornerIndices.add(index);
    if(zones[index].kind==='corner'){
      const linked=selectLinkingStraights(zones,selectedCornerIndices,automaticStraightIndices);
      selectedCornerIndices=linked.selection;automaticStraightIndices=linked.automatic;
    }else automaticStraightIndices.delete(index);
    renderCornerAnalysis();
    renderMiniSectorMap();
  };
}


function clearDominanceMapCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const dpr = Math.min(4, Math.max(2, window.devicePixelRatio || 1));
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);
}

let sessionSectorGuide = null;
const GUIDE_SECTOR_COLORS = ['#ff4081', '#e6bc24', '#40a9ed'];

// Circuit geometry is independent of timing-archive availability. The same
// request supplies the guide, trace labels, comparison map and corner picker.
const circuitAnnotationFlights = new Map();
function loadCircuitAnnotations(key, year, signal) {
  const identity = `${key}:${year}`;
  if (apiCircuitGuides.get(identity)) return Promise.resolve(apiCircuitGuides.get(identity));
  if (circuitAnnotationFlights.has(identity)) return circuitAnnotationFlights.get(identity);
  apiCircuitGuideRequests.add(identity);
  const request = fetch(`/api/circuit-guide?key=${key}&year=${year}`, {
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
  }).then(response => {
    if (!response.ok) throw new Error('Circuit metadata unavailable');
    return response.json();
  }).then(data => { apiCircuitGuides.set(identity,data); return data; })
    .finally(() => { circuitAnnotationFlights.delete(identity); apiCircuitGuideRequests.delete(identity); });
  circuitAnnotationFlights.set(identity,request);
  return request;
}

function circuitAnnotationRows(guide) {
  return (guide?.corners || []).flatMap(corner => {
    const {x,y} = corner.trackPosition || {};
    if (x == null || y == null || !Number.isFinite(+x) || !Number.isFinite(+y)) return [];
    // Provider 'length' is outline chainage in provider units, not lap metres.
    // Project the physical X/Y onto the actual telemetry instead.
    return [{number:String(corner.number),letter:corner.letter || '',x:+x,y:+y,
      angle:corner.angle,source:'circuit_position'}];
  });
}

function makeSectorGuide(lap, samples, suppliedCorners, drsNormalized = false) {
  const meta = lap.real || lap;
  const times = [meta.s1, meta.s2, meta.s3];
  const duration = lap.time ?? meta.time;
  if (!times.every(t => Number.isFinite(t) && t > 0) || !Number.isFinite(duration)
      || Math.abs(times.reduce((a,b)=>a+b,0)-duration) > .05) return null;
  const valid = samples.filter(p => [p.X,p.Y,p.ElapsedSeconds].every(v => v != null && Number.isFinite(v)));
  if (valid.length < 50 || valid.length < samples.length * .98
      || valid[0].ElapsedSeconds < 0 || valid[0].ElapsedSeconds > .5
      || Math.abs(valid.at(-1).ElapsedSeconds-duration) > .5) return null;
  // Never bridge missing packets or derive distances from fractions of lap time.
  for (let i=1;i<valid.length;i++) {
    const dt=valid[i].ElapsedSeconds-valid[i-1].ElapsedSeconds;
    // ~4 Hz position feeds have occasional 1.2 s packets; longer holes are not bridged.
    if(dt <= 0 || dt > 1.6) return null;
  }
  const boundaries=[times[0],times[0]+times[1]];
  // DRS is only drawn up to 2025: the 2026 straight-mode state isn't in the public feed.
  const drsState = value => drsNormalized
    ? (value === 0 || value === 1 ? value : null)
    : window.ApexAnalysis?.observedDRS(value) ?? null;
  const drsKnown=Number(sessionYear)<2026&&valid.some(p=>drsState(p.DRS)!==null);
  const points=valid.map(p=>({x:p.X,y:p.Y,t:p.ElapsedSeconds,drs:drsKnown&&drsState(p.DRS)===1}));
  for(const t of boundaries) {
    const i=points.findIndex(p=>p.t>=t);
    if(i<1)return null;
    if(points[i].t===t)continue;
    const a=points[i-1],b=points[i],f=(t-a.t)/(b.t-a.t);
    points.splice(i,0,{x:a.x+(b.x-a.x)*f,y:a.y+(b.y-a.y)*f,t,drs:a.drs&&b.drs});
  }
  // The lap's fastest measured point, where the speed trap normally sits.
  const fastest=valid.filter(p=>Number.isFinite(+p.Speed)).reduce((best,p)=>!best||+p.Speed>+best.Speed?p:best,null);
  const distance=valid.at(-1).Distance;
  const markers=Number.isFinite(distance) && distance>0
    ? resolveCornerMarkers(valid,distance,suppliedCorners) : [];
  const mappedCorners=markers.map(c=>{
    const target=c.fraction*distance;
    const p=valid.reduce((best,p)=>Math.abs(p.Distance-target)<Math.abs(best.Distance-target)?p:best,valid[0]);
    return {...c,trackPosition:{x:p.X,y:p.Y}};
  });
  return {x:points.map(p=>p.x),y:points.map(p=>p.y),
    drs:drsKnown&&points.some(p=>p.drs)?points.map(p=>p.drs):null,
    topSpeed:fastest?{x:fastest.X,y:fastest.Y,speed:+fastest.Speed}:null,
    segmentSectors:points.slice(1).map((p,i)=>{
      const middle=(p.t+points[i].t)/2;
      return middle<boundaries[0]?0:middle<boundaries[1]?1:2;
    }),corners:mappedCorners};
}

function drawMadridGuide(ctx, points, rect) {
  // FIA sector anchors; the outline itself is approximate (see madrid-corners.md).
  const cumulative = [0];
  for (let i=1;i<points.length;i++) cumulative.push(cumulative[i-1]+Math.hypot(points[i].x-points[i-1].x,points[i].y-points[i-1].y));
  const factor = 5414/cumulative[cumulative.length-1];
  const offset = 1924-cumulative[37]*factor;
  const old16 = cumulative[85]*factor+offset;
  const geometry = points.map((point,i) => {
    let m = (cumulative[i]*factor+offset+5414)%5414;
    if(m>=1924 && m<=old16) m=1924+(m-1924)*(3928-1924)/(old16-1924);
    else if(m>old16) m=3928+(m-old16)*(5414-3928)/(5414-old16);
    return {...point,m};
  }).sort((a,b)=>a.m-b.m);
  const at = metres => {
    const m=(metres+5414)%5414;
    let i=geometry.findIndex(p=>p.m>=m);
    if(i<0)i=0;
    const b=geometry[i], a=geometry[(i+geometry.length-1)%geometry.length];
    const am=i===0?a.m-5414:a.m, bm=b.m;
    const target=i===0 && m>a.m?m-5414:m;
    const t=(target-am)/(bm-am||1);
    return {x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};
  };
  const palette=['#ff4081','#e6bc24','#40a9ed'];
  ctx.clearRect(0,0,rect.width,rect.height);
  [[0,1839],[1839,3888],[3888,5414]].forEach(([start,end],i)=>{
    ctx.beginPath();
    for(let m=start;m<=end+3;m+=3){const p=at(Math.min(m,end));if(m===start)ctx.moveTo(p.x,p.y);else ctx.lineTo(p.x,p.y);}
    ctx.strokeStyle=palette[i];ctx.lineWidth=5;ctx.stroke();
  });
  const annotations=[
    {m:0,label:'Timing line',color:'#aeb4c0'},
    {m:1839,label:'S1 / S2',color:palette[1]},
    {m:3888,label:'S2 / S3',color:palette[2]},
    ...MADRID_MAP_CORNERS.map(c=>({m:c.distance,label:cornerLabel(c),color:lightThemeActive()?'#242428':'#eeeeef',corner:true}))
  ];
  const occupied=[], leaders=[];
  ctx.font=canvasFont(12);ctx.textAlign='center';ctx.textBaseline='middle';
  annotations.forEach(item=>{
    const p=at(item.m), a=at(item.m-3), b=at(item.m+3);
    const length=Math.hypot(b.x-a.x,b.y-a.y)||1;
    if(!item.corner){
      const nx=-(b.y-a.y)/length*8,ny=(b.x-a.x)/length*8;
      ctx.beginPath();ctx.moveTo(p.x-nx,p.y-ny);ctx.lineTo(p.x+nx,p.y+ny);ctx.strokeStyle=item.color;ctx.lineWidth=2;ctx.stroke();
    }
    const width=ctx.measureText(item.label).width+6;
    let placement;
    for(const radius of [24,40,60,84,110,140,180]){
      for(let j=0;j<24;j++){
        const angle=-Math.PI/2+j*Math.PI/12;
        const x=Math.max(width/2+3,Math.min(rect.width-width/2-3,p.x+Math.cos(angle)*radius));
        const y=Math.max(11,Math.min(rect.height-11,p.y+Math.sin(angle)*radius));
        const box={x:x-width/2,y:y-8,width,height:16};
        if(trackIntersectsLabel(box,geometry,7)||occupied.some(b=>box.x<b.x+b.width+3&&box.x+width+3>b.x&&box.y<b.y+b.height+3&&box.y+16+3>b.y))continue;
        const connector=cornerLabelConnector(p,box,leaders,occupied);
        if(!connector)continue;
        placement={x,y,box,...connector};break;
      }
      if(placement)break;
    }
    if(!placement)return;
    occupied.push(placement.box);
    if(placement.line){
      leaders.push(placement.line);
      ctx.beginPath();ctx.moveTo(placement.line.a.x,placement.line.a.y);ctx.lineTo(placement.line.b.x,placement.line.b.y);ctx.strokeStyle=item.color;ctx.lineWidth=.7;ctx.globalAlpha=.4;ctx.stroke();ctx.globalAlpha=1;
    }
    ctx.fillStyle=item.color;ctx.fillText(item.label,placement.x,placement.y);
  });
  ctx.textAlign='start';ctx.textBaseline='alphabetic';
}

const CIRCUIT_API_KEYS = {'gb-1948':2,'hu-1986':4,'it-1953':6,'be-1925':7,'us-2012':9,'au-1953':10,'br-1940':14,'es-1991':15,'at-1969':19,'mc-1929':22,'ca-1978':23,'fr-1969':28,'de-1932':34,'it-1922':39,'jp-1962':46,'cn-2004':49,'nl-1948':55,'tr-2005':59,'sg-2008':61,'bh-2002':63,'mx-1962':65,'ae-2009':70,'de-1927':72,'ru-2014':79,'az-2016':144,'it-1914':146,'pt-2008':147,'sa-2021':149,'qa-2004':150,'us-2022':151,'us-2023':152};

function drawApiCircuitGuide(ctx, data, rect) {
  const raw = data.x.map((x,i)=>({x:Number(x),y:-Number(data.y[i])})).filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y));
  if(raw.length<3)return false;
  const light=lightThemeActive();
  const minX=Math.min(...raw.map(p=>p.x)),maxX=Math.max(...raw.map(p=>p.x));
  const minY=Math.min(...raw.map(p=>p.y)),maxY=Math.max(...raw.map(p=>p.y));
  const pad=Math.min(70,Math.max(38,rect.width*.09));
  const scale=Math.min((rect.width-pad*2)/(maxX-minX||1),(rect.height-pad*2)/(maxY-minY||1));
  const project=p=>({x:(p.x-(minX+maxX)/2)*scale+rect.width/2,y:(p.y-(minY+maxY)/2)*scale+rect.height/2});
  const geometry=raw.map(project);
  const centre=geometry.reduce((s,p)=>({x:s.x+p.x/geometry.length,y:s.y+p.y/geometry.length}),{x:0,y:0});
  const tangent=i=>{const a=geometry[Math.max(0,i-2)],b=geometry[Math.min(geometry.length-1,i+2)],l=Math.hypot(b.x-a.x,b.y-a.y)||1;return {x:(b.x-a.x)/l,y:(b.y-a.y)/l};};
  const nearestIndex=p=>{let best=0,dist=Infinity;geometry.forEach((g,i)=>{const d=Math.hypot(g.x-p.x,g.y-p.y);if(d<dist){dist=d;best=i;}});return best;};
  const occupied=[];
  const overlaps=box=>occupied.some(b=>box.x<b.x+b.width+3&&box.x+box.width+3>b.x&&box.y<b.y+b.height+3&&box.y+box.height+3>b.y);
  const inside=box=>box.x>=2&&box.y>=2&&box.x+box.width<=rect.width-2&&box.y+box.height<=rect.height-2;
  // Place a label beside the track along the outward normal (either side), never on it.
  const placeBeside=(i,width,height,distances)=>{
    const t=tangent(i),p=geometry[i],normal={x:-t.y,y:t.x};
    const outward=(p.x-centre.x)*normal.x+(p.y-centre.y)*normal.y>=0?1:-1;
    for(const d of distances)for(const side of [outward,-outward]){
      const cx=p.x+normal.x*d*side,cy=p.y+normal.y*d*side;
      const box={x:cx-width/2,y:cy-height/2,width,height};
      if(!inside(box)||overlaps(box)||trackIntersectsLabel(box,geometry,6))continue;
      occupied.push(box);return {x:cx,y:cy,box,anchor:p};
    }
    // Tight hairpins: fall back to the nearest free spot around the corner.
    for(const d of distances)for(let j=0;j<24;j++){
      const angle=j*Math.PI/12,cx=Math.max(width/2+2,Math.min(rect.width-width/2-2,p.x+Math.cos(angle)*d)),cy=Math.max(height/2+2,Math.min(rect.height-height/2-2,p.y+Math.sin(angle)*d));
      const box={x:cx-width/2,y:cy-height/2,width,height};
      if(overlaps(box)||trackIntersectsLabel(box,geometry,4))continue;
      occupied.push(box);return {x:cx,y:cy,box,anchor:p};
    }
    return null;
  };
  const trace=(from,to)=>{ctx.beginPath();for(let i=from;i<=to;i++){const p=geometry[i];i===from?ctx.moveTo(p.x,p.y):ctx.lineTo(p.x,p.y);}};
  ctx.clearRect(0,0,rect.width,rect.height);
  ctx.lineJoin='round';ctx.lineCap='round';
  // Track body: a dark road with a hairline edge so it reads on both appearances.
  trace(0,geometry.length-1);ctx.lineWidth=15;ctx.strokeStyle=light?'rgba(0,0,0,.18)':'rgba(255,255,255,.22)';ctx.stroke();
  trace(0,geometry.length-1);ctx.lineWidth=13;ctx.strokeStyle=light?'#2c2c30':'#0c0c0e';ctx.stroke();
  // Sector centre line, coloured per timing sector.
  const sectors=data.segmentSectors?.length===geometry.length-1?data.segmentSectors:null;
  for(let i=1;i<geometry.length;i++){
    ctx.beginPath();ctx.moveTo(geometry[i-1].x,geometry[i-1].y);ctx.lineTo(geometry[i].x,geometry[i].y);
    ctx.strokeStyle=sectors?GUIDE_SECTOR_COLORS[sectors[i-1]]:'#d0d0d6';ctx.lineWidth=3.2;ctx.stroke();
  }
  // DRS zones detected on this lap, as a dashed line beside the road.
  if(Array.isArray(data.drs)&&data.drs.length===geometry.length){
    ctx.save();ctx.setLineDash([5,4]);ctx.lineWidth=2;ctx.strokeStyle='#ff453a';ctx.lineCap='butt';
    let open=false;
    for(let i=1;i<geometry.length;i++){
      if(!(data.drs[i]&&data.drs[i-1])){if(open){ctx.stroke();open=false;}continue;}
      const t=tangent(i),side=((geometry[i].x-centre.x)*-t.y+(geometry[i].y-centre.y)*t.x)>=0?1:-1;
      const a={x:geometry[i-1].x-t.y*11*side,y:geometry[i-1].y+t.x*11*side},b={x:geometry[i].x-t.y*11*side,y:geometry[i].y+t.x*11*side};
      if(!open){ctx.beginPath();ctx.moveTo(a.x,a.y);open=true;}
      ctx.lineTo(b.x,b.y);
    }
    if(open)ctx.stroke();ctx.restore();
  }
  // Sector boundaries: short white ticks across the road.
  if(sectors)for(let i=1;i<sectors.length;i++){
    if(sectors[i]===sectors[i-1])continue;
    const t=tangent(i),p=geometry[i];
    ctx.beginPath();ctx.moveTo(p.x+t.y*9,p.y-t.x*9);ctx.lineTo(p.x-t.y*9,p.y+t.x*9);ctx.strokeStyle='#ffffff';ctx.lineWidth=2;ctx.lineCap='butt';ctx.stroke();
  }
  // Start/finish: a chequered block across the road plus a direction arrow.
  {
    const t=tangent(0),p=geometry[0],n={x:-t.y,y:t.x};
    ctx.save();ctx.translate(p.x,p.y);ctx.rotate(Math.atan2(n.y,n.x));
    const cell=3.2;
    for(let r=-4;r<4;r++)for(let c=0;c<2;c++){ctx.fillStyle=(r+c)%2?'#111':'#fff';ctx.fillRect(r*cell,(c-1)*cell,cell,cell);}
    ctx.restore();
    const side=((p.x-centre.x)*n.x+(p.y-centre.y)*n.y)>=0?1:-1;
    const base={x:p.x+n.x*17*side+t.x*2,y:p.y+n.y*17*side+t.y*2};
    ctx.beginPath();ctx.moveTo(base.x-t.x*8,base.y-t.y*8);ctx.lineTo(base.x+t.x*6,base.y+t.y*6);
    ctx.strokeStyle=light?'#1d1d1f':'#f2f2f4';ctx.lineWidth=1.6;ctx.stroke();
    ctx.beginPath();ctx.moveTo(base.x+t.x*9,base.y+t.y*9);ctx.lineTo(base.x+t.x*3-n.x*3.5,base.y+t.y*3-n.y*3.5);ctx.lineTo(base.x+t.x*3+n.x*3.5,base.y+t.y*3+n.y*3.5);ctx.closePath();
    ctx.fillStyle=light?'#1d1d1f':'#f2f2f4';ctx.fill();
    occupied.push({x:p.x-14,y:p.y-14,width:28,height:28});
  }
  ctx.textAlign='center';ctx.textBaseline='middle';
  // Turn numbers in circles beside the track.
  ctx.font=canvasFont(10,700);
  for(const corner of data.corners || []){
    const position=corner.trackPosition;
    if(!position||!Number.isFinite(Number(position.x))||!Number.isFinite(Number(position.y)))continue;
    const p=project({x:Number(position.x),y:-Number(position.y)}),label=cornerLabel(corner).replace(/^T/,'');
    const radius=Math.max(8.5,ctx.measureText(label).width/2+4);
    const spot=placeBeside(nearestIndex(p),radius*2,radius*2,[17,23,30,38,48]);
    if(!spot)continue;
    ctx.beginPath();ctx.arc(spot.x,spot.y,radius,0,Math.PI*2);
    ctx.fillStyle=light?'#ffffff':'#1c1c1e';ctx.fill();ctx.strokeStyle=light?'#1d1d1f':'#e5e5ea';ctx.lineWidth=1.2;ctx.stroke();
    ctx.fillStyle=light?'#1d1d1f':'#f2f2f4';ctx.fillText(label,spot.x,spot.y+.5);
  }
  // Sector names, boxed, beside the middle of each sector.
  if(sectors){
    ctx.font=canvasFont(10,700);
    [0,1,2].forEach(sector=>{
      const indices=sectors.map((s,i)=>s===sector?i:-1).filter(i=>i>=0);
      if(!indices.length)return;
      const label=`SECTOR ${sector+1}`,width=ctx.measureText(label).width+12;
      let spot=null;
      for(const fraction of [.5,.35,.65,.2,.8]){spot=placeBeside(indices[Math.floor(indices.length*fraction)],width,17,[24,34,46,60,76,94]);if(spot)break;}
      if(!spot)return;
      ctx.fillStyle=light?'#ffffff':'#f2f2f4';ctx.strokeStyle=GUIDE_SECTOR_COLORS[sector];ctx.lineWidth=1.5;
      ctx.beginPath();if(typeof ctx.roundRect==='function')ctx.roundRect(spot.box.x,spot.box.y,width,17,3);else ctx.rect(spot.box.x,spot.box.y,width,17);ctx.fill();ctx.stroke();
      ctx.fillStyle='#1d1d1f';ctx.fillText(label,spot.x,spot.y+.5);
    });
  }
  // Fastest point of this lap (where the speed trap normally sits).
  if(data.topSpeed&&Number.isFinite(+data.topSpeed.x)&&Number.isFinite(+data.topSpeed.y)){
    const p=project({x:+data.topSpeed.x,y:-+data.topSpeed.y});
    ctx.beginPath();ctx.arc(p.x,p.y,4.5,0,Math.PI*2);ctx.fillStyle='#ffd60a';ctx.fill();ctx.strokeStyle='#1d1d1f';ctx.lineWidth=1;ctx.stroke();
    ctx.font=canvasFont(10,600);
    const label=`TOP SPEED ${Math.round(data.topSpeed.speed)} km/h`,width=ctx.measureText(label).width+10;
    const spot=placeBeside(nearestIndex(p),width,16,[26,38,52,68,86,106]);
    if(spot){
      ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(spot.x,spot.y);ctx.strokeStyle='#ffd60a';ctx.lineWidth=1;ctx.stroke();
      ctx.fillStyle=light?'#1d1d1f':'#2c2c2e';ctx.beginPath();if(typeof ctx.roundRect==='function')ctx.roundRect(spot.box.x,spot.box.y,width,16,3);else ctx.rect(spot.box.x,spot.box.y,width,16);ctx.fill();
      ctx.fillStyle='#ffd60a';ctx.fillText(label,spot.x,spot.y+.5);
    }
  }
  ctx.textAlign='start';ctx.textBaseline='alphabetic';return true;
}

function circuitGuideContent() {
  const event=calendar.find(item=>item.name===sessionEventName);
  const sepang=isSepangCircuit(event);
  const samples=loaded.length?telemetryCache.get(telemetryKey(loaded[0])):null;
  const distance=samples?.at(-1)?.Distance;
  const markers=distance?resolveCornerMarkers(samples,distance,loaded[0]?.cornerMarkers):[];
  const zones=markers.length?sessionPerformanceZones(adaptiveCornerZones(markers),distance):[];
  const straights=zones.filter(z=>z.kind==='straight'&&z.end>z.start);
  const lap=loaded[0]?.real;
  const sectors=[lap?.s1,lap?.s2,lap?.s3].map(Number);
  let official='';
  if(sepang){
    official=`<div class="circuit-guide-source"><strong>Sepang · Pirelli track characteristics</strong><p>Lateral load: T5–T7 and T12–T13. Traction: the T2 exit. Braking: the approach to T15. These are qualitative circuit characteristics from Pirelli’s 2012 guide, not current-car g-force ratings.</p><a href="https://press.pirelli.com/the-malaysian-grand-prix-from-a-tyre-point-of-view/" target="_blank" rel="noopener">Pirelli corner guide · 22 Mar 2012</a></div>`;
    if(sessionYear===2026)official+=`<div class="circuit-guide-source"><strong>2026 tyre briefing</strong><p>Medium circuit-wide tyre stress; abrasive asphalt. Nominated compounds: C2 / C3 / C4.</p><a href="https://press.pirelli.com/tyre-compound-selections-for-baku-sepang-and-singapore/" target="_blank" rel="noopener">Pirelli preview · 27 Aug 2026</a></div>`;
  }
  return `<div class="circuit-guide-facts"><span><small>Measured lap</small><b>${distance?(distance/1000).toFixed(3)+' km':'Load a lap'}</b></span><span><small>Numbered corners</small><b>${markers.length|| (sepang?15:'Map annotations')}</b></span><span><small>Supported straight zones</small><b>${distance?straights.length:'Load telemetry'}</b></span></div>${sectors.every(t=>Number.isFinite(t)&&t>0)?`<p class="circuit-guide-sector-times">Reference lap sectors · S1 ${sectors[0].toFixed(3)} s · S2 ${sectors[1].toFixed(3)} s · S3 ${sectors[2].toFixed(3)} s</p>`:''}${official||'<p class="circuit-guide-sector-times">Map turn numbering and timing-derived sectors are shown where available. No verified Pirelli characteristic ratings are currently stored for this circuit; ratings are not inferred from lap speed.</p>'}<details><summary>What the guide describes</summary><p>Traction concerns acceleration out of corners; braking concerns deceleration demands; lateral load concerns turning. These describe a circuit, not a team ranking. GPS boundaries and corner centres are approximate.</p><a href="https://www.pirelli.com/global/en-ww/race/racingspot/formula-1/formula-1-for-dummies-the-choice-of-tyres-in-formula-1-53864/" target="_blank" rel="noopener">Pirelli’s circuit-characteristic definitions</a></details>`;
}

function renderGenericCircuit(canvas, empty) {
  if (!sessionEventName) { empty.style.display = 'grid'; empty.textContent = 'Load a session to see its circuit guide.'; return; }
  if(sessionSectorGuide) {
    canvas.style.display='block';
    const rect=canvas.getBoundingClientRect();
    if(!rect.width || !rect.height)return;
    const ratio=Math.max(2,window.devicePixelRatio||1);
    canvas.width=Math.round(rect.width*ratio);canvas.height=Math.round(rect.height*ratio);
    const ctx=canvas.getContext('2d');ctx.setTransform(ratio,0,0,ratio,0,0);
    if(drawApiCircuitGuide(ctx,sessionSectorGuide,rect)) {
      empty.style.display='none';
      canvas.setAttribute('aria-label',`${sessionEventName} circuit guide: sector 1 pink, sector 2 yellow, sector 3 blue, numbered turns, start/finish and direction${sessionSectorGuide.drs?', DRS zones dashed red':''}${sessionSectorGuide.topSpeed?', fastest point yellow':''}`);
      $('#dominanceLegend').innerHTML='<span class="guide-legend"><span><i style="background:#ff4081"></i>S1</span><span><i style="background:#e6bc24"></i>S2</span><span><i style="background:#40a9ed"></i>S3</span>'+(sessionSectorGuide.drs?'<span><i class="is-dashed"></i>DRS (this lap)</span>':'')+(sessionSectorGuide.topSpeed?'<span><i class="is-dot"></i>Top speed (this lap)</span>':'')+'</span><small class="explanation-only">Sector boundaries come from the official sector times matched to this lap\'s position telemetry'+(sessionSectorGuide.corners?.some(c=>c.approximate)?'; corner numbers use approximate official-map positions':'')+'.</small>';
      return;
    }
  }
  if (!genericCircuitData) {
    empty.style.display = 'grid';
    empty.textContent = 'Loading circuit map…';
    if (!genericCircuitRequest) genericCircuitRequest = fetch('assets/circuits/f1-circuits.geojson')
      .then(response => { if (!response.ok) throw new Error('Map unavailable'); return response.json(); })
      .then(data => { genericCircuitData = data; if (!loaded.length || mapView === 'guide') renderMiniSectorMap(); })
      .catch(() => { if (!loaded.length) empty.textContent = 'Circuit map unavailable.'; })
      .finally(() => { genericCircuitRequest = null; });
    return;
  }
  const name = normalizedPlaceName(sessionEventName);
  const aliases = [['emilia','it-1953'],['tuscan','it-1914'],['70th','gb-1948'],['eifel','de-1927'],['sakhir','bh-2002'],['styrian','at-1969'],['european','az-2016'],['australian','au-1953'],['bahrain','bh-2002'],['chinese','cn-2004'],['barcelona','es-1991'],['spanish', Number($('#year').value) >= 2026 ? 'es-2026' : 'es-1991'],['monaco','mc-1929'],['canadian','ca-1978'],['french','fr-1969'],['austrian','at-1969'],['british','gb-1948'],['german','de-1932'],['hungarian','hu-1986'],['belgian','be-1925'],['italian','it-1922'],['singapore','sg-2008'],['russian','ru-2014'],['japanese','jp-1962'],['miami','us-2022'],['las vegas','us-2023'],['united states','us-2012'],['mexic','mx-1962'],['sao paulo','br-1940'],['brazil','br-1940'],['abu dhabi','ae-2009'],['portuguese','pt-2008'],['malaysian','my-1999'],['turkish','tr-2005'],['dutch','nl-1948'],['saudi','sa-2021'],['qatar','qa-2004'],['azerbaijan','az-2016']];
  const event = calendar.find(item => item.name === sessionEventName);
  const sepang = isSepangCircuit(event);
  const id = sepang ? 'my-1999' : aliases.find(([term]) => name.includes(term))?.[1];
  const circuitKey = sepang ? null : sessionCircuitKey || event?.circuit_key
    || (name.includes('sakhir') && sessionYear === 2020 ? 148 : CIRCUIT_API_KEYS[id]);
  const guideKey = `${circuitKey}:${sessionYear}`;
  if(circuitKey && !apiCircuitGuides.has(guideKey) && !apiCircuitGuideRequests.has(guideKey)) {
    apiCircuitGuideRequests.add(guideKey);
    loadCircuitAnnotations(circuitKey,sessionYear)
      .catch(()=>apiCircuitGuides.set(guideKey,null))
      .finally(()=>{apiCircuitGuideRequests.delete(guideKey);if(mapView==='guide')renderMiniSectorMap();});
  }
  const feature = genericCircuitData.features.find(item => item.properties.id === id);
  const coords = feature?.geometry?.type === 'LineString' ? feature.geometry.coordinates : null;
  if (!coords?.length) { empty.style.display = 'grid'; empty.textContent = 'Circuit outline unavailable for this event.'; return; }
  canvas.style.display = 'block';
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const ratio = Math.max(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(rect.width * ratio); canvas.height = Math.round(rect.height * ratio);
  const ctx = canvas.getContext('2d'); ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  const latitude = coords[0][1] * Math.PI / 180;
  const points = coords.map(([x,y]) => [x * Math.cos(latitude), -y]);
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  const minX = Math.min(...xs), minY = Math.min(...ys), width = Math.max(...xs)-minX, height = Math.max(...ys)-minY;
  const scale = Math.min((rect.width-40)/width, (rect.height-40)/height);
  ctx.beginPath();
  points.forEach(([x,y], index) => { const px=(x-minX-width/2)*scale+rect.width/2, py=(y-minY-height/2)*scale+rect.height/2; if(index)ctx.lineTo(px,py);else ctx.moveTo(px,py); });
  ctx.strokeStyle = lightThemeActive() ? '#65656e' : '#b3b3bd'; ctx.lineWidth=4; ctx.lineJoin='round'; ctx.lineCap='round'; ctx.stroke();
  canvas.setAttribute('aria-label', `${feature.properties.Name}, generic circuit outline`);
  empty.style.display='none';
  $('#dominanceLegend').innerHTML = '<small>Outline · <a href="https://github.com/bacinger/f1-circuits" target="_blank" rel="noopener">Circuit data</a></small>';
  if (sepang) {
    const guide = {x:coords.map(p=>p[0]*Math.cos(latitude)),y:coords.map(p=>p[1]),
      corners:SEPANG_MAP_CORNERS.map(c=>({...c,trackPosition:{x:coords[c.outlineIndex][0]*Math.cos(latitude),y:coords[c.outlineIndex][1]}}))};
    drawApiCircuitGuide(ctx,guide,rect);
    canvas.setAttribute('aria-label','Sepang International Circuit, turns 1 to 15');
    $('#dominanceLegend').innerHTML = '<small>Sepang · <a href="https://www.sepangcircuit.com/media/wysiwyg/pdf/Daily_Safety_Briefing.pdf" target="_blank" rel="noopener">Official circuit turn numbering</a><br>Approximate corner positions on the circuit outline.</small>';
  } else if (id === 'es-2026' && sessionYear === 2026) {
    drawMadridGuide(ctx, points.map(([x,y]) => ({x:(x-minX-width/2)*scale+rect.width/2, y:(y-minY-height/2)*scale+rect.height/2})), rect);
    $('#dominanceLegend').innerHTML = '<small><span style="color:#ff4081">S1</span> · <span style="color:#e6bc24">S2</span> · <span style="color:#40a9ed">S3</span> · <a href="https://www.fia.com/system/files/decision-document/2026_spanish_grand_prix_-_competition_notes_-_circuit_map_pit_lane_drawing_and_emergency_exits_map.pdf" target="_blank" rel="noopener">FIA sector lengths</a><br>Approximate placement on the circuit outline.</small>';
  } else {
    const guide=apiCircuitGuides.get(guideKey);
    if(guide && Array.isArray(guide.x) && Array.isArray(guide.y) && drawApiCircuitGuide(ctx,guide,rect)) {
      $('#dominanceLegend').innerHTML = `<small><a href="https://multiviewer.app" target="_blank" rel="noopener">MultiViewer circuit data</a> · ${escapeUI(guide.name)} · ${guide.sourceYear}${guide.sourceYear!==sessionYear?' layout (older than selected season)':''}<br>Sector colours require a loaded lap with complete timing and position data.</small>`;
    } else {
      $('#dominanceLegend').innerHTML += `<small>${apiCircuitGuideRequests.has(guideKey)?'Loading circuit annotations…':'Circuit annotations unavailable from the provider.'}</small>`;
    }
  }
}

function miniSectorBounds(totalDistance, fraction, segmentLength = 25) {
  const index = Math.max(0, Math.min(Math.ceil(totalDistance / segmentLength) - 1, Math.floor(fraction * totalDistance / segmentLength)));
  return {start: index * segmentLength / totalDistance, end: Math.min(1, (index + 1) * segmentLength / totalDistance)};
}

function miniSectorGeometryPoints(geometry, start, end, pointAt) {
  const points = [pointAt(start)];
  // Use the very same dense vertices as the outline, not coarser chords
  // which cut across bends and expose a false gap in the comparison layer.
  for (let index = Math.floor(start * geometry.length) + 1; index < end * geometry.length; index++) {
    points.push(geometry[index]);
  }
  points.push(pointAt(end));
  return points;
}

function miniSectorDominanceSegments(series, totalDistance, segmentLength = 25) {
  if (!(totalDistance > 0) || !(segmentLength > 0)) return [];
  return Array.from({length: Math.ceil(totalDistance / segmentLength)}, (_, index) => {
    const start = index * segmentLength / totalDistance;
    const end = Math.min(1, (index + 1) * segmentLength / totalDistance);
    const durations = series.map(samples => {
      if (typeof performanceSectionDuration === 'function') return performanceSectionDuration(samples, start, end);
      const before = calibratedElapsed(samples, start), after = calibratedElapsed(samples, end);
      return before == null || after == null ? null : after - before;
    });
    const comparable = durations.length >= 2 && durations.every(time => Number.isFinite(time) && time > 0);
    return {start, end, durations, winner: comparable ? durations.indexOf(Math.min(...durations)) : -1};
  });
}
