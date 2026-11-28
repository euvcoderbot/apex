/* Session analysis: chart and track-map hover. */
// Binds hover interactions on all canvas charts
function drawChartHover(name) {
  const canvas=document.querySelector(`[data-chart="${name}"]`),layer=canvas&&chartStaticLayers.get(canvas);
  if(!layer){drawRealChart(name);return;}
  if(!canvas.getBoundingClientRect().width)return;
  const {rect,bounds,viewStart,viewEnd,traceEntries,visibleEntries,dpr,theme}=layer;
  const ctx=canvas.getContext('2d');ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(layer.image,0,0);ctx.setTransform(dpr,0,0,dpr,0,0);
  if(hoverFraction===null||hoverFraction<viewStart||hoverFraction>viewEnd)return;
  const x=bounds.left+(hoverFraction-viewStart)/(viewEnd-viewStart)*(rect.width-bounds.left-bounds.right);
  // A crisp, clearly visible line (snapped to the pixel grid), with the lap distance in a chip where it meets the axis.
  // In the stacked input card the rows above the axis row carry the line edge to edge, so it reads as one line through the card.
  const stacked=canvas.dataset.axis==='hidden',inStack=canvas.dataset.axis!==undefined;
  const lineX=Math.round(x)+.5,axisY=rect.height-bounds.bottom;
  ctx.strokeStyle=theme.crosshair;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(lineX,inStack?0:bounds.top);ctx.lineTo(lineX,stacked?rect.height:axisY);ctx.stroke();
  const metres=typeof referenceDistance==='function'?hoverFraction*referenceDistance():NaN;
  if(!stacked&&Number.isFinite(metres)&&metres>0){
    const label=metres>=1000?`${(metres/1000).toFixed(2)} km`:`${Math.round(metres)} m`;
    ctx.font=canvasFont(10,500);const w=ctx.measureText(label).width+10,h=16;
    const left=Math.max(bounds.left,Math.min(rect.width-bounds.right-w,lineX-w/2)),top=axisY+3;
    ctx.fillStyle=theme.textStrong;ctx.beginPath();
    if(typeof ctx.roundRect==='function')ctx.roundRect(left,top,w,h,4);else ctx.rect(left,top,w,h);ctx.fill();
    ctx.fillStyle=lightThemeActive()?'#ffffff':'#121213';ctx.textAlign='center';ctx.fillText(label,left+w/2,top+11.5);ctx.textAlign='left';
  }
  for(const {lap,index}of visibleEntries){
    const entry=traceEntries.find(item=>item.index===index),stepped=['Brake application','Gear','DRS'].includes(name);
    const value=entry?renderedTraceValue(entry.domainPoints,hoverFraction,stepped):null;
    if(!Number.isFinite(value))continue;
    let y=bounds.top+(bounds.max-value)/(bounds.max-bounds.min||1)*(rect.height-bounds.top-bounds.bottom);
    if(name==='Brake application'){
      // Brake is drawn as one lane per lap: the dot sits in that lap's lane, filled when braking, hollow when not.
      const n=traceEntries.length,lane=traceEntries.indexOf(entry),gap=n>1?3:0,plotH=rect.height-bounds.top-bounds.bottom,laneH=(plotH-gap*(n-1))/n;
      y=bounds.top+lane*(laneH+gap)+laneH/2;
      ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(x,y,4,0,2*Math.PI);
      if(value>=50){ctx.fillStyle=getLapColor(lap);ctx.strokeStyle='#fff';ctx.fill();ctx.stroke();}else{ctx.fillStyle=lightThemeActive()?'#fff':'#121213';ctx.strokeStyle=getLapColor(lap);ctx.fill();ctx.stroke();}
      continue;
    }
    ctx.fillStyle=getLapColor(lap);ctx.strokeStyle='#fff';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(x,y,4,0,2*Math.PI);ctx.fill();ctx.stroke();
  }
}
function scheduleHover(callback) {
  if(hoverFrame)cancelAnimationFrame(hoverFrame);
  hoverFrame=requestAnimationFrame(()=>{hoverFrame=0;callback();});
}
function bindAllChartHover() {
  const canvases = document.querySelectorAll('canvas[data-chart]');
  const tooltip = $('#realTooltip');
  const telemetryCard = $('.telemetry-card');
  
  canvases.forEach(canvas => {
    canvas.addEventListener('pointermove', event => scheduleHover(() => {
      const e=event;
      if (!loaded.length) return;
      
      const rect = canvas.getBoundingClientRect();
      const printableWidth = rect.width - TRACE_PLOT_LEFT - TRACE_PLOT_RIGHT;
      const localFraction = Math.max(0, Math.min(1, (e.clientX - rect.left - TRACE_PLOT_LEFT) / printableWidth));
      const fraction = traceZoom.start + localFraction * (traceZoom.end - traceZoom.start);

      if (zoomDrag?.chart === canvas.dataset.chart) {
        zoomDrag.current = fraction;
        tooltip.style.display = 'none';
        drawRealChart(zoomDrag.chart);
        return;
      }
      
      hoverFraction = fraction;
      hoveredChartName = canvas.dataset.chart;
      
      // Repaint all charts and track map to show synchronized crosshair and ball tracker
      defs.forEach(def => drawChartHover(def[0]));
      drawMapHover();
      
      // Update floating tooltip content
      const field = chartField[hoveredChartName];
      const currentDef = defs.find(def => def[0] === hoveredChartName);
      const unit = currentDef ? currentDef[1] : '';
      
      const refSamples = telemetryCache.get(telemetryKey(loaded[0]));
      const maxDistance = refSamples?.length ? referenceDistance() : 5891;
      
      let hasReconstructedValue = false;
      let hasLowConfidenceValue = false;
      const sourceGapNotes=new Map();
      const noteSourceGap=(lap,series)=>{
        const gap=telemetrySourceGapAt(series,fraction);
        if(gap)sourceGapNotes.set(telemetryKey(lap),`${lap.code} L${lap.lap}: ${gap.interval.toFixed(3)} s`);
      };
      if(hoveredChartName==='Timing delta')noteSourceGap(loaded[0],refSamples);
      // One channel's reading for one lap, as shown in the tooltip.
      const readingFor = (chartName, lap, index, series) => {
        const field = chartField[chartName];
        const unit = (defs.find(def => def[0] === chartName) || [])[1] || '';
        let val = null;
        const targetDist = fraction * maxDistance;
        if (chartName === 'Timing delta' && !window.ApexTelemetryFrame?.partial() && !lap.real?.out_lap && !loaded[0]?.real?.out_lap) {
          val = index === 0 ? 0 : (typeof displayDeltaAt === 'function'
            ? displayDeltaAt(series, refSamples, fraction)
            : deltaAt(series, refSamples, targetDist));
        } else if (chartName === 'Timing delta') {
          val = null;
        } else if ((series?.alignmentMethod === 'live-distance' || chartName === 'Speed trace' || chartName === 'Throttle application')
            && typeof smoothedTelemetryValue === 'function') {
          val = typeof traceTelemetryValue === 'function'
            ? traceTelemetryValue(series, fraction, field)
            : smoothedTelemetryValue(series, fraction, field);
        } else {
          val = interpolate(series, targetDist, field);
        }
        // No reading on this channel here (the pedals' 104 placeholder): unknown, not the value interpolated across it.
        if ((chartName === 'Throttle application' || chartName === 'Speed trace') && typeof telemetryChannelGapRanges === 'function'
            && telemetryChannelGapRanges(series, field).some(range => fraction > range.start && fraction < range.end)) val = null;
        if (!Number.isFinite(val)) return '—';
        if (chartName === 'Timing delta') return `${val >= 0 ? '+' : ''}${val.toFixed(3)}s`;
        if (field === 'DRS') return val >= 0.5 ? 'open' : 'closed';
        if (chartName === 'Brake application') return val >= 50 ? 'on' : 'off';
        const reconstructed = typeof isReconstructedTelemetry === 'function' && isReconstructedTelemetry(series, fraction, field);
        if (reconstructed) hasReconstructedValue = true;
        if (telemetryEstimateInfo(series, fraction, field)?.confidence === 'low') hasLowConfidenceValue = true;
        // Speed and throttle are interpolated between whole-number samples: one decimal, not three.
        const precision = (chartName === 'Speed trace' || chartName === 'Throttle application') ? val.toFixed(1) : Math.round(val);
        return `${reconstructed ? '~' : ''}${precision}${unit ? ' ' + unit : ''}`;
      };
      const entries = visibleTraceLaps().map(({ lap, index }) => {
        const series = telemetryCache.get(telemetryKey(lap));
        if(['Speed trace','Throttle application','Timing delta'].includes(hoveredChartName))noteSourceGap(lap,series);
        return {lap, index, series};
      });
      // Every channel at once: one row per lap, one column per chart, whichever chart is hovered.
      const allChannels = window.hoverAllChannels !== false;
      let body;
      if (allChannels) {
        const channels = [...document.querySelectorAll('#charts canvas[data-chart]')].map(c => c.dataset.chart).filter(name => chartField[name] || name === 'Timing delta');
        const short = {'Speed trace': 'km/h', 'Timing delta': 'Δ', 'Throttle application': 'Thr %', 'Brake application': 'Brake', Gear: 'Gear', DRS: 'DRS', 'Engine speed': 'rpm'};
        const head = `<tr><th></th>${channels.map(name => `<th${name === hoveredChartName ? ' class="is-hovered"' : ''}>${short[name] || name}</th>`).join('')}</tr>`;
        const rows = entries.map(({lap, index, series}) => `<tr><th><span style="color: ${getLapColor(lap)}">●</span> ${lap.code} L${lap.lap}</th>${channels.map(name => `<td${name === hoveredChartName ? ' class="is-hovered"' : ''}>${readingFor(name, lap, index, series).replace(/ (km\/h|%|rpm)$/, '')}</td>`).join('')}</tr>`).join('');
        body = `<table class="hover-readout">${head}${rows}</table>`;
      } else {
        body = entries.map(({lap, index, series}) => `<span style="color: ${getLapColor(lap)}">●</span> ${lap.code} L${lap.lap} · <b>${readingFor(hoveredChartName, lap, index, series)}</b>`).join('<br>');
      }
      const lines = [body];
      
      const reconstructionNote = hasReconstructedValue
        ? `<br><small>~ ${hasLowConfidenceValue ? 'Low-confidence gap estimate' : 'Estimated repair'}</small>`
        : '';
      // Zoomed in on braking, the card says where each lap's nearest brake change can lie: between the last packet in the old
      // state and the first in the new one (about 15 m at the median), so a few metres between two laps is not over-read.
      const zoomedMetres = (traceZoom.end - traceZoom.start) * maxDistance;
      const brakeNotes = (hoveredChartName === 'Brake application' || hoveredChartName === 'Speed trace') && zoomedMetres <= 1500
        ? entries.map(({lap, series}) => { const t = brakeTransitionNear(series, fraction, maxDistance); return t ? `${escapeUI(lap.code)} ${t.kind} between ${Math.round(t.from)} and ${Math.round(t.to)} m (${Math.round(t.to - t.from)} m)` : null; }).filter(Boolean)
        : [];
      const brakeNote = brakeNotes.length ? `<br><small>Brake change · ${brakeNotes.join('; ')}</small>` : '';
      const sourceGapNote=sourceGapNotes.size?`<br><small>Source gap · ${[...sourceGapNotes.values()].map(escapeUI).join('; ')}<br>Curve inside the gap is interpolated.</small>`:'';
      // The distance is already on the x-axis cursor label, so the card carries only the readings.
      tooltip.innerHTML = `${lines.join('<br>')}${brakeNote}${sourceGapNote}${reconstructionNote}`;
      tooltip.classList.toggle('has-readout', allChannels);
      tooltip.style.display = 'block';
      
      if (document.body.classList.contains('trace-focus')) {
        const tipRect = tooltip.getBoundingClientRect();
        // Fixed positions are in layout px; pointer coordinates include the page zoom.
        const pageZoom = document.documentElement.getBoundingClientRect().width / document.documentElement.offsetWidth || 1;
        tooltip.style.left = `${Math.max(8, Math.min(e.clientX + 15, innerWidth - tipRect.width - 12)) / pageZoom}px`;
        tooltip.style.top = `${Math.max(8, Math.min(e.clientY + 15, innerHeight - tipRect.height - 12)) / pageZoom}px`;
        return;
      }
      const parentRect = telemetryCard.getBoundingClientRect();
      const zoom = parentRect.width / telemetryCard.offsetWidth || 1;
      const tipRect = tooltip.getBoundingClientRect();
      const right = Math.min(parentRect.right, window.innerWidth) - 12;
      const x = e.clientX + 15 + tipRect.width > right ? e.clientX - tipRect.width - 15 : e.clientX + 15;
      const xPos = Math.max(8, (x - parentRect.left) / zoom);
      const yPos = Math.max(8, (Math.min(e.clientY + 15, window.innerHeight - tipRect.height - 12) - parentRect.top) / zoom);
      tooltip.style.left = `${xPos}px`;
      tooltip.style.top = `${yPos}px`;
    }));
    
    canvas.addEventListener('mouseleave', () => {
      if(hoverFrame){cancelAnimationFrame(hoverFrame);hoverFrame=0;}
      if (zoomDrag?.chart === canvas.dataset.chart) return;
      hoverFraction = null;
      hoveredChartName = null;
      tooltip.style.display = 'none';
      defs.forEach(def => drawChartHover(def[0]));
      drawMapHover();
    });
  });
}

