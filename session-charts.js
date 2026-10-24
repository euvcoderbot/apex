/* Session analysis: telemetry chart stack (speed trace, delta, inputs). */
// Chart Constants and Configuration
const defs = [
  ['Speed trace', 'KM/H', false],
  ['Timing delta', 'SECONDS VS REFERENCE', false],
  ['Throttle application', '%', true],
  ['Brake application', 'ON / OFF', true],
  ['Gear', '0–8', false],
  ['DRS', 'OPEN / CLOSED', true]
];

const chartField = {
  'Speed trace': 'Speed',
  'Throttle application': 'Throttle',
  'Brake application': 'Brake',
  'Engine speed': 'RPM',
  'Gear': 'nGear',
  'DRS': 'DRS'
};

function setTraceZoom(start, end) {
  let nextStart = Math.max(0, Math.min(1, start));
  let nextEnd = Math.max(0, Math.min(1, end));
  if (nextEnd < nextStart) [nextStart, nextEnd] = [nextEnd, nextStart];
  if (nextEnd - nextStart < MIN_TRACE_ZOOM) return false;
  traceZoom = { start: nextStart, end: nextEnd };
  hoverFraction = null;
  updateZoomReadout();
  drawAll();
  return true;
}

function updateZoomReadout() {
  const readout = $('#traceZoomReadout');
  const reset = $('[data-zoom="reset"]');
  const zoomOut = $('[data-zoom="out"]');
  const panLeft = $('[data-pan="left"]');
  const panRight = $('[data-pan="right"]');
  const reference = loaded[0] && telemetryCache.get(telemetryKey(loaded[0]));
  const distance = reference?.length ? reference[reference.length - 1].Distance : 0;
  const fullLap = traceZoom.start <= 1e-6 && traceZoom.end >= 1 - 1e-6;
  if (readout) {
    readout.textContent = distance
      ? `${(traceZoom.start * distance / 1000).toFixed(2)}–${(traceZoom.end * distance / 1000).toFixed(2)} KM`
      : 'Full lap';
  }
  if (reset) reset.disabled = fullLap;
  if (zoomOut) zoomOut.disabled = fullLap;
  if (panLeft) panLeft.disabled = fullLap || traceZoom.start <= 1e-6;
  if (panRight) panRight.disabled = fullLap || traceZoom.end >= 1 - 1e-6;
}

function updateTimingDeltaZoomReadout() {
  const readout = $('#timingDeltaZoomReadout');
  const zoomOut = $('[data-delta-zoom="out"]');
  const zoomIn = $('[data-delta-zoom="in"]');
  const reset = $('[data-delta-zoom="reset"]');
  if (readout) readout.textContent = `${Math.round(timingDeltaZoom * 100)}%`;
  if (zoomOut) zoomOut.disabled = timingDeltaZoom <= MIN_TIMING_DELTA_ZOOM;
  if (zoomIn) zoomIn.disabled = timingDeltaZoom >= MAX_TIMING_DELTA_ZOOM;
  if (reset) reset.disabled = Math.abs(timingDeltaZoom - 1) < 1e-6;
}

function setTimingDeltaZoom(nextZoom) {
  const clamped = Math.max(MIN_TIMING_DELTA_ZOOM, Math.min(MAX_TIMING_DELTA_ZOOM, nextZoom));
  timingDeltaZoom = Number((Math.round(clamped / TIMING_DELTA_ZOOM_STEP) * TIMING_DELTA_ZOOM_STEP).toFixed(2));
  updateTimingDeltaZoomReadout();
  drawRealChart('Timing delta');
}

function zoomTraceBy(factor) {
  const span = traceZoom.end - traceZoom.start;
  const nextSpan = Math.max(MIN_TRACE_ZOOM, Math.min(1, span * factor));
  const centre = (traceZoom.start + traceZoom.end) / 2;
  let start = centre - nextSpan / 2;
  let end = centre + nextSpan / 2;
  if (start < 0) { end -= start; start = 0; }
  if (end > 1) { start -= end - 1; end = 1; }
  setTraceZoom(start, end);
}

function panTrace(direction) {
  const span = traceZoom.end - traceZoom.start;
  const shift = span * .35 * direction;
  let start = traceZoom.start + shift;
  let end = traceZoom.end + shift;
  if (start < 0) { end -= start; start = 0; }
  if (end > 1) { start -= end - 1; end = 1; }
  setTraceZoom(start, end);
}

function bindChartZoom() {
  $('[data-trace-focus="open"]')?.addEventListener('click', () => setTraceFocus(true));
  $('[data-trace-focus="close"]')?.addEventListener('click', () => setTraceFocus(false));
  $('[data-zoom="in"]')?.addEventListener('click', () => zoomTraceBy(.55));
  $('[data-zoom="out"]')?.addEventListener('click', () => zoomTraceBy(1.8));
  $('[data-zoom="reset"]')?.addEventListener('click', () => setTraceZoom(0, 1));
  $('[data-pan="left"]')?.addEventListener('click', () => panTrace(-1));
  $('[data-pan="right"]')?.addEventListener('click', () => panTrace(1));
  $('[data-delta-zoom="out"]')?.addEventListener('click', () => setTimingDeltaZoom(timingDeltaZoom - TIMING_DELTA_ZOOM_STEP));
  $('[data-delta-zoom="in"]')?.addEventListener('click', () => setTimingDeltaZoom(timingDeltaZoom + TIMING_DELTA_ZOOM_STEP));
  $('[data-delta-zoom="reset"]')?.addEventListener('click', () => setTimingDeltaZoom(1));
  const speedCanvas = document.querySelector('[data-chart="Speed trace"]');
  if (speedCanvas) {
    speedCanvas.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !loaded.length) return;
      const rect = speedCanvas.getBoundingClientRect();
      const local = Math.max(0, Math.min(1, (event.clientX - rect.left - TRACE_PLOT_LEFT) / (rect.width - TRACE_PLOT_LEFT - TRACE_PLOT_RIGHT)));
      const fraction = traceZoom.start + local * (traceZoom.end - traceZoom.start);
      zoomDrag = { anchor: fraction, current: fraction };
      speedCanvas.setPointerCapture?.(event.pointerId);
      hoverFraction = null;
      event.preventDefault();
      drawRealChart('Speed trace');
    });
    speedCanvas.addEventListener('dblclick', () => setTraceZoom(0, 1));
    speedCanvas.addEventListener('pointercancel', () => { zoomDrag=null; drawRealChart('Speed trace'); });
  }
  updateZoomReadout();
  updateTimingDeltaZoomReadout();
}

let traceFocusReturn = null;
let traceFocusPreviousView = null;
let traceFocusInert = [];
function setTraceFocus(expanded) {
  const charts = $('#charts');
  if (!charts) return;
  if (expanded) {
    if(document.body.classList.contains('trace-focus'))return;
    traceFocusReturn = document.activeElement;
    traceFocusPreviousView = {zoom:{...traceZoom},delta:timingDeltaZoom};
    // Inert only siblings along the ancestor path, never an ancestor of charts.
    traceFocusInert = [];
    for (let node = charts; node.parentElement; node = node.parentElement) {
      for (const sibling of node.parentElement.children) {
        if (sibling === node || ['SCRIPT','STYLE','LINK'].includes(sibling.tagName)) continue;
        traceFocusInert.push([sibling,sibling.inert]);sibling.inert = true;
      }
      if (node.parentElement === document.body) break;
    }
    charts.setAttribute('role','dialog');charts.setAttribute('aria-modal','true');
    // The expanded view is for reading the entire lap, not magnifying a section.
    traceZoom = { start: 0, end: 1 };
    hoverFraction = null;
    updateZoomReadout();
  }
  else if(traceFocusPreviousView) {
    traceZoom={...traceFocusPreviousView.zoom};timingDeltaZoom=traceFocusPreviousView.delta;
    traceFocusPreviousView=null;updateZoomReadout();updateTimingDeltaZoomReadout();
    for (const [element,inert] of traceFocusInert) element.inert = inert;
    traceFocusInert = [];charts.setAttribute('role','region');charts.removeAttribute('aria-modal');
  }
  document.body.classList.toggle('trace-focus', expanded);
  $('#realTooltip').style.display = 'none';
  charts.setAttribute('aria-label', expanded ? 'Expanded speed trace and timing delta' : 'Telemetry charts');
  $('[data-trace-focus="open"]')?.setAttribute('aria-expanded', String(expanded));
  if (expanded) $('[data-trace-focus="close"]')?.focus();
  else if (traceFocusReturn?.isConnected) traceFocusReturn.focus();
  requestAnimationFrame(() => {
    drawRealChart('Speed trace');
    drawRealChart('Timing delta');
  });
}

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && document.body.classList.contains('trace-focus')) {
    event.preventDefault();
    setTraceFocus(false);
  }
  if (event.key === 'Tab' && document.body.classList.contains('trace-focus')) {
    const choices=[...$('#charts').querySelectorAll('button,input,summary,[tabindex="0"]')].filter(el=>!el.disabled&&!el.closest('[inert]')&&el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden');
    const first=choices[0],last=choices.at(-1);
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
  }
});

function finishZoomDrag() {
  if (!zoomDrag) return;
  const { anchor, current } = zoomDrag;
  zoomDrag = null;
  if (Math.abs(current - anchor) < MIN_TRACE_ZOOM || !setTraceZoom(anchor, current)) {
    drawAll();
  }
}

function renderTraceVisibilityControls() {
  const root = $('#traceDriverToggles');
  if (!root) return;
  const activeKeys = new Set(loaded.map(telemetryKey));
  [...hiddenTraceKeys].forEach(key => {
    if (!activeKeys.has(key)) hiddenTraceKeys.delete(key);
  });
  if (!loaded.length) {
    root.innerHTML = '<span class="trace-filter-empty">Load laps to choose traces</span>';
    return;
  }

  const visibleCount = visibleTraceLaps().length;
  root.innerHTML = loaded.map((lap, index) => {
    const key = telemetryKey(lap);
    const visible = !hiddenTraceKeys.has(key);
    const disableLast = visible && visibleCount === 1;
    const displayTime=Number.isFinite(lap.real?.display_time)?lap.real.display_time:lap.time;
    const lapLabel=`${lap.real?.display_time_estimated?'~':''}${time(displayTime)}s`;
    return `<div class="trace-pill-group" style="--team:${getLapColor(lap)}"><label class="trace-driver-chip ${visible ? 'is-visible' : ''}" style="--team:${getLapColor(lap)}" title="${visible ? 'Hide' : 'Show'} ${lap.code} lap ${lap.lap}">
      <input type="checkbox" data-trace-key="${key}" ${visible ? 'checked' : ''} ${disableLast ? 'disabled' : ''}>
      <b>${lap.code}</b><small>${lapLabel}</small>
    </label><label class="trace-swatch" title="Change ${lap.code} lap ${lap.lap} colour"><input type="color" value="${getLapColor(lap)}" data-lap-color="${key}" aria-label="Change ${lap.code} lap ${lap.lap} trace colour"></label></div>`;
  }).join('');

  root.querySelectorAll('input[data-lap-color]').forEach(input => {
    input.addEventListener('change', event => {
      lapColorOverrides.set(event.target.dataset.lapColor, event.target.value);
      renderLoaded(); renderSectors(); renderTraceVisibilityControls(); drawAll();
    });
  });
  root.querySelectorAll('input[data-trace-key]').forEach(input => {
    input.addEventListener('change', event => {
      const key = event.target.dataset.traceKey;
      if (event.target.checked) hiddenTraceKeys.delete(key);
      else if (visibleTraceLaps().length > 1) hiddenTraceKeys.add(key);
      syncTraceVisibilityControls();
      drawAll();
    });
  });
}

