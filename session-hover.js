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
  ctx.strokeStyle=theme.crosshair;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x,bounds.top);ctx.lineTo(x,rect.height-bounds.bottom);ctx.stroke();
  for(const {lap,index}of visibleEntries){
    const entry=traceEntries.find(item=>item.index===index),stepped=['Brake application','Gear','DRS'].includes(name);
    const value=entry?renderedTraceValue(entry.domainPoints,hoverFraction,stepped):null;
    if(!Number.isFinite(value))continue;
    const y=bounds.top+(bounds.max-value)/(bounds.max-bounds.min||1)*(rect.height-bounds.top-bounds.bottom);
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

      if (zoomDrag && canvas.dataset.chart === 'Speed trace') {
        zoomDrag.current = fraction;
        tooltip.style.display = 'none';
        drawRealChart('Speed trace');
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
      const maxDistance = refSamples && refSamples.length ? refSamples[refSamples.length - 1].Distance : 5891;
      const distanceKM = (fraction * maxDistance) / 1000;
      
      let hasReconstructedValue = false;
      let hasLowConfidenceValue = false;
      const lines = visibleTraceLaps().map(({ lap, index }) => {
        const series = telemetryCache.get(telemetryKey(lap));
        let val = null;
        const targetDist = fraction * maxDistance;
        if (hoveredChartName === 'Timing delta' && !lap.real?.out_lap && !loaded[0]?.real?.out_lap) {
          val = index === 0 ? 0 : (typeof displayDeltaAt === 'function'
            ? displayDeltaAt(series, refSamples, fraction)
            : deltaAt(series, refSamples, targetDist));
        } else if ((hoveredChartName === 'Speed trace' || hoveredChartName === 'Throttle application')
            && typeof smoothedTelemetryValue === 'function') {
          val = typeof traceTelemetryValue === 'function'
            ? traceTelemetryValue(series, fraction, field)
            : smoothedTelemetryValue(series, fraction, field);
        } else {
          val = interpolate(series, targetDist, field);
        }
        
        let display = '—';
        if (Number.isFinite(val)) {
          if (hoveredChartName === 'Timing delta') {
            display = `${val >= 0 ? '+' : ''}${val.toFixed(3)}s`;
          } else if (field === 'DRS') {
            display = val >= 0.5 ? 'OPEN' : 'CLOSED';
          } else if (hoveredChartName === 'Brake application') {
            display = val >= 50 ? 'ON' : 'OFF';
          } else {
            const reconstructed = typeof isReconstructedTelemetry === 'function'
              && isReconstructedTelemetry(series, fraction, field);
            if (reconstructed) hasReconstructedValue = true;
            if (telemetryEstimateInfo(series, fraction, field)?.confidence === 'low') hasLowConfidenceValue = true;
            const precision = (hoveredChartName === 'Speed trace'
              || hoveredChartName === 'Throttle application')
              ? val.toFixed(3)
              : Math.round(val);
            display = `${reconstructed ? '~' : ''}${precision} ${unit}`;
          }
        }
        return `<span style="color: ${getLapColor(lap)}">●</span> ${lap.code} L${lap.lap} · <b>${display}</b>`;
      });
      
      const reconstructionNote = hasReconstructedValue
        ? `<br><small>~ ${hasLowConfidenceValue ? 'LOW-CONFIDENCE GAP ESTIMATE' : 'ESTIMATED REPAIR'}</small>`
        : '';
      tooltip.innerHTML = `<b>${distanceKM.toFixed(3)} KM</b><br>${lines.join('<br>')}${reconstructionNote}`;
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
      if (zoomDrag && canvas.dataset.chart === 'Speed trace') return;
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
          const speedDisplay = Number.isFinite(speed) ? `${speed.toFixed(1)} KM/H` : '—';
          const timeDisplay = Number.isFinite(sectionTime) && sectionTime > 0
            ? `${sectionTime.toFixed(3)}s${bestTime == null ? ' · NOT COMPARED' : Math.abs(sectionTime - bestTime) < .0005 ? ' FASTEST' : ` +${(sectionTime - bestTime).toFixed(3)}s`}`
            : 'NO SECTION TIME';
          return `<span style="color: ${getLapColor(lap)}">●</span> ${lap.code} L${lap.lap} · <b>${speedDisplay}</b> · ${timeDisplay}`;
        });

        tooltip.innerHTML = `<b>TRACK MAP · ${distanceKM.toFixed(3)} KM · ${((segmentEnd-segmentStart)*totalDistance).toFixed(1)} M SECTION</b><br>${lines.join('<br>')}`;
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
  if (typeof prepareTelemetryAlignment === 'function') {
    prepareTelemetryAlignment();
  }
  const season = Number($('#year').value);
  const activeDefs = season >= 2026
    ? defs.filter(([name]) => name !== 'DRS')
    : defs;
  activeDefs.forEach(definition => drawRealChart(definition[0]));
  renderCornerAnalysis();
  renderMiniSectorMap();
  renderTelemetryReadout();
}

function updateTelemetryVisibility() {
  const card = $('#telemetryCard');
  if (!card) return;
  const empty = loaded.length === 0;
  const genericMap = empty && (selected.length > 0 || !!sessionEventName);
  card.classList.toggle('is-empty', empty);
  card.classList.toggle('has-generic-map', genericMap);
  const emptyState = $('#telemetryEmpty');
  if (emptyState) emptyState.hidden = !empty || genericMap;
}