function bindTrackMapHover() {
  const canvas = $('#dominanceCanvas');
  const tooltip = $('#realTooltip');
  const telemetryCard = $('.telemetry-card');
  if (!canvas) return;

  canvas.addEventListener('pointermove', event => scheduleHover(() => {
    const e=event;
    const hoverEntries = visibleTraceLaps();
    if (!hoverEntries.length || !dominanceMapHitPoints.length) return;
    const spatial = typeof spatialReferenceTelemetry === 'function'
      ? spatialReferenceTelemetry()
      : null;
    const reference = spatial?.samples || telemetryCache.get(telemetryKey(loaded[0]));
    if (!reference?.length) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    let minDistanceSq = Infinity;
    let bestFraction = null;
    const totalDistance = referenceDistance();

    dominanceMapHitPoints.forEach(point => {
      const dSq = (point.x - mouseX) ** 2 + (point.y - mouseY) ** 2;
      if (dSq < minDistanceSq) {
        minDistanceSq = dSq;
        bestFraction = point.fraction;
      }
    });

    if (bestFraction !== null && minDistanceSq < 4000) {
      hoverFraction = bestFraction;
      hoveredChartName = 'Track map';

      defs.forEach(def => drawChartHover(def[0]));
      drawMapHover();

      if (tooltip && telemetryCard) {
        const distanceKM = (bestFraction * totalDistance) / 1000;
        const {start: segmentStart, end: segmentEnd} = miniSectorBounds(totalDistance, bestFraction);
        const segmentRows = hoverEntries.map(({ lap }) => {
          const series = telemetryCache.get(telemetryKey(lap));
          const speed = typeof smoothedTelemetryValue === 'function'
            ? (typeof traceTelemetryValue === 'function'
                ? traceTelemetryValue(series, bestFraction, 'Speed')
                : smoothedTelemetryValue(series, bestFraction, 'Speed'))
            : interpolate(series, bestFraction * totalDistance, 'Speed');
          const sectionTime = typeof performanceSectionDuration === 'function'
            ? performanceSectionDuration(series, segmentStart, segmentEnd)
            : null;
          return { lap, speed, sectionTime };
        });
        const comparable = segmentRows.length >= 2 && segmentRows.every(row => Number.isFinite(row.sectionTime) && row.sectionTime > 0);
        const bestTime = comparable ? Math.min(...segmentRows.map(row => row.sectionTime)) : null;
        const lines = segmentRows.map(({ lap, speed, sectionTime }) => {
          const speedDisplay = Number.isFinite(speed) ? `${speed.toFixed(1)} km/h` : '—';
          const timeDisplay = Number.isFinite(sectionTime) && sectionTime > 0
            ? `${sectionTime.toFixed(3)}s${bestTime == null ? ' · not compared' : Math.abs(sectionTime - bestTime) < .0005 ? ' · fastest' : ` +${(sectionTime - bestTime).toFixed(3)}s`}`
            : 'no section time';
          return `<span style="color: ${getLapColor(lap)}">●</span> ${lap.code} L${lap.lap} · <b>${speedDisplay}</b> · ${timeDisplay}`;
        });

        tooltip.innerHTML = `<b>Track map · ${distanceKM.toFixed(3)} km · ${((segmentEnd-segmentStart)*totalDistance).toFixed(1)} m section</b><br>${lines.join('<br>')}`;
        tooltip.style.display = 'block';

        const parentRect = telemetryCard.getBoundingClientRect();
        const zoom = parentRect.width / telemetryCard.offsetWidth || 1;
        const tipRect = tooltip.getBoundingClientRect();
        const right = Math.min(parentRect.right, window.innerWidth) - 12;
        const x = e.clientX + 15 + tipRect.width > right ? e.clientX - tipRect.width - 15 : e.clientX + 15;
        const xPos = Math.max(8, (x - parentRect.left) / zoom);
        const yPos = Math.max(8, (Math.min(e.clientY + 15, window.innerHeight - tipRect.height - 12) - parentRect.top) / zoom);
        tooltip.style.left = `${xPos}px`;
        tooltip.style.top = `${yPos}px`;
      }
    }
  }));

  canvas.addEventListener('mouseleave', () => {
    if(hoverFrame){cancelAnimationFrame(hoverFrame);hoverFrame=0;}
    if (hoveredChartName === 'Track map') {
      hoverFraction = null;
      hoveredChartName = null;
      if (tooltip) tooltip.style.display = 'none';
      defs.forEach(def => drawChartHover(def[0]));
      drawMapHover();
    }
  });
}