function syncTraceVisibilityControls() {
  const root = $('#traceDriverToggles');
  if (!root) return;
  const visibleCount = visibleTraceLaps().length;
  root.querySelectorAll('input[data-trace-key]').forEach(input => {
    const visible = !hiddenTraceKeys.has(input.dataset.traceKey);
    const chip = input.closest('.trace-driver-chip');
    input.checked = visible;
    input.disabled = visible && visibleCount === 1;
    chip?.classList.toggle('is-visible', visible);
    if (chip) chip.title = `${visible ? 'Hide' : 'Show'} ${chip.querySelector('b')?.textContent || ''} trace`;
  });
}

function bindSpeedChartControls() {
  $('#speedAnnotationToggle')?.addEventListener('change', event => {
    showSpeedAnnotations = event.target.checked;
    window.ApexAnalysis?.savePreference('speed-annotations',showSpeedAnnotations);
    if (loaded.length) drawRealChart('Speed trace');
  });
  $('#cornerToggle')?.addEventListener('change', event => {
    showCornerNumbers = event.target.checked;
    window.ApexAnalysis?.savePreference('corner-numbers',showCornerNumbers);
    const status = $('#cornerStatus');
    if (status) status.textContent = showCornerNumbers
      ? 'Corner labels and adaptive analysis active.'
      : 'Corner labels hidden.';
    if (loaded.length) drawAll();
  });

}

function renderCharts() {
  const root = $('#charts');
  const season = Number($('#year').value);
  const activeDefs = season >= 2026
    ? defs.filter(([name]) => name !== 'DRS')
    : defs;
  root.innerHTML = activeDefs.map(([name, unit, compact]) => {
    return `
    <section class="chart ${compact ? 'compact' : ''} ${name === 'Speed trace' ? 'speed-chart' : ''}">
      <div class="chart-heading"><h2>${name} <small>${unit}</small></h2>${name === 'Speed trace' ? `
        <div class="trace-zoom-cluster" aria-label="Trace zoom controls">
          <span class="trace-zoom-readout">View <b id="traceZoomReadout">Full lap</b></span>
          <div class="trace-tools">
            <button data-zoom="out" title="Zoom out" aria-label="Zoom out">−</button>
            <button data-zoom="in" title="Zoom in" aria-label="Zoom in">+</button>
            <span class="trace-tool-separator" aria-hidden="true"></span>
            <button data-pan="left" title="Move zoom window left" aria-label="Move zoom window left">‹</button>
            <button data-pan="right" title="Move zoom window right" aria-label="Move zoom window right">›</button>
            <button class="trace-reset" data-zoom="reset" title="Reset zoom">Reset</button>
          </div>
        </div><button type="button" class="trace-focus-button" data-trace-focus="open" aria-expanded="false" aria-controls="charts" title="Show speed trace and timing delta across the full page">Expand charts</button><button type="button" class="trace-focus-button trace-focus-close" data-trace-focus="close" title="Return to session analysis">Close view</button>` : name === 'Timing delta' ? `
        <div class="trace-zoom-cluster delta-zoom-cluster" aria-label="Timing delta vertical zoom controls">
          <span class="trace-zoom-readout">Scale <b id="timingDeltaZoomReadout">${Math.round(timingDeltaZoom * 100)}%</b></span>
          <div class="trace-tools">
            <button data-delta-zoom="out" title="Zoom out by 5%" aria-label="Compress timing delta">−</button>
            <button data-delta-zoom="in" title="Zoom in by 5%" aria-label="Magnify timing delta">+</button>
            <button class="trace-reset" data-delta-zoom="reset" title="Fit all timing differences" aria-label="Fit timing delta">Fit</button>
          </div>
        </div>` : ''}</div>
      ${name === 'Speed trace' ? `
        <div class="speed-chart-controls">
          <div class="trace-settings" aria-label="Telemetry display settings">
            <div class="alignment-readout"><i></i><span id="alignmentStatus" data-state="idle">Speed trace controls</span></div>
            <label class="trace-setting"><input type="checkbox" id="cornerToggle" ${showCornerNumbers ? 'checked' : ''}><i aria-hidden="true"></i><span>Corner numbers</span></label>
            <label class="trace-setting" title="Label every measured speed peak and dip. Each lap uses its own minimum or maximum, matched to the other laps by GPS position. The fastest lap shows its speed in km/h; the others show their difference. A dash means that lap has no matching measured extreme."><input type="checkbox" id="speedAnnotationToggle" ${showSpeedAnnotations ? 'checked' : ''}><i aria-hidden="true"></i><span>Speed annotations</span></label>
          </div>
          <div class="trace-display-bar">
            <span>Visible traces</span>
            <div class="trace-driver-toggles" id="traceDriverToggles"></div>
          </div>
          <p class="pit-lap-notice" id="pitLapNotice" hidden>Pit-in laps include pit entry. Pit-out traces begin at pit exit and are partial; a lap marked IN/OUT may include a garage stop. No full-lap timing delta is shown for pit-out traces.</p>
          <span class="visually-hidden" id="cornerStatus" aria-live="polite">Corner labels hidden.</span>
        </div>` : ''}
      <canvas data-chart="${name}" role="img" aria-describedby="telemetryDataHelp" aria-label="${name}${name === 'Speed trace' ? '. Drag horizontally to zoom every telemetry chart.' : ''}"></canvas>
    </section>
  `;
  }).join('') + `<details class="chart-data-access" id="telemetryDataAccess"><summary>Inspect telemetry values</summary>
    <p id="telemetryDataHelp">Read every visible trace at a chosen lap distance. Use the distance slider or its arrow keys; Home and End go to the start and finish. Values use the same display calculations as the charts. Dashed segments bridge unusually long source-packet gaps; values inside are interpolated. ~ indicates an estimated repair; — means unavailable.</p>
    <div class="chart-sample-controls"><label for="telemetrySample">Lap distance</label><input id="telemetrySample" type="range" min="0" max="1000" step="1" value="0" aria-describedby="telemetryDataHelp"><output for="telemetrySample" id="telemetrySampleDistance">0.000 km</output></div>
    <output class="chart-sample-status" id="telemetrySampleStatus" aria-live="polite"></output>
    <div class="performance-table-wrap" tabindex="0" role="region" aria-label="Telemetry values at selected lap distance"><table class="performance-table"><caption>Values at selected lap distance</caption><thead><tr><th scope="col">Trace</th><th scope="col">Speed (km/h)</th><th scope="col">Delta (s)</th><th scope="col">Throttle (%)</th><th scope="col">Brake</th><th scope="col">Gear</th>${season<2026?'<th scope="col">DRS</th>':''}</tr></thead><tbody id="telemetrySampleRows"></tbody></table></div>
  </details>`;
  bindAllChartHover();
  bindChartZoom();
  bindSpeedChartControls();
  renderTraceVisibilityControls();
  $('#telemetryDataAccess').addEventListener('toggle',()=>{if($('#telemetryDataAccess').open)renderTelemetryReadout();});
  $('#telemetrySample').addEventListener('input',()=>{
    hoverFraction=Number($('#telemetrySample').value)/1000;
    hoveredChartName='Speed trace';defs.forEach(def=>drawChartHover(def[0]));drawMapHover();renderTelemetryReadout();
  });
  $('#dominanceCanvas')?.setAttribute('aria-describedby','telemetryDataHelp');
}

function renderTelemetryReadout() {
  const inspector=$('#telemetryDataAccess'),slider=$('#telemetrySample');
  if(!inspector?.open||!slider)return;
  const fraction=Number(slider.value)/1000,reference=loaded[0]&&telemetryCache.get(telemetryKey(loaded[0]));
  const maxDistance=reference?.at(-1)?.Distance||0,distance=(fraction*maxDistance/1000).toFixed(3)+' km';
  $('#telemetrySampleDistance').textContent=distance;slider.setAttribute('aria-valuetext',distance);
  slider.disabled=!reference?.length;
  const fields=[['Speed','Speed trace'],['Throttle','Throttle application'],['Brake','Brake application'],['nGear','Gear'],['DRS','DRS']];
  const rows=visibleTraceLaps().map(({lap,index})=>{
    const samples=telemetryCache.get(telemetryKey(lap));
    const values={};
    for(const [field,name] of fields){
      const value=['Speed','Throttle'].includes(field)&&typeof traceTelemetryValue==='function'?traceTelemetryValue(samples,fraction,field):interpolate(samples,fraction*maxDistance,field);
      const estimated=typeof isReconstructedTelemetry==='function'&&isReconstructedTelemetry(samples,fraction,field);
      const low=typeof telemetryEstimateInfo==='function'&&telemetryEstimateInfo(samples,fraction,field)?.confidence==='low';
      values[field]=!Number.isFinite(value)?'—':field==='Brake'?(value>=50?'On':'Off'):field==='DRS'?(value>=.5?'Open':'Closed'):(estimated?'~':'')+(['Speed','Throttle'].includes(field)?value.toFixed(3):Math.round(value))+(low?' (low confidence)':'');
    }
    const delta=lap.real?.out_lap||loaded[0]?.real?.out_lap?null:index===0?0:typeof displayDeltaAt==='function'?displayDeltaAt(samples,reference,fraction):deltaAt(samples,reference,fraction*maxDistance);
    const deltaText=Number.isFinite(delta)?(delta>=0?'+':'')+delta.toFixed(3):'—';
    const sourceGap=telemetrySourceGapAt(samples,fraction);
    return {label:`${lap.code} L${lap.lap}${index===0?' (reference)':''}${sourceGap?' · '+sourceGap.interval.toFixed(3)+' s source gap':''}`,values,deltaText};
  });
  $('#telemetrySampleRows').innerHTML=rows.length?rows.map(({label,values,deltaText})=>`<tr><th scope="row">${escapeUI(label)}</th><td>${values.Speed}</td><td>${deltaText}</td><td>${values.Throttle}</td><td>${values.Brake}</td><td>${values.nGear}</td>${Number($('#year').value)<2026?'<td>'+values.DRS+'</td>':''}</tr>`).join(''):'<tr><td colspan="7">Load a lap to inspect its telemetry.</td></tr>';
  $('#telemetrySampleStatus').textContent=rows.length?distance+' · '+rows.map(row=>row.label+': '+row.values.Speed+' km/h').join('; '):'Load a lap to inspect its telemetry.';
}


function deltaAt(samples, reference, targetDistance) {
  const fraction = Math.max(0, Math.min(1, targetDistance / referenceDistance()));
  const timeHere = calibratedElapsed(samples, fraction);
  const referenceHere = calibratedElapsed(reference, fraction);
  if (!Number.isFinite(timeHere) || !Number.isFinite(referenceHere)) return null;
  return timeHere - referenceHere;
}

function getSectorDistances(lap) {
  if (!lap) return { s1: null, s2: null };
  const samples = telemetryCache.get(telemetryKey(lap));
  if (!samples || !samples.length) return { s1: null, s2: null };

  const meta = lap.real || lap;
  const lapTime = lap.time ?? meta.time;
  const s1Time = meta.s1;
  const s2Time = meta.s2;
  
  if (!s1Time || !s2Time || !lapTime) return { s1: null, s2: null };
  
  const totalDist = samples[samples.length - 1].Distance || 5891;
  
  const s1TargetTime = s1Time;
  const s2TargetTime = s1Time + s2Time;
  
  let s1Pt = samples.find(pt => pt.ElapsedSeconds >= s1TargetTime);
  let s2Pt = samples.find(pt => pt.ElapsedSeconds >= s2TargetTime);
  
  const s1Dist = s1Pt ? s1Pt.Distance : totalDist * (s1Time / lapTime);
  const s2Dist = s2Pt ? s2Pt.Distance : totalDist * ((s1Time + s2Time) / lapTime);
  
  return { s1: s1Dist, s2: s2Dist };
}

function getNiceBounds(name, rawMin, rawMax) {
  let min = rawMin;
  let max = rawMax;
  let tickStep = null;
  
  if (name === 'Speed trace') {
    // Broadcast-style speed scale: a gridline every 50 km/h, with headroom
    // above the fastest peak for its label.
    min = Math.max(0, Math.floor((rawMin - 10) / 50) * 50);
    max = Math.ceil((rawMax + 25) / 50) * 50;
    tickStep = 50;
  } else if (name === 'Engine speed') {
    min = Math.max(0, Math.floor(rawMin / 500) * 500 - 500);
    let tempMax = Math.ceil(rawMax / 500) * 500 + 500;
    const diff = tempMax - min;
    const remainder = diff % 2000;
    if (remainder !== 0) {
      tempMax += (2000 - remainder);
    }
    max = tempMax;
  } else if (name === 'Timing delta') {
    const span = Math.max(rawMax - rawMin, 0.02);
    const targetTicks = span >= 2 ? 6 : 5;
    const magnitude = 10 ** Math.floor(Math.log10(span / targetTicks));
    const normalized = (span / targetTicks) / magnitude;
    const multiplier = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
    const step = multiplier * magnitude;
    min = rawMin >= 0 ? 0 : Math.floor(rawMin / step) * step;
    max = rawMax <= 0 ? 0 : Math.ceil(rawMax / step) * step;
    if (max - min < step * 2) {
      if (rawMax > 0) max = min + step * 2;
      else min = max - step * 2;
    }
    tickStep = step;
  } else if (name === 'Brake application') {
    min = 0;
    max = 100;
  } else if (name === 'Throttle application') {
    min = 0;
    max = 100;
  } else if (name === 'Gear') {
    min = 0;
    max = 8;
    tickStep = 1;
  } else if (name === 'DRS') {
    min = 0;
    max = 1;
  }
  
  return { min, max, tickStep };
}


// Keep zoom continuous: rounding the scaled bounds again swallowed small steps.
// Tick spacing can be nice while the plot limits change on every button press.
function timingDeltaBounds(rawMin, rawMax, zoom = 1) {
  const base = getNiceBounds('Timing delta', rawMin, rawMax);
  const min = base.min / zoom, max = base.max / zoom;
  return { min, max, tickStep: getNiceBounds('Timing delta', min, max).tickStep };
}


function connectorSegmentsIntersect(a, b, c, d) {
  const cross = (p,q,r) => (q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x);
  if(Math.max(a.x,b.x)<Math.min(c.x,d.x)-.1 || Math.max(c.x,d.x)<Math.min(a.x,b.x)-.1 || Math.max(a.y,b.y)<Math.min(c.y,d.y)-.1 || Math.max(c.y,d.y)<Math.min(a.y,b.y)-.1) return false;
  return cross(a,b,c)*cross(a,b,d)<=.01 && cross(c,d,a)*cross(c,d,b)<=.01;
}

// Nearby labels need no leader. Displaced labels stop at their text boundary
// and cannot cross an earlier leader or label (nor obscure a later label).
function cornerLabelConnector(point, box, leaders, boxes) {
  if(leaders.some(line=>trackIntersectsLabel(box,[line.a,line.b],2))) return null;
  const end={x:Math.max(box.x,Math.min(box.x+box.width,point.x)),y:Math.max(box.y,Math.min(box.y+box.height,point.y))};
  const distance=Math.hypot(end.x-point.x,end.y-point.y);
  if(distance<=19) return {line:null};
  const start={x:point.x+(end.x-point.x)*5/distance,y:point.y+(end.y-point.y)*5/distance};
  if(leaders.some(line=>connectorSegmentsIntersect(start,end,line.a,line.b)) || boxes.some(b=>trackIntersectsLabel(b,[start,end],2))) return null;
  return {line:{a:start,b:end}};
}

function trackIntersectsLabel(box, points, clearance = 8, closed = true) {
  const left = box.x - clearance, right = box.x + box.width + clearance;
  const top = box.y - clearance, bottom = box.y + box.height + clearance;
  return points.some((a, index) => {
    if (!closed && index===points.length-1) return false;
    const b = points[(index + 1) % points.length];
    if (Math.max(a.x,b.x) < left || Math.min(a.x,b.x) > right || Math.max(a.y,b.y) < top || Math.min(a.y,b.y) > bottom) return false;
    let enter = 0, leave = 1;
    for (const [start, delta, min, max] of [[a.x,b.x-a.x,left,right],[a.y,b.y-a.y,top,bottom]]) {
      if (Math.abs(delta) < 1e-9) { if (start < min || start > max) return false; continue; }
      const t1 = (min-start)/delta, t2 = (max-start)/delta;
      enter = Math.max(enter, Math.min(t1,t2));
      leave = Math.min(leave, Math.max(t1,t2));
      if (enter > leave) return false;
    }
    return true;
  });
}

function cornerLabel(corner) {
  return `T${corner.number}${corner.letter || ''}`;
}

// Approximate apex chainage digitized against the FIA Madrid circuit map,
// version 3 (10 Sep 2026), and the bundled es-2026 centreline. Anchored at
// T7 = S1 + 85m and T16 = S1 + S2 + 40m; circuit length = 5414m.
// These are map-derived annotations, not surveyed telemetry coordinates.
// Full methodology and primary source: assets/circuits/madrid-corners.md.
const MADRID_MAP_CORNERS = Object.freeze([
  ['1',454], ['2',505], ['3',643], ['4',1332], ['5',1545], ['5A',1569],
  ['6',1605], ['7',1924], ['8',1983], ['9',2086], ['10',2271], ['11',2370],
  ['12',2696], ['13',3301], ['14',3492], ['15',3732], ['16',3928],
  ['17',3993], ['18',4237], ['19',4455], ['20',4789], ['20A',4833],
  ['21',4943], ['22',5260],
].map(([label, distance]) => Object.freeze({
  number: label.replace(/[A-Z]/g, ''), letter: label.replace(/[0-9]/g, ''),
  distance, fraction: distance / 5414, source: 'fia_map_estimate', approximate: true,
})));

// Numbering verified against Sepang's official safety-briefing circuit map.
// Chainage is approximate, digitized on the bundled my-1999 centreline.
const SEPANG_MAP_CORNERS = Object.freeze([
  [6,367],[14,507],[24,783],[35,1307],[44,1683],[52,1908],[57,2290],
  [60,2401],[66,2891],[71,3053],[78,3249],[83,3585],[89,3801],[94,3931],[100,4879],
].map(([outlineIndex,distance], i) => Object.freeze({number:String(i+1),letter:'',
  outlineIndex,distance,fraction:distance/5543,source:'official_map_estimate',approximate:true})));

// Geographic anchors, normalized against the complete north-up Sepang outline.
// Do not transfer its chainage to a car stream: integrated telemetry distance
// and the map's start line are not interchangeable.
const SEPANG_CORNER_POSITIONS = Object.freeze([
  [0,.477778],[.094181,.517310],[.070923,.785614],[.479518,.992982],
  [.604422,.655322],[.774407,.745614],[1,.466316],[.957504,.364211],
  [.547569,.291813],[.638783,.175322],[.572071,0],[.338821,.200585],
  [.162902,.151111],[.095616,.249942],[.858059,.488187],
]);

function projectSepangCorners(samples) {
  const points = samples.filter(p => p.X != null && p.Y != null && Number.isFinite(+p.X) && Number.isFinite(+p.Y));
  if (points.length < 30) return [];
  const minX = Math.min(...points.map(p => +p.X)), maxX = Math.max(...points.map(p => +p.X));
  const minY = Math.min(...points.map(p => +p.Y)), maxY = Math.max(...points.map(p => +p.Y));
  if (maxX <= minX || maxY <= minY) return [];
  const normalized = points.map(p => ({x:(+p.X-minX)/(maxX-minX), y:(+p.Y-minY)/(maxY-minY), fraction:traceSampleFraction(samples,p)}));
  let previous = -Infinity;
  return SEPANG_MAP_CORNERS.flatMap((corner,index) => {
    const [x,y] = SEPANG_CORNER_POSITIONS[index];
    let best = null;
    for (let i=1;i<normalized.length;i++) {
      const a=normalized[i-1], b=normalized[i];
      if (b.fraction <= previous || b.fraction-a.fraction > .025) continue;
      const dx=b.x-a.x, dy=b.y-a.y;
      const t=Math.max(0,Math.min(1,((x-a.x)*dx+(y-a.y)*dy)/(dx*dx+dy*dy||1)));
      const fraction=a.fraction+(b.fraction-a.fraction)*t;
      if (fraction <= previous) continue;
      const error=Math.hypot(a.x+t*dx-x,a.y+t*dy-y);
      if (!best || error<best.error) best={fraction,error};
    }
    // Missing or mismatched GPS must not produce convincing but wrong labels.
    if (!best || best.error>.045) return [];
    previous=best.fraction;
    return [{...corner,key:`${corner.number}:`,fraction:best.fraction,source:'map_position',approximate:true}];
  });
}