async function drawAll() {
  if (window.ApexTelemetryFrame) {
    paintReadyTelemetry();
    return;
  }
  const generation = ++drawGeneration;
  const requestedLaps = [...loaded];
  const failures = [];
  let outstanding = requestedLaps.length;
  const promises = requestedLaps.map(async lap => {
    const alreadyReady=telemetryCache.has(telemetryKey(lap));
    try {
      await fetchTelemetry(lap);
      if (!alreadyReady && outstanding > 1 && generation === drawGeneration) {
        paintReadyTelemetry();
      }
    } catch (err) {
      if (err.name !== 'AbortError') console.warn(err);
      failures.push({ lap, error: err });
    } finally {
      outstanding--;
    }
  });
  await Promise.all(promises);
  if (generation !== drawGeneration) return;
  if (failures.length) {
    loaded = loaded.filter(item => !failures.some(({ lap }) => item.code === lap.code && item.lap === lap.lap));
    const failed = failures.map(({ lap }) => `${lap.code} L${lap.lap}`).join(', ');
    notify(`Telemetry is unavailable for ${failed}.`);
    renderLoaded();
    renderSectors();
    renderTraceVisibilityControls();
    renderStints();
  }
  paintReadyTelemetry();
}

function paintReadyTelemetry() {
  // Always describe the current reference, not whichever request finished first.
  sessionSectorGuide = loaded[0]?.sectorGuide || null;
  if (typeof prepareTelemetryAlignment === 'function' && !window.ApexTelemetryFrame?.partial()) {
    prepareTelemetryAlignment();
  }
  const season = Number($('#year').value);
  const activeDefs = season >= 2026
    ? defs.filter(([name]) => name !== 'DRS')
    : defs;
  activeDefs.forEach(definition => drawRealChart(definition[0]));
  // The expanded view's track map widens with the number of laps beside it.
  $('#telemetryContent')?.style?.setProperty?.('--focus-laps', String(Math.max(1, loaded.length)));
  renderCornerAnalysis();
  renderMiniSectorMap();
  renderTelemetryReadout();
}