function isSepangCircuit(event = null) {
  const key = sessionCircuitKey ?? event?.circuit_key;
  const location = normalizedPlaceName(sessionLocation || event?.location || '');
  // A supplied identity always wins over a familiar Grand Prix name.
  return key != null && Number(key) > 0 ? Number(key) === 12 : /sepang|kuala lumpur/.test(location);
}

function markerRowsForCurrentCircuit(rows) {
  rows = Array.isArray(rows) ? rows : [];
  const selectedVal = selectValue($('#gp'));
  const event = calendar.find(item => String(item.round) === String(selectedVal) || item.name === selectedVal) || calendar[0];
  const year = sessionYear || Number(selectValue($('#year')));
  const name = normalizedPlaceName(sessionEventName || event?.name);

  if (isSepangCircuit(event) && !rows.length) {
    return SEPANG_MAP_CORNERS.map(marker => ({...marker}));
  }

  // The 2026 Spanish GP moved to the new 22-turn Madring. Until its circuit
  // metadata is published, the upstream provider returns Barcelona's old
  // 14-corner rows under the shared "Spanish Grand Prix" event name. Never
  // project that visibly wrong circuit over Madrid telemetry. Use the
  // documented map fallback until a complete native Madrid set is available.
  if (year >= 2026 && name.includes('spanish grand prix')) {
    const numericTurns = new Set(rows.map(row => Number(row.number)).filter(Number.isFinite));
    if (!Array.from({length:22}, (_, index) => index + 1).every(turn => numericTurns.has(turn))) {
      return MADRID_MAP_CORNERS.map(marker => ({...marker}));
    }
  }
  return rows;
}

function resolveCornerMarkers(samples, totalDistance, suppliedMarkers = null) {
  if (!samples?.length || !Number.isFinite(totalDistance) || totalDistance <= 0) return [];
  // Telemetry responses carry corner fractions projected against this exact
  // reference lap. Only use the session-level rows as a fallback for older
  // responses, where a client-side X/Y projection remains useful.
  const markerRows = markerRowsForCurrentCircuit(Array.isArray(suppliedMarkers) && suppliedMarkers.length
    ? suppliedMarkers
    : corners);
  if (markerRows.length && isSepangCircuit() && markerRows.every(row => row.source === 'official_map_estimate')) {
    return projectSepangCorners(samples);
  }
  const positionSamples = samples.filter(point => point.X != null && point.Y != null && Number.isFinite(+point.X) && Number.isFinite(+point.Y));
  const xs = positionSamples.map(point => +point.X);
  const ys = positionSamples.map(point => +point.Y);
  const diagonal = positionSamples.length > 1
    ? Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
    : 0;

  // A circuit can pass close to itself (Baku T20 is beside T5/T6).
  // Project in turn order so a later corner cannot snap to an earlier pass.
  let previousFraction = 0;
  const orderedRows = [...markerRows].sort((a, b) =>
    Number(a.number) - Number(b.number) || String(a.letter || '').localeCompare(String(b.letter || '')));
  const resolved = orderedRows.map(corner => {
    const suppliedFraction = corner.fraction;
    let fraction = suppliedFraction == null || suppliedFraction === ''
      ? NaN
      : Number(suppliedFraction);
    let source = corner.source || 'distance';
    if (!Number.isFinite(fraction)) {
      const distance = corner.distance == null || corner.distance === ''
        ? NaN
        : Number(corner.distance);
      fraction = Number.isFinite(distance) ? distance / totalDistance : NaN;
    }

    // CircuitInfo's Distance is only present when FastF1 could load a car
    // stream. Otherwise project the official corner X/Y onto this actual lap.
    if (!Number.isFinite(fraction) || fraction <= previousFraction + .001 || fraction > 1.02) {
      const x = Number(corner.x), y = Number(corner.y);
      let nearest = null;
      let nearestDistance = Infinity;
      if (Number.isFinite(x) && Number.isFinite(y)) {
        positionSamples.forEach(point => {
          if ((+point.Distance || 0) / totalDistance <= previousFraction + .001) return;
          const distance = Math.hypot(+point.X - x, +point.Y - y);
          if (distance < nearestDistance) {
            nearestDistance = distance;
            nearest = point;
          }
        });
      }
      // Reject mismatched coordinate systems rather than putting labels on
      // arbitrary parts of the graph.
      if (nearest && diagonal > 0 && nearestDistance / diagonal <= 0.12) {
        fraction = (+nearest.Distance || 0) / totalDistance;
        source = 'position';
      } else {
        fraction = NaN;
      }
    }

    if (Number.isFinite(fraction) && fraction > previousFraction) previousFraction = fraction;
    const rawFraction = fraction;
    // Corner fractions arrive in the source lap's distance coordinates; the
    // charts and map use the registered comparison grid after alignment.
    if (Number.isFinite(samples[0]?.AlignedFraction) && Number.isFinite(fraction)) {
      const target = fraction * (+samples[samples.length - 1]?.Distance || totalDistance);
      const afterIndex = samples.findIndex(p => +p.Distance >= target);
      if (afterIndex >= 0) {
        const before = samples[Math.max(0,afterIndex-1)], after = samples[afterIndex];
        if (Number.isFinite(before.AlignedFraction) && Number.isFinite(after.AlignedFraction)) {
          const ratio = Math.max(0,Math.min(1,(target-before.Distance)/(after.Distance-before.Distance||1)));
          fraction = before.AlignedFraction + (after.AlignedFraction-before.AlignedFraction)*ratio;
        }
      }
    }
    return {
      ...corner,
      key: `${corner.number}:${corner.letter || ''}`,
      fraction,
      rawFraction,
      source,
    };
  }).filter(marker => Number.isFinite(marker.fraction) && marker.fraction > 0 && marker.fraction <= 1);

  // MultiViewer occasionally has duplicate labels. Keep only one marker per
  // turn, sorted into lap order so every chart shares the same geometry.
  return [...new Map(resolved.map(marker => [marker.key, marker])).values()]
    .sort((a, b) => a.fraction - b.fraction);
}

// Draw chart grid axes
function drawGridAxes(ctx, width, height, bounds, unit) {
  const { left, right, top, bottom, min, max, tickStep } = bounds;
  const theme = canvasTheme();
  ctx.font = canvasFont(12);
  const ticks = [];
  if (Number.isFinite(tickStep) && tickStep > 0) {
    for (let value = Math.floor((max + tickStep * .001) / tickStep) * tickStep; value >= min - tickStep * 0.001; value -= tickStep) {
      ticks.push({ value: Math.abs(value) < tickStep * 0.001 ? 0 : value });
    }
  } else {
    for (let tick = 0; tick <= 4; tick++) {
      ticks.push({ value: max - (max - min) * tick / 4, tick });
    }
  }

  ticks.forEach(({ value, tick }) => {
    const y = top + (height - top - bottom) * ((max - value) / (max - min || 1));
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(width - right, y);
    if (unit.includes('SECONDS') && Math.abs(value) < 1e-5) {
      ctx.strokeStyle = theme.gridStrong;
      ctx.lineWidth = 1.2;
    } else {
      ctx.strokeStyle = theme.grid;
      ctx.lineWidth = 1;
    }
    ctx.stroke();
    let displayVal = Math.round(value);
    if (unit.includes('SECONDS')) {
      const decimals = Number.isFinite(tickStep) && tickStep > 0
        ? Math.max(1, Math.min(3, Math.ceil(-Math.log10(tickStep)) + 1))
        : (Math.abs(max - min) <= 0.4 ? 2 : 1);
      displayVal = Math.abs(value) < 1e-8
        ? '0'
        : `${value > 0 ? '+' : ''}${value.toFixed(decimals)}`;
    }
    if (unit === 'OPEN / CLOSED' || unit === 'ON / OFF') {
      if (tick === 0) displayVal = 'OPEN';
      else if (tick === 4) displayVal = 'CLOSED';
      else return;
      if (unit === 'ON / OFF') displayVal = tick === 0 ? 'ON' : 'OFF';
    }
    ctx.fillStyle = unit.includes('SECONDS') && Math.abs(value) < 1e-5
      ? theme.textStrong
      : theme.text;
    ctx.textAlign = 'right';
    ctx.fillText(displayVal, left - 8, y + 3);
  });
  if (unit === 'KM/H') {
    // Axis title, rotated beside the tick labels: "Speed [km/h]".
    ctx.save();
    ctx.translate(11, top + (height - top - bottom) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.font = canvasFont(10, 500);
    ctx.fillStyle = theme.text;
    ctx.fillText('Speed [km/h]', 0, 0);
    ctx.restore();
  }
  ctx.textAlign = 'left';
}



function layoutSpeedCornerCallouts(markers, width, left = 43, right = 7, viewStart = 0, viewEnd = 1) {
  const gap = 3, maxNudge = 12;
  const plotWidth = width - left - right;
  const lanes = [];
  // Source corner rows are normally delivered in lap order, but sorting here
  // guarantees lane allocation still works if a provider returns them shuffled.
  const items = [...markers]
    .filter(corner => Number.isFinite(corner.fraction) && corner.fraction >= viewStart && corner.fraction <= viewEnd)
    .sort((a, b) => a.fraction - b.fraction)
    .map(corner => {
      const anchorX = left + ((corner.fraction - viewStart) / (viewEnd - viewStart || 1)) * plotWidth;
      const tagWidth = Math.max(22, String(cornerLabel(corner)).length * 7 + 8);
      // Nudge sideways a few pixels before opening another row; the tick keeps the exact position visible.
      for (let lane = 0; ; lane++) {
        lanes[lane] ||= [];
        for (const shift of [0, 4, -4, 8, -8, maxNudge, -maxNudge]) {
          const x = Math.max(left + tagWidth / 2, Math.min(width - right - tagWidth / 2, anchorX + shift));
          if (lanes[lane].every(([l, r]) => x + tagWidth / 2 + gap <= l || x - tagWidth / 2 - gap >= r)) {
            lanes[lane].push([x - tagWidth / 2, x + tagWidth / 2]);
            return { corner, x, anchorX, lane, width: tagWidth };
          }
        }
      }
    });
  return { items, lanes: lanes.length };
}

function sharedCornerSpeed(entry, fraction, totalDistance) {
  const samples=entry.samples;
  const index=samples.findIndex(p=>traceSampleFraction(samples,p)>=fraction);
  if(index<0)return null;
  const after=samples[index],af=traceSampleFraction(samples,after);
  const valid=p=>p?.Speed!=null&&Number.isFinite(+p.Speed)&&+p.Speed>0;
  if(Math.abs(af-fraction)<1e-9)return valid(after)?{lap:entry.lap,speed:+after.Speed,fraction,estimated:false}:null;
  if(index===0)return null;
  const before=samples[index-1],bf=traceSampleFraction(samples,before);
  if(!valid(before)||!valid(after)||!(af>bf)||af-bf>Math.max(40/totalDistance,.008))return null;
  if(finiteTelemetryTime(before.ElapsedSeconds)&&finiteTelemetryTime(after.ElapsedSeconds)
    && after.ElapsedSeconds-before.ElapsedSeconds>.6)return null;
  // Bounded interpolation of native speed at one shared spatial position,
  // not each driver's independently selected minimum or reconstructed curve.
  if(typeof telemetryEstimateInfo==='function'&&telemetryEstimateInfo(samples,fraction,'Speed'))return null;
  const ratio=(fraction-bf)/(af-bf);
  return {lap:entry.lap,speed:+before.Speed+(+after.Speed-before.Speed)*ratio,fraction,estimated:true};
}

// Each lap's own measured speed extremes: local minima and maxima of native
// samples with real (topographic) prominence. Never sampled at a corner marker
// or a fixed window edge, which reads entry or exit speed instead of the apex.
function lapSpeedExtremes(samples, totalDistance, {prominence=8, reach=900, gapSeconds=1.6, gapMetres=100}={}) {
  if (!samples?.length || !(totalDistance > 0)) return [];
  const points = samples
    .filter(p => p?.Speed != null && Number.isFinite(+p.Speed) && +p.Speed > 0)
    .map(p => ({fraction: traceSampleFraction(samples, p), speed: +p.Speed, x: +p.X, y: +p.Y, t: Number.isFinite(+p.ElapsedSeconds) && p.ElapsedSeconds != null ? +p.ElapsedSeconds : null}))
    .filter(p => Number.isFinite(p.fraction))
    .sort((a, b) => a.fraction - b.fraction);
  const metres = fraction => fraction * totalDistance;
  // A packet gap is a hole in the measurement, judged by time where known.
  // ~4 Hz feeds have routine 1.1 s packets (the drawn line bridges them), so
  // only longer holes are refused; without timestamps, 100 m.
  const gap = (a, b) => a.t != null && b.t != null ? b.t - a.t > gapSeconds : metres(b.fraction - a.fraction) > gapMetres;
  const result = [];
  for (let i = 0; i < points.length; i++) {
    const here = points[i], at = metres(here.fraction);
    // Plateaus: evaluate only the first sample of a run of equal speeds.
    // A plateau never spans a telemetry gap.
    if (i > 0 && points[i - 1].speed === here.speed && !gap(points[i - 1], here)) continue;
    let end = i; while (end + 1 < points.length && points[end + 1].speed === here.speed && !gap(points[end], points[end + 1])) end++;
    const before = points[i - 1], after = points[end + 1];
    if ((before && gap(before, here)) || (after && gap(points[end], after))) continue;
    for (const kind of ['max', 'min']) {
      const higher = (s) => kind === 'max' ? s > here.speed : s < here.speed;
      if ((before && higher(before.speed)) || (after && higher(after.speed))) continue;
      // The lap's first and last packets are a cut through the timing line, not a peak or dip.
      if (!before || !after) continue;
      // Walk outwards until a more extreme sample: the deepest opposite value on
      // each side is the col; prominence is the smaller of the two drops.
      const side = (step, start) => {
        let base = here.speed, j = start;
        while (j >= 0 && j < points.length && Math.abs(metres(points[j].fraction) - at) <= reach) {
          // Ties: an equal extreme earlier in the lap wins, so two equal
          // peaks (e.g. a 306 km/h plateau with a 1 km/h dip) get one label.
          if (higher(points[j].speed) || (step < 0 && points[j].speed === here.speed)) break;
          base = kind === 'max' ? Math.min(base, points[j].speed) : Math.max(base, points[j].speed);
          j += step;
        }
        return base;
      };
      const left = before ? side(-1, i - 1) : null, right = after ? side(1, end + 1) : null;
      const drops = [left, right].filter(v => v != null).map(v => Math.abs(here.speed - v));
      const depth = Math.min(...drops);
      if (!(depth >= prominence)) continue;
      const mid = points[Math.floor((i + end) / 2)];
      result.push({kind, ...here, fraction: mid.fraction, x: mid.x, y: mid.y, prominence: depth});
    }
  }
  return result.filter(e => !(typeof telemetryEstimateInfo === 'function' && telemetryEstimateInfo(samples, e.fraction, 'Speed')));
}

// Raw GPS units per metre of this lap, so a 70 m match radius works whether
// the feed reports metres or tenths of a metre.
function lapPositionScale(samples, totalDistance) {
  let path = 0, previous = null;
  for (const p of samples || []) {
    if (!Number.isFinite(+p?.X) || !Number.isFinite(+p?.Y) || p.X == null || p.Y == null) continue;
    if (previous) path += Math.hypot(+p.X - previous.x, +p.Y - previous.y);
    previous = {x: +p.X, y: +p.Y};
  }
  return path > 0 && totalDistance > 0 ? path / totalDistance : null;
}

// A lap's own raw minimum or maximum inside one segment (no matching extreme
// there, e.g. a flat-out kink for one driver but a lift for another).
function lapSegmentExtreme(samples, kind, from, to) {
  let best = null;
  for (const p of samples || []) {
    const f = traceSampleFraction(samples, p);
    if (!(f >= from && f <= to) || p?.Speed == null || !(+p.Speed > 0)) continue;
    if (!best || (kind === 'max' ? +p.Speed > best.speed : +p.Speed < best.speed)) best = {speed: +p.Speed, fraction: f};
  }
  // An extreme sitting on the segment edge is just the slope continuing, not a peak or dip.
  const margin = (to - from) * .1;
  return best && best.fraction > from + margin && best.fraction < to - margin ? best : null;
}

const STEADY_SPEED_RANGE_KMH = 10;
function lapSpeedRange(samples, from, to) {
  let lo = Infinity, hi = -Infinity;
  for (const p of samples || []) {
    const f = traceSampleFraction(samples, p);
    if (!(f >= from && f <= to) || p?.Speed == null || !(+p.Speed > 0)) continue;
    lo = Math.min(lo, +p.Speed); hi = Math.max(hi, +p.Speed);
  }
  return hi >= lo ? hi - lo : null;
}

function buildSpeedAnnotations(entries, markers, totalDistance, {matchMetres=70, segmentMetres=120} = {}) {
  if (!entries?.length || !Number.isFinite(totalDistance) || totalDistance <= 0) return [];
  const lapsWithExtremes = entries.map(entry => ({entry, scale: lapPositionScale(entry.samples, totalDistance), extremes: lapSpeedExtremes(entry.samples, totalDistance)}));
  const [anchor, ...others] = lapsWithExtremes;
  const used = others.map(() => new Set());
  const nearestCorner = extreme => {
    let best = null;
    for (const marker of markers || []) {
      const gap = Math.abs(marker.fraction - extreme.fraction) * totalDistance;
      if (gap <= 150 && (!best || gap < best.gap)) best = {marker, gap};
    }
    return best?.marker || null;
  };
  return anchor.extremes.map(extreme => {
    const values = [{lap: anchor.entry.lap, speed: extreme.speed, fraction: extreme.fraction}];
    const missing = [];
    others.forEach((other, index) => {
      let best = null;
      other.extremes.forEach((candidate, candidateIndex) => {
        if (candidate.kind !== extreme.kind || used[index].has(candidateIndex)) return;
        // Match the same physical place by GPS; distance fractions drift between laps.
        const gps = [extreme.x, extreme.y, candidate.x, candidate.y].every(Number.isFinite) && anchor.scale && other.scale
          ? Math.hypot(candidate.x - extreme.x, candidate.y - extreme.y) / ((anchor.scale + other.scale) / 2)
          : null;
        const metres = gps ?? Math.abs(candidate.fraction - extreme.fraction) * totalDistance;
        if (metres <= matchMetres && (!best || metres < best.metres)) best = {candidate, candidateIndex, metres};
      });
      if (best) { used[index].add(best.candidateIndex); values.push({lap: other.entry.lap, speed: best.candidate.speed, fraction: best.candidate.fraction}); return; }
      // No matching extreme: that lap's own raw extreme in the same segment.
      const span = segmentMetres / totalDistance;
      const own = lapSegmentExtreme(other.entry.samples, extreme.kind, extreme.fraction - span, extreme.fraction + span);
      if (own && !(typeof telemetryEstimateInfo === 'function' && telemetryEstimateInfo(other.entry.samples, own.fraction, 'Speed'))) { values.push({lap: other.entry.lap, speed: own.speed, fraction: own.fraction, segment: true}); return; }
      // No dip or peak of its own: this lap held a steady speed through here
      // (flat out where the anchor lifted). Its measured speed at the same
      // place is the comparison, not a blank. Only when steady: on a slope a
      // few metres of position drift would read entry or exit speed instead.
      const steady = lapSpeedRange(other.entry.samples, extreme.fraction - span, extreme.fraction + span);
      const here = steady !== null && steady <= STEADY_SPEED_RANGE_KMH ? sharedCornerSpeed(other.entry, extreme.fraction, totalDistance) : null;
      if (here) values.push({lap: other.entry.lap, speed: here.speed, fraction: extreme.fraction, atPoint: true});
      else missing.push(other.entry.lap);
    });
    values.sort((a, b) => b.speed - a.speed);
    const corner = extreme.kind === 'min' ? nearestCorner(extreme) : null;
    return {title: corner ? cornerLabel(corner) : '', kind: extreme.kind, fraction: extreme.fraction, speed: values[0].speed, values, missing};
  });
}

// Broadcast-style labels: the leader's whole km/h, then every other lap's
// whole-km/h difference, stacked in lap colours.
function speedAnnotationLines(annotation) {
  const allLaps = [...annotation.values.map(v => v.lap), ...(annotation.missing || [])];
  const identity = lap => lap.code + (allLaps.filter(l => l.code === lap.code).length > 1 ? ` L${lap.lap}` : '');
  const leader = Math.round(annotation.values[0].speed);
  return [
    ...annotation.values.map((v, i) => {
      const delta = Math.round(v.speed) - leader;
      return {text: `${identity(v.lap)} ${i === 0 ? leader : delta === 0 ? '0' : (delta < 0 ? '−' : '+') + Math.abs(delta)}`, color: getLapColor(v.lap)};
    }),
    ...(annotation.missing || []).map(lap => ({text: `${identity(lap)} —`, color: getLapColor(lap)}))
  ];
}

function drawSpeedAnnotations(ctx, annotations, rect, bounds, xForFraction, viewStart, viewEnd, traces = []) {
  const theme = canvasTheme(), occupied = [];
  const bottom = rect.height - bounds.bottom, lineHeight = 13, plotRight = rect.width - bounds.right;
  const yFor = speed => bounds.top + (bounds.max - speed) / (bounds.max - bounds.min || 1) * (bottom - bounds.top);
  ctx.save();
  ctx.font = canvasFont(10, 600);
  ctx.textAlign = 'center';
  ctx.lineJoin = 'round';
  const collides = box => occupied.some(b => box.x < b.x + b.width + 3 && box.x + box.width + 3 > b.x && box.y < b.y + b.height + 2 && box.y + box.height + 2 > b.y);
  const fits = box => box.x >= bounds.left && box.x + box.width <= plotRight && box.y >= bounds.top + 14 && box.y + box.height <= bottom - 2;
  annotations.filter(a => a.fraction >= viewStart && a.fraction <= viewEnd).forEach(a => {
    const lines = speedAnnotationLines(a);
    const width = Math.max(...lines.map(l => ctx.measureText(l.text).width)) + 6;
    const height = lines.length * lineHeight + 2;
    const points = a.values.filter(v => v.fraction >= viewStart && v.fraction <= viewEnd).map(v => ({x: xForFraction(v.fraction), y: yFor(v.speed), color: getLapColor(v.lap)}));
    const px = xForFraction(a.fraction), py = yFor(a.speed);
    // Preferred side first (above peaks, below dips), then the other side,
    // then beside the point, so labels near the chart edges are never dropped.
    const vertical = (dir, offset) => ({x: Math.max(bounds.left, Math.min(plotRight - width, px - width / 2)), y: dir < 0 ? py - offset - height : py + offset, width, height});
    const sideways = (dir, offset) => ({x: dir < 0 ? px - offset - width : px + offset, y: Math.max(bounds.top + 14, Math.min(bottom - 2 - height, py - height / 2)), width, height});
    const first = a.kind === 'max' ? -1 : 1;
    const candidates = [];
    for (const offset of [7, 18, 32]) candidates.push(vertical(first, offset));
    for (const offset of [7, 18, 32]) candidates.push(vertical(-first, offset));
    for (const offset of [9, 22, 40]) candidates.push(sideways(1, offset), sideways(-1, offset));
    const clearOfTraces = box => !traces.some(trace => trackIntersectsLabel(box, trace.points, 1, false));
    const box = candidates.find(b => fits(b) && !collides(b) && clearOfTraces(b)) || candidates.find(b => fits(b) && !collides(b));
    if (!box) return;
    occupied.push(box);
    // Mark exactly where each value was measured, in that lap's colour.
    points.forEach(p => { ctx.beginPath(); ctx.arc(p.x, p.y, 2.6, 0, Math.PI * 2); ctx.fillStyle = p.color; ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = theme.labelStroke; ctx.stroke(); });
    // Leader from the measured point to the nearest edge of its label.
    const ex = Math.max(box.x, Math.min(box.x + box.width, px)), ey = Math.max(box.y, Math.min(box.y + box.height, py));
    if (Math.hypot(ex - px, ey - py) > 5) { ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(ex, ey); ctx.strokeStyle = theme.gridStrong; ctx.lineWidth = 1; ctx.stroke(); }
    lines.forEach((line, i) => {
      const ty = box.y + (i + 1) * lineHeight - 1;
      ctx.strokeStyle = theme.labelStroke; ctx.lineWidth = 3;
      ctx.strokeText(line.text, box.x + box.width / 2, ty);
      ctx.fillStyle = line.color;
      ctx.fillText(line.text, box.x + box.width / 2, ty);
    });
  });
  ctx.restore();
}


function traceSampleFraction(series, point) {
  return Number.isFinite(point?.AlignedFraction)
    ? point.AlignedFraction
    : (+point?.Distance || 0) / (+series?.[series.length - 1]?.Distance || 1);
}

function appendTracePoint(points, x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  const last = points[points.length - 1];
  if (last && Math.abs(last.x - x) < 1e-8) {
    last.y = y;
    return;
  }
  points.push({ x, y });
}

// Evidence only: these ranges never alter samples, alignment or calculations.
// Reuse the reconstruction engine's existing cadence rule, but inspect original
// packet times rather than repaired values or positions joined to the packets.
function telemetrySourceGapRanges(series) {
  if(!series?.length)return [];
  const identity=series.alignmentInputs;
  const memo=series.sourceGapEvidence;
  if(memo&&memo.identity===identity&&memo.length===series.length)return memo.ranges;
  const steps=series.slice(1).map((p,i)=>+p.ElapsedSeconds-(+series[i].ElapsedSeconds)).filter(dt=>dt>0&&dt<2).sort((a,b)=>a-b);
  const middle=Math.floor(steps.length/2),cadence=steps.length?(steps.length%2?steps[middle]:(steps[middle-1]+steps[middle])/2):.27;
  const threshold=Math.max(.6,cadence*2.2),ranges=[];
  for(let i=1;i<series.length;i++){
    const a=series[i-1],b=series[i];
    if(!finiteTelemetryTime(a.ElapsedSeconds)||!finiteTelemetryTime(b.ElapsedSeconds))continue;
    const interval=+b.ElapsedSeconds-(+a.ElapsedSeconds);
    if(interval<=threshold)continue;
    const start=traceSampleFraction(series,a),end=traceSampleFraction(series,b);
    if(Number.isFinite(start)&&Number.isFinite(end)&&end>start)ranges.push({start,end,interval,from:+a.ElapsedSeconds,to:+b.ElapsedSeconds});
  }
  Object.defineProperty(series,'sourceGapEvidence',{value:{identity,length:series.length,ranges},writable:true,configurable:true});
  return ranges;
}

function telemetrySourceGapAt(series,fraction) {
  return telemetrySourceGapRanges(series).find(gap=>fraction>gap.start+1e-10&&fraction<gap.end-1e-10)||null;
}

function telemetryTraceGapRanges(series,reference,name,index) {
  if(!['Speed trace','Throttle application','Timing delta'].includes(name)||name==='Timing delta'&&index===0)return [];
  const ranges=[...telemetrySourceGapRanges(series)];
  if(name==='Timing delta'&&reference!==series)ranges.push(...telemetrySourceGapRanges(reference));
  // The delta depends on both laps, including a hidden timing-reference trace.
  const merged=[];
  for(const range of ranges.sort((a,b)=>a.start-b.start)){
    const last=merged.at(-1);
    if(last&&range.start<=last.end)last.end=Math.max(last.end,range.end);
    else merged.push({start:range.start,end:range.end});
  }
  return merged;
}

function measuredContinuousTrace(series, field, viewStart, viewEnd) {
  const points = [];
  appendTracePoint(points, viewStart, alignedValue(series, viewStart, field));
  series.forEach(point => {
    if (point[field] === null || point[field] === undefined || !Number.isFinite(+point[field])) return;
    const fraction = traceSampleFraction(series, point);
    if (fraction > viewStart && fraction < viewEnd) appendTracePoint(points, fraction, +point[field]);
  });
  appendTracePoint(points, viewEnd, alignedValue(series, viewEnd, field));
  return points;
}

function discreteTraceState(field, value) {
  if (value === null || value === undefined || !Number.isFinite(+value)) return null;
  if (field === 'Brake') return +value >= 50 ? 100 : 0;
  if (field === 'DRS') return +value >= .5 ? 1 : 0;
  if (field === 'nGear') return Math.round(+value);
  return +value;
}

// Discrete states change at the observed packet, never at an invented midpoint.
// Keep missing packets and long gaps in the path so the tooltip cannot turn
// an unknown brake/DRS observation into an apparently measured state.
function measuredDiscreteTrace(series, field, viewStart, viewEnd) {
  const samples = series
    .map(point => ({ x: traceSampleFraction(series, point), y: discreteTraceState(field, point[field]), time: point.ElapsedSeconds }))
    .sort((a, b) => a.x - b.x);
  if (!samples.length) return [];
  const points = [{x:viewStart,y:discreteTraceState(field, alignedValue(series, viewStart, field))}];
  for (let index = 1; index < samples.length; index++) {
    const before = samples[index - 1];
    const after = samples[index];
    if (!(after.x > before.x)) continue;
    if (finiteTelemetryTime(after.time) && finiteTelemetryTime(before.time) && after.time-before.time>1) {
      const x=Math.max(viewStart,before.x+1e-9);
      if(x<viewEnd)points.push({x,y:null});
    }
    if (after.x > viewStart && after.x < viewEnd) points.push({x:after.x,y:after.y});
  }
  points.push({x:viewEnd,y:discreteTraceState(field, alignedValue(series, viewEnd, field))});
  return points;
}

function finiteTelemetryTime(value) { return value!==null && value!==undefined && Number.isFinite(+value); }

function sampledEnhancedTrace(series, field, viewStart, viewEnd, steps) {
  // Build the model once, then include every model knot as well as the display
  // grid. This guarantees measured extrema/gear landmarks are drawn even when
  // they fall between two uniform canvas samples.
  traceTelemetryValue(series, viewStart, field);
  const model = field === 'Speed' ? series.speedModel : series.throttleModel;
  const candidates = [];
  for (let step = 0; step <= steps; step++) {
    const fraction = viewStart + (viewEnd - viewStart) * step / steps;
    candidates.push({ x: fraction, y: traceTelemetryValue(series, fraction, field) });
  }
  model?.points?.forEach(point => {
    if (point.x > viewStart && point.x < viewEnd) candidates.push({ x: point.x, y: point.y });
  });
  if (hoverFraction !== null && hoverFraction >= viewStart && hoverFraction <= viewEnd) {
    candidates.push({ x: hoverFraction, y: traceTelemetryValue(series, hoverFraction, field) });
  }
  candidates.sort((a, b) => a.x - b.x);
  const points = [];
  candidates.forEach(point => appendTracePoint(points, point.x, point.y));
  return points;
}

function renderedTraceValue(points, fraction, stepped = false) {
  if (!points?.length) return null;
  if (fraction <= points[0].x) return points[0].y;
  if (fraction >= points[points.length - 1].x) return points[points.length - 1].y;
  let low = 1;
  let high = points.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (points[middle].x < fraction) low = middle + 1;
    else high = middle;
  }
  const after = points[low];
  const before = points[low - 1];
  if (Math.abs(after.x-fraction)<1e-9) return after.y;
  if (Math.abs(before.x-fraction)<1e-9) return before.y;
  if (before.y===null || after.y===null) return null;
  if (stepped) return Math.abs(after.x - fraction) < 1e-9 ? after.y : before.y;
  const ratio = (fraction - before.x) / (after.x - before.x || 1);
  return before.y + (after.y - before.y) * ratio;
}