function updateTelemetryVisibility() {
  const card = $('#telemetryCard');
  if (!card) return;
  const empty = loaded.length === 0;
  // Clearing every lap from the expanded view leaves nothing to expand.
  if (empty && document.body?.classList?.contains('trace-focus')) setTraceFocus(false);
  const genericMap = empty && (selected.length > 0 || !!sessionEventName);
  card.classList.toggle('is-empty', empty);
  card.classList.toggle('has-generic-map', genericMap);
  const emptyState = $('#telemetryEmpty');
  if (emptyState) emptyState.hidden = !empty || genericMap;
}
document.addEventListener('click', event => { if (event.target.closest?.('#telemetryEmptyLoad')) $('#loadSession')?.click(); });

// The brake change nearest a lap position (within reach metres): the interval between the last packet in the old state and
// the first in the new one, where the real change happened somewhere. Unknown readings break the pair.
function brakeTransitionNear(series, fraction, total, reach = 60) {
  if (!series?.length || !(total > 0)) return null;
  const at = fraction * total;
  let best = null, previous = null;
  for (const point of series) {
    const state = point.Brake == null || !Number.isFinite(+point.Brake) ? null : +point.Brake >= 50;
    const metres = traceSampleFraction(series, point) * total;
    if (state === null) { previous = null; continue; }
    if (previous && previous.state !== state && metres > previous.metres) {
      const distance = at < previous.metres ? previous.metres - at : at > metres ? at - metres : 0;
      if (distance <= reach && (!best || distance < best.distance)) best = {distance, from: previous.metres, to: metres, kind: state ? 'on' : 'off'};
    }
    previous = {state, metres};
  }
  return best;
}