const TRACE_PLOT_LEFT = 58;
const TRACE_PLOT_RIGHT = 7;
// Draw a single canvas chart
function drawRealChart(name) {
  const canvas = document.querySelector(`[data-chart="${name}"]`);
  if (!canvas) return;
  
  const rect = canvas.getBoundingClientRect();
  // Category switches and focused mode hide some channels. A zero-sized
  // backing canvas cannot be copied into the static drawing cache.
  if (rect.width < 1 || rect.height < 1) {
    chartStaticLayers.delete(canvas);
    return;
  }
  const dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, rect.width, rect.height);
  const theme = canvasTheme();
  
  const unit = defs.find(def => def[0] === name)?.[1] || '';
  const field = chartField[name];
  const visibleEntries = name === 'Timing delta'
    ? visibleTraceLaps().filter(({ lap }) => !lap.real?.out_lap)
    : visibleTraceLaps();
  const data = visibleEntries.map(({ lap }) => telemetryCache.get(telemetryKey(lap))).filter(Boolean);
  const viewStart = traceZoom.start;
  const viewEnd = traceZoom.end;
  const viewSpan = viewEnd - viewStart || 1;
  
  if (!loaded.length) {
    ctx.fillStyle = theme.text;
    ctx.font = canvasFont(12);
    ctx.fillText('Select a driver to begin comparison.', 43, 25);
    return;
  }

  if (name === 'Timing delta' && loaded[0]?.real?.out_lap) {
    ctx.fillStyle = theme.text;
    ctx.font = canvasFont(12);
    ctx.fillText('Select a complete lap as reference for timing delta.', 43, 25);
    return;
  }

  if (name === 'Timing delta' && !visibleEntries.length) {
    ctx.fillStyle = theme.text;
    ctx.font = canvasFont(12);
    ctx.fillText('Pit-out segments have no full-lap timing delta.', 43, 25);
    return;
  }
  
  if (!data.length) {
    ctx.fillStyle = theme.text;
    ctx.font = canvasFont(12);
    ctx.fillText('Loading telemetry data…', 43, 25);
    return;
  }

  if (name === 'Timing delta' && !telemetryCache.get(telemetryKey(loaded[0]))?.length) {
    ctx.fillStyle = theme.text;
    ctx.font = canvasFont(12);
    ctx.fillText('Waiting for reference lap…', 43, 25);
    return;
  }

  if (name === 'DRS' && Number($('#year').value) >= 2026
    && !data.some(series => series.modeAvailable)) {
    ctx.fillStyle = theme.textStrong;
    ctx.font = canvasFont(12);
    ctx.fillText('Straight-line mode is not published for this lap.', 43, 25);
    return;
  }
  
  let values = [];
  if (name === 'Timing delta') {
    const refSamples = telemetryCache.get(telemetryKey(loaded[0]));
    if (refSamples && refSamples.length) {
      const refDistance = refSamples[refSamples.length - 1].Distance || 5891;
      visibleEntries.filter(({ index }) => index !== 0).forEach(({ lap }) => {
        const samples = telemetryCache.get(telemetryKey(lap));
        if (!samples?.length) return;
        // Sample every delta-model interval when setting the axis. The old
        // 100-point scan could miss a narrow minimum that the 180-point path
        // still drew, letting the trace escape below the chart boundary.
        // Union of both modes keeps the scale stable when toggling enhanced.
        for (const mode of ['accurate', 'enhanced']) {
          const model = cachedDeltaModel(samples, refSamples, mode);
          const resolution = Math.max(360, model?.resolution || 0);
          for (let i = 0; i <= resolution; i++) {
            const fraction = viewStart + viewSpan * i / resolution;
            const v = displayDeltaAt(samples, refSamples, fraction, mode);
            if (Number.isFinite(v)) values.push(v);
          }
        }
      });
    }
    values.push(0);
  } else {
    data.forEach(series => series.forEach(pt => {
      const fraction = Number.isFinite(pt.AlignedFraction)
        ? pt.AlignedFraction
        : (+pt.Distance || 0) / (+series[series.length - 1].Distance || 1);
      if (fraction >= viewStart && fraction <= viewEnd && Number.isFinite(pt[field])) values.push(pt[field]);
    }));
  }
  
  values = values.filter(Number.isFinite);
  if (!values.length) return;
  
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  
  const niceBounds = name === 'Timing delta'
    ? timingDeltaBounds(rawMin, rawMax, timingDeltaZoom)
    : getNiceBounds(name, rawMin, rawMax);
  const min = niceBounds.min;
  const max = niceBounds.max;
  const refLap = loaded.find(lap => telemetryCache.get(telemetryKey(lap))?.length) || loaded[0];
  const refSamples = telemetryCache.get(telemetryKey(refLap));
  const totalDist = refSamples && refSamples.length ? refSamples[refSamples.length - 1].Distance : 5891;
  const axisLeft = TRACE_PLOT_LEFT;
  const speedCornerMarkers = name === 'Speed trace'
    ? resolveCornerMarkers(refSamples, totalDist, refLap?.cornerMarkers)
    : [];
  const cornerCalloutLayout = layoutSpeedCornerCallouts(speedCornerMarkers, rect.width, axisLeft, 7, viewStart, viewEnd);
  const cornerAxisInset = speedCornerMarkers.length
    ? 8 + cornerCalloutLayout.lanes * 20
    : 0;
  const bounds = {
    left: axisLeft,
    right: TRACE_PLOT_RIGHT,
    top: 8,
    bottom: 21 + (name === 'Speed trace' ? cornerAxisInset : 0),
    min,
    max,
    tickStep: niceBounds.tickStep
  };
  canvas.setAttribute('data-axis-min', String(bounds.min));
  canvas.setAttribute('data-axis-max', String(bounds.max));
  canvas.setAttribute('data-value-min', String(rawMin));
  canvas.setAttribute('data-value-max', String(rawMax));
  const plotWidth = rect.width - bounds.left - bounds.right;
  const xForFraction = fraction => bounds.left + ((fraction - viewStart) / viewSpan) * plotWidth;
  const fractionInView = fraction => fraction >= viewStart && fraction <= viewEnd;
  
  // Render grid axes
  drawGridAxes(ctx, rect.width, rect.height, bounds, unit);

  // Shared distance axis. Every telemetry chart uses the same visible range.
  const distanceTickCount = Math.max(2, Math.min(6, Math.floor(plotWidth / 100)));
  for (let tick = 0; tick <= distanceTickCount; tick++) {
    const fraction = viewStart + viewSpan * tick / distanceTickCount;
    const x = xForFraction(fraction);
    ctx.beginPath();
    ctx.moveTo(x, bounds.top);
    ctx.lineTo(x, rect.height - bounds.bottom);
    ctx.strokeStyle = theme.grid;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = theme.text;
    ctx.font = canvasFont(12);
    ctx.textAlign = tick === 0 ? 'left' : tick === distanceTickCount ? 'right' : 'center';
    ctx.fillText(`${Math.round(fraction * totalDist)} M`, x, rect.height - bounds.bottom + 18);
  }
  ctx.textAlign = 'left';
  
  if (name === 'Speed trace' && $('#cornerToggle').checked) {
    const count = speedCornerMarkers.length;
    const projection = refLap?.cornerMarkers?.[0]?.source === 'lap_projection';
    const approximate = speedCornerMarkers.some(marker => marker.approximate);
    $('#cornerStatus').textContent = approximate
      ? isSepangCircuit()
        ? `Sepang: ${count} map-derived turn positions matched to this lap's GPS (approximate).`
        : 'Madrid: 22 turns + T5A/T20A · approximate positions from the FIA circuit map.'
      : count
      ? `${count} official corner markers aligned to this lap${projection ? ' (lap projection).' : '.'}`
      : 'Corner coordinates are unavailable for this telemetry source.';
  }
  
  // Draw vertical sector lines in background
  const fallbackSectorDistances = getSectorDistances(refLap);
  const sectorBoundaries = typeof alignedSectorFractions === 'function'
    ? alignedSectorFractions(refSamples, refLap)
    : typeof sectorFractions === 'function'
      ? sectorFractions(refSamples, refLap)
    : [fallbackSectorDistances.s1 / totalDist, fallbackSectorDistances.s2 / totalDist].filter(Number.isFinite);
  sectorBoundaries.forEach(fraction => {
    if (!fractionInView(fraction)) return;
    const x = xForFraction(fraction);
    ctx.strokeStyle = theme.gridStrong;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, bounds.top);
    ctx.lineTo(x, rect.height - bounds.bottom);
    ctx.stroke();
  });

  if (name === 'Speed trace' && sectorBoundaries.length === 2) {
    const ranges = [[0, sectorBoundaries[0], 'SECTOR 1'], [sectorBoundaries[0], sectorBoundaries[1], 'SECTOR 2'], [sectorBoundaries[1], 1, 'SECTOR 3']];
    ctx.fillStyle = theme.text;
    ctx.font = canvasFont(12);
    ctx.textAlign = 'center';
    ranges.forEach(([start, end, label]) => {
      const visibleStart = Math.max(viewStart, start);
      const visibleEnd = Math.min(viewEnd, end);
      if (visibleEnd > visibleStart && (visibleEnd - visibleStart) / viewSpan > .08) {
        // Never let neighbouring sector names collide: shorten, then omit.
        const span = xForFraction(visibleEnd) - xForFraction(visibleStart) - 8;
        const text = ctx.measureText(label).width <= span ? label : label.replace('SECTOR ', 'S');
        if (ctx.measureText(text).width <= span) ctx.fillText(text, xForFraction((visibleStart + visibleEnd) / 2), bounds.top + 12);
      }
    });
    ctx.textAlign = 'left';
  }
  
  // Draw Corner dotted lines
  if ($('#cornerToggle').checked) {
    const markerCorners = resolveCornerMarkers(refSamples, totalDist, refLap?.cornerMarkers);
    markerCorners.forEach(corner => {
      const fraction = corner.fraction;
      if (Number.isFinite(fraction) && fractionInView(fraction)) {
        const x = xForFraction(fraction);
        
        ctx.strokeStyle = theme.gridStrong;
        ctx.lineWidth = 0.8;
        ctx.setLineDash([2, 3]);
        
        ctx.beginPath();
        ctx.moveTo(x, bounds.top);
        ctx.lineTo(x, rect.height - bounds.bottom);
        ctx.stroke();
        ctx.setLineDash([]);
        
      }
    });
  }
  
  // Build every path first so fills and keylines never cover a coloured trace.
  const traceEntries = [];
  visibleEntries.forEach(({ lap, index }) => {
    const series = telemetryCache.get(telemetryKey(lap));
    if (!series) return;
    
    const teamColor = getLapColor(lap);
    const refSeries = telemetryCache.get(telemetryKey(loaded[0]));
    
    // Accurate mode uses every supplied speed/throttle sample. Enhanced mode
    // samples the bounded reconstruction. Discrete channels are built at the
    // observed packet transitions used by alignedValue, including missing data.
    let domainPoints = [];
    if (name === 'Speed trace' || name === 'Throttle application') {
      domainPoints = enhancedInterpolationEnabled()
        ? sampledEnhancedTrace(series, field, viewStart, viewEnd, name === 'Speed trace' ? 640 : 420)
        : measuredContinuousTrace(series, field, viewStart, viewEnd);
    } else if (name === 'Brake application' || name === 'Gear' || name === 'DRS') {
      domainPoints = measuredDiscreteTrace(series, field, viewStart, viewEnd);
    } else {
      const steps = name === 'Timing delta' ? (enhancedInterpolationEnabled() ? 1200 : 360) : 180;
      for (let step = 0; step <= steps; step++) {
        const fraction = viewStart + viewSpan * step / steps;
        const targetDist = totalDist * fraction;
        const value = name === 'Timing delta'
          ? (index === 0 ? 0 : (typeof displayDeltaAt === 'function'
              ? displayDeltaAt(series, refSeries, fraction)
              : deltaAt(series, refSeries, targetDist)))
          : interpolate(series, targetDist, field);
        appendTracePoint(domainPoints, fraction, value);
      }
      if (name === 'Timing delta' && hoverFraction !== null && fractionInView(hoverFraction)) {
        domainPoints.push({ x: hoverFraction, y: displayDeltaAt(series, refSeries, hoverFraction) });
        domainPoints.sort((a, b) => a.x - b.x);
      }
    }
    const points = domainPoints.map(point => ({
      x: xForFraction(point.x),
      y: point.y===null?null:bounds.top + (bounds.max - point.y) / (bounds.max - bounds.min || 1)
        * (rect.height - bounds.top - bounds.bottom),
    }));
    if (points.length) traceEntries.push({ points, domainPoints, teamColor, index,
      sourceGaps:telemetryTraceGapRanges(series,refSeries,name,index) });
  });

  const tracePath = points => {
    ctx.beginPath();
    let previous=null;
    points.forEach(point => {
      if(point.y===null){previous=null;return;}
      if(!previous)ctx.moveTo(point.x,point.y);
      else {
        if (name === 'Gear' || name === 'DRS' || name === 'Brake application') ctx.lineTo(point.x,previous.y);
        ctx.lineTo(point.x,point.y);
      }
      previous=point;
    });
  };

  // Give every visible loaded lap its own restrained tint. Tinting follows the
  // rendered trace entries, so hidden trace toggles also hide their tint and
  // each colour remains identifiable when several laps overlap.
  const shadedFields = ['Speed trace', 'Throttle application', 'Brake application', 'Engine speed'];
  if (traceTintEnabled && traceEntries.length && shadedFields.includes(name)) {
    const bottomY = rect.height - bounds.bottom;
    const baseAlpha = name === 'Speed trace' ? .16 : .11;
    const tintAlpha = Math.min(baseAlpha, baseAlpha / Math.sqrt(Math.max(1, traceEntries.length)) * 1.45);
    traceEntries.forEach(({ points, teamColor }) => {
      if (!points.length || points.some(point=>point.y===null)) return;
      tracePath(points);
      ctx.lineTo(points[points.length - 1].x, bottomY);
      ctx.lineTo(points[0].x, bottomY);
      ctx.closePath();
      const gradient = ctx.createLinearGradient(0, bounds.top, 0, bottomY);
      gradient.addColorStop(0, hexToRgba(teamColor, tintAlpha));
      gradient.addColorStop(1, hexToRgba(teamColor, 0));
      ctx.fillStyle = gradient;
      ctx.fill();
    });
  }

  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  traceEntries.forEach(({ points, teamColor, index, sourceGaps }) => {
    ctx.strokeStyle = teamColor;
    const speedWidthMultiplier = name === 'Speed trace' ? 1.15 : 1;
    ctx.lineWidth = (index === 0 ? 1.44 : 1.12) * speedWidthMultiplier;
    ctx.shadowColor = teamColor;
    ctx.shadowBlur = 0;
    const gaps=sourceGaps.map(gap=>({start:Math.max(viewStart,gap.start),end:Math.min(viewEnd,gap.end)})).filter(gap=>gap.end>gap.start);
    if(!gaps.length){tracePath(points);ctx.stroke();return;}
    // Stroke the identical path twice through complementary clips. This only
    // changes the line style; it cannot move a knot or change a hover value.
    const clipWindows=windows=>{
      ctx.beginPath();for(const window of windows){const left=xForFraction(window.start),right=xForFraction(window.end);ctx.rect(left,bounds.top,right-left,rect.height-bounds.top-bounds.bottom);}ctx.clip();
    };
    const solid=[];let start=viewStart;
    for(const gap of gaps){if(gap.start>start)solid.push({start,end:gap.start});start=Math.max(start,gap.end);}
    if(start<viewEnd)solid.push({start,end:viewEnd});
    ctx.save();clipWindows(solid);ctx.setLineDash([]);tracePath(points);ctx.stroke();ctx.restore();
    ctx.save();clipWindows(gaps);ctx.setLineDash([4,3]);tracePath(points);ctx.stroke();ctx.restore();
  });
  ctx.shadowBlur = 0;
  if (name==='Speed trace' && showSpeedAnnotations) {
    const entries=visibleEntries.map(({lap})=>({lap,samples:telemetryCache.get(telemetryKey(lap))})).filter(e=>e.samples?.length && !e.lap.real?.out_lap);
    const key=totalDist.toFixed(1)+'|'+speedCornerMarkers.map(m=>`${m.key}:${m.fraction.toFixed(5)}`).join('|')+'|'+entries.map(e=>e.samples.positionRevision||0).join(':');
    if (!speedAnnotationCache || speedAnnotationCache.key!==key || speedAnnotationCache.entries.length!==entries.length || entries.some((e,i)=>speedAnnotationCache.entries[i].samples!==e.samples || speedAnnotationCache.entries[i].lap!==e.lap)) {
      speedAnnotationCache={key,entries,annotations:buildSpeedAnnotations(entries,speedCornerMarkers,totalDist)};
    }
    drawSpeedAnnotations(ctx,speedAnnotationCache.annotations,rect,bounds,xForFraction,viewStart,viewEnd,traceEntries);
  }
  
  // Draw collision-free corner labels in a reserved header band. Corner
  // speeds live in the dedicated analysis panel below the track map.
  if (name === 'Speed trace' && $('#cornerToggle').checked) {
    const rowHeight = 20;
    const calloutHeight = 16;
    cornerCalloutLayout.items.forEach(({ corner, x, anchorX, lane, width }) => {
      if (!Number.isFinite(corner.fraction)) return;
      const labelY = rect.height - cornerAxisInset + 4 + lane * rowHeight;
      const left = x - width / 2;
      // Tick from the exact corner position on the axis to its tag.
      ctx.beginPath(); ctx.moveTo(anchorX, rect.height - bounds.bottom); ctx.lineTo(anchorX, rect.height - bounds.bottom + 3); ctx.lineTo(x, labelY + 1.5);
      ctx.strokeStyle = theme.gridStrong; ctx.lineWidth = 1; ctx.stroke();

      // Small grey boxed turn tags, like broadcast speed-trace graphics.
      const label = cornerLabel(corner);
      ctx.font = canvasFont(10, 600);
      const tagWidth = width;
      const tagLeft = left;
      ctx.fillStyle = lightThemeActive() ? 'rgba(20,25,32,.08)' : 'rgba(255,255,255,.1)';
      ctx.strokeStyle = theme.outline;
      ctx.lineWidth = 1;
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') ctx.roundRect(tagLeft + .5, labelY + 1.5, tagWidth - 1, calloutHeight - 1, 3);
      else ctx.rect(tagLeft + .5, labelY + 1.5, tagWidth - 1, calloutHeight - 1);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = theme.textStrong;
      ctx.textAlign = 'center';
      ctx.fillText(label, tagLeft + tagWidth / 2, labelY + 12.5);
      ctx.textAlign = 'left';
    });
  }
  
  // Retain expensive axes/paths/annotations; pointer motion paints overlays only.
  const staticCanvas=document.createElement('canvas');
  staticCanvas.width=canvas.width;staticCanvas.height=canvas.height;
  staticCanvas.getContext('2d').drawImage(canvas,0,0);
  chartStaticLayers.set(canvas,{image:staticCanvas,rect,bounds,viewStart,viewEnd,traceEntries,visibleEntries,dpr,theme});
  // Render hover crosshair and marker circle
  if (hoverFraction !== null && fractionInView(hoverFraction)) {
    const crosshairX = xForFraction(hoverFraction);
    
    // Draw vertical crosshair line
    ctx.strokeStyle = theme.crosshair;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(crosshairX, bounds.top);
    ctx.lineTo(crosshairX, rect.height - bounds.bottom);
    ctx.stroke();
    
    // Draw intersection highlighted circle on each line
    visibleEntries.forEach(({ lap, index }) => {
      const series = telemetryCache.get(telemetryKey(lap));
      if (!series) return;
      const entry = traceEntries.find(item => item.index === index);
      const stepped = name === 'Brake application' || name === 'Gear' || name === 'DRS';
      const val = entry ? renderedTraceValue(entry.domainPoints, hoverFraction, stepped) : null;
      
      if (Number.isFinite(val)) {
        const x = crosshairX;
        const y = bounds.top + (bounds.max - val) / (bounds.max - bounds.min || 1) * (rect.height - bounds.top - bounds.bottom);
        const teamColor = getLapColor(lap);
        
        ctx.fillStyle = teamColor;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.shadowColor = teamColor;
        ctx.shadowBlur = 8;
        
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        
        ctx.shadowBlur = 0; // reset shadow
      }
    });
  }

  // Selection band while dragging on the speed trace. Releasing the mouse
  // applies this same distance window to every telemetry chart.
  if (name === 'Speed trace' && zoomDrag) {
    const start = Math.max(viewStart, Math.min(zoomDrag.anchor, zoomDrag.current));
    const end = Math.min(viewEnd, Math.max(zoomDrag.anchor, zoomDrag.current));
    const x = xForFraction(start);
    const width = Math.max(1, xForFraction(end) - x);
    ctx.fillStyle = 'rgba(89, 158, 220, .24)';
    ctx.fillRect(x, bounds.top, width, rect.height - bounds.top - bounds.bottom);
    ctx.strokeStyle = 'rgba(126, 193, 255, .88)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + .5, bounds.top + .5, Math.max(0, width - 1), rect.height - bounds.top - bounds.bottom - 1);
  }
}
