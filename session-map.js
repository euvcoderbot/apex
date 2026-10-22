/* Session analysis: track map and mini-sector dominance. */
function renderMiniSectorMap() {
  mapStaticLayer=null;
  const canvas = $('#dominanceCanvas');
  const empty = $('#dominanceEmpty');
  const legend = $('#dominanceLegend');
  const title = $('#dominanceTitle');
  if (!canvas || !empty || !legend || !title) return;
  if ($('#cornerAnalysis')?.hidden) return;
  if (!loaded.length) mapView = 'guide';
  const guideDetails=$('#circuitGuideDetails');
  // The guide's explanation lives in a popover behind an info button, so
  // switching Guide / Lap comparison never changes the section's height.
  const guideInfo=$('#circuitGuideInfo');
  if(guideDetails&&guideInfo){
    guideInfo.hidden=mapView!=='guide'||!sessionEventName;
    if(guideInfo.hidden)guideDetails.hidePopover?.();
    guideDetails.innerHTML=guideInfo.hidden?'':circuitGuideContent();
  }
  document.querySelectorAll('[data-map-view]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.mapView === mapView));
    button.disabled = button.dataset.mapView === 'comparison' && !loaded.length;
  });
  if (mapView === 'guide' || !loaded.length) {
    title.textContent = 'Circuit guide';
    dominanceMapHitPoints = [];
    clearDominanceMapCanvas(canvas);
    renderGenericCircuit(canvas, empty);
    return;
  }

  const mapEntries = visibleTraceLaps().filter(({lap})=>telemetryCache.get(telemetryKey(lap))?.length);
  const comparative = mapEntries.length >= 2;
  canvas.setAttribute('aria-label', comparative
    ? 'Track map showing the fastest loaded lap in each mini-sector'
    : 'Circuit map for the visible telemetry trace');
  title.innerHTML = !mapEntries.length
    ? 'Track map'
    : comparative
      ? 'Mini-sector dominance <small>25 M SEGMENTS</small>'
      : 'Track map <small>SINGLE TRACE</small>';
  if (!mapEntries.length) {
    clearDominanceMapCanvas(canvas);
    canvas.style.display = 'block';
    empty.style.display = 'grid';
    empty.textContent = 'Load a lap to generate the track map.';
    legend.innerHTML = '';
    dominanceMapHitPoints = [];
    if (selected.length) renderGenericCircuit(canvas, empty);
    return;
  }
  const spatial = typeof spatialReferenceTelemetry === 'function'
    ? spatialReferenceTelemetry()
    : null;
  const reference = spatial?.samples;
  const allSeries = mapEntries.map(({ lap }) => telemetryCache.get(telemetryKey(lap)));
  const trackSamples = reference?.filter(point => point.X != null && point.Y != null && Number.isFinite(+point.X) && Number.isFinite(+point.Y)) || [];
  if (!reference?.length || !allSeries.every(series => series?.length) || trackSamples.length < 2) {
    clearDominanceMapCanvas(canvas);
    canvas.style.display = 'block';
    empty.style.display = 'grid';
    empty.textContent = 'Track-position telemetry is unavailable for this comparison.';
    legend.innerHTML = '';
    dominanceMapHitPoints = [];
    return;
  }

  // The stylesheet hides the canvas until a comparison exists. Reveal it
  // before measuring: a hidden canvas reports a 0 × 0 drawing area.
  canvas.style.display = 'block';
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    empty.style.display = 'none';
    return;
  }
  // Render the vector map above display density so it stays sharp at Windows
  // fractional scaling, browser zoom and high-density mobile screens.
  const dpr = Math.min(4, Math.max(3, (window.devicePixelRatio || 1) * 1.5));
  const backingWidth = Math.round(rect.width * dpr);
  const backingHeight = Math.round(rect.height * dpr);
  if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
    canvas.width = backingWidth;
    canvas.height = backingHeight;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.lineJoin = 'round';
  ctx.clearRect(0, 0, rect.width, rect.height);
  const theme = canvasTheme();

  // OpenF1/FastF1 position axes are used north-up here. CircuitInfo.rotation is
  // a presentation rotation, not a compass bearing, so applying it made the
  // old compass rotate with the artwork. Build one gently regularised geometry
  // for the map, corner markers and hover hit-testing instead.
  const totalDistance = referenceDistance();
  const geometryKey = `${telemetryKey(loaded[0])}:${reference.length}:${rect.width.toFixed(2)}:${rect.height.toFixed(2)}:${totalDistance.toFixed(1)}`;
  let geometrySteps;
  let canvasGeometry;
  if (dominanceMapGeometryCache?.key === geometryKey && dominanceMapGeometryCache.reference === reference) {
    ({ geometrySteps, canvasGeometry } = dominanceMapGeometryCache);
  } else {
    geometrySteps = Math.max(1600, Math.min(4200, Math.ceil(totalDistance / 1.8)));
    const sourceDistance = +reference[reference.length - 1]?.Distance || totalDistance;
    const spatialControls = trackSamples.map(point => ({
      fraction: Math.max(0, Math.min(1, Number.isFinite(point.AlignedFraction)
        ? point.AlignedFraction
        : (+point.Distance || 0) / sourceDistance)),
      x: +point.X,
      y: +point.Y,
    }))
      .sort((a, b) => a.fraction - b.fraction)
      // OpenF1 may hold one location packet across many faster car-channel
      // samples. Treat the repeated coordinates as one geometry control;
      // otherwise the map becomes a staircase of long flats and sharp jumps.
      .filter((point, index, array) => index === 0 || (
        point.fraction - array[index - 1].fraction > 1e-6
        && Math.hypot(point.x - array[index - 1].x, point.y - array[index - 1].y) > 1
      ));
    const controlCount = spatialControls.length;
    const cyclicControl = index => {
      const wrapped = ((index % controlCount) + controlCount) % controlCount;
      const cycle = Math.floor(index / controlCount);
      return { ...spatialControls[wrapped], fraction: spatialControls[wrapped].fraction + cycle };
    };
    const hermiteCoordinate = (p0, p1, p2, p3, ratio, key) => {
      if (controlCount < 4) return p1[key] + (p2[key] - p1[key]) * ratio;
      const width = Math.max(1e-7, p2.fraction - p1.fraction);
      const tangent1 = (p2[key] - p0[key]) * width / Math.max(1e-7, p2.fraction - p0.fraction);
      const tangent2 = (p3[key] - p1[key]) * width / Math.max(1e-7, p3.fraction - p1.fraction);
      const t2 = ratio * ratio;
      const t3 = t2 * ratio;
      return (2 * t3 - 3 * t2 + 1) * p1[key]
        + (t3 - 2 * t2 + ratio) * tangent1
        + (-2 * t3 + 3 * t2) * p2[key]
        + (t3 - t2) * tangent2;
    };
    let spatialCursor = 0;
    const mapGeometry = Array.from({ length: geometrySteps }, (_, index) => {
      const fraction = index / geometrySteps;
      while (spatialCursor < controlCount && spatialControls[spatialCursor].fraction < fraction) {
        spatialCursor++;
      }
      const p0 = cyclicControl(spatialCursor - 2);
      const before = cyclicControl(spatialCursor - 1);
      const after = cyclicControl(spatialCursor);
      const p3 = cyclicControl(spatialCursor + 1);
      const ratio = Math.max(0, Math.min(1,
        (fraction - before.fraction) / (after.fraction - before.fraction || 1)
      ));
      return {
        fraction,
        x: hermiteCoordinate(p0, before, after, p3, ratio, 'x'),
        y: hermiteCoordinate(p0, before, after, p3, ratio, 'y'),
      };
    });

    const minX = Math.min(...mapGeometry.map(point => point.x));
    const maxX = Math.max(...mapGeometry.map(point => point.x));
    const minY = Math.min(...mapGeometry.map(point => point.y));
    const maxY = Math.max(...mapGeometry.map(point => point.y));
    const padding = 34;
    const scale = Math.min((rect.width - padding * 2) / (maxX - minX || 1), (rect.height - padding * 2) / (maxY - minY || 1));
    const offsetX = (rect.width - (maxX - minX) * scale) / 2;
    const offsetY = (rect.height - (maxY - minY) * scale) / 2;
    const toCanvas = (x, y) => ({
      x: offsetX + (x - minX) * scale,
      y: rect.height - offsetY - (y - minY) * scale,
    });
    canvasGeometry = mapGeometry.map(point => ({ ...point, ...toCanvas(point.x, point.y) }));
    dominanceMapGeometryCache = { key: geometryKey, reference, geometrySteps, canvasGeometry };
  }
  const pointAt = fraction => {
    const wrapped = Math.max(0, Math.min(1, fraction)) * canvasGeometry.length;
    const beforeIndex = Math.floor(wrapped) % canvasGeometry.length;
    const afterIndex = (beforeIndex + 1) % canvasGeometry.length;
    const ratio = wrapped - Math.floor(wrapped);
    const before = canvasGeometry[beforeIndex];
    const after = canvasGeometry[afterIndex];
    return {
      x: before.x + (after.x - before.x) * ratio,
      y: before.y + (after.y - before.y) * ratio,
    };
  };
  dominanceMapHitPoints = canvasGeometry
    .filter((_, index) => index % 2 === 0)
    .map(point => ({ x: point.x, y: point.y, fraction: point.fraction }));

  // Re-sample the circuit by distance instead of drawing the sparse raw X/Y
  // packets.  This keeps long-radius corners smooth without raster scaling.
  ctx.strokeStyle = theme.mapBase;
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.beginPath();
  let geometryStarted = false;
  for (let index = 0; index <= geometrySteps; index++) {
    const pos = pointAt(index / geometrySteps);
    if (!pos) continue;
    if (!geometryStarted) {
      ctx.moveTo(pos.x, pos.y);
      geometryStarted = true;
    } else ctx.lineTo(pos.x, pos.y);
  }
  ctx.stroke();

  // Mark section boundaries without obscuring the track's dominance colours.
  const markerCorners = resolveCornerMarkers(reference, totalDistance, spatial?.lap?.cornerMarkers);
  let highlightedCornerWindows = [];
  if (typeof adaptiveCornerZones === 'function') {
    highlightedCornerWindows = selectedCornerWindows(sessionPerformanceZones(adaptiveCornerZones(markerCorners), totalDistance));
  }

  // Paint the selected union behind the track, not over dominance colours.
  ctx.save();
  ctx.strokeStyle = theme.labelFill;
  ctx.globalAlpha = .65;
  ctx.lineWidth = 11;
  for (const window of highlightedCornerWindows) {
    ctx.beginPath();
    miniSectorGeometryPoints(canvasGeometry, window.start, window.end, pointAt).forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.stroke();
  }
  ctx.restore();

  let unavailableSegments = 0;
  if (comparative) {
    for (const {start, end, winner} of miniSectorDominanceSegments(allSeries, totalDistance)) {
      if (winner < 0) { unavailableSegments++; continue; }
      ctx.strokeStyle = getLapColor(mapEntries[winner].lap);
      ctx.lineWidth = 7;
      ctx.beginPath();
      miniSectorGeometryPoints(canvasGeometry, start, end, pointAt).forEach((point, index) => {
        if (index === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      });
      ctx.stroke();
    }
  }

  if (highlightedCornerWindows.length) {
    ctx.save();
    for (const fraction of highlightedCornerWindows.flatMap(window => [window.start, window.end])) {
      const center = pointAt(fraction);
      const before = pointAt(Math.max(0, fraction - 5 / totalDistance));
      const after = pointAt(Math.min(1, fraction + 5 / totalDistance));
      if (!center || !before || !after) continue;
      const dx = after.x - before.x, dy = after.y - before.y;
      const length = Math.hypot(dx, dy);
      if (length < .001) continue;
      const nx = -dy / length * 8, ny = dx / length * 8;
      ctx.beginPath();
      ctx.moveTo(center.x - nx, center.y - ny);
      ctx.lineTo(center.x + nx, center.y + ny);
      ctx.strokeStyle = document.documentElement.dataset.theme === 'light' ? '#1d1d1f' : '#f5f5f7';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.restore();
  }

  // Corner markers rendered ON TOP of mini-sector dominance lines
  if ($('#cornerToggle').checked) {
    ctx.font = canvasFont(12, 500);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const occupiedLabels = [];
    const leaders = [];
    markerCorners.forEach(corner => {
      const point = pointAt(corner.fraction);
      if (!point) return;
      const angle = Number(corner.angle);
      const displayAngle = Number.isFinite(angle) ? angle : NaN;
      const offsetX = Number.isFinite(displayAngle) ? Math.cos(displayAngle * Math.PI / 180) * 11 : 0;
      const offsetY = Number.isFinite(displayAngle) ? -Math.sin(displayAngle * Math.PI / 180) * 11 : -11;
      const label = cornerLabel(corner);
      const labelWidth = ctx.measureText(label).width + 8;
      let placement = null;
      // Search nearby positions, reserving the complete text box. Leader
      // lines preserve the turn location when a crowded label must move.
      for (const radius of [24, 36, 48, 64, 80, 100, 124, 152]) {
        for (let direction = 0; direction < 16; direction++) {
          const theta = Math.atan2(offsetY, offsetX) + direction * Math.PI / 8;
          const x = Math.max(labelWidth / 2 + 4, Math.min(rect.width - labelWidth / 2 - 4, point.x + Math.cos(theta) * radius));
          const y = Math.max(12, Math.min(rect.height - 12, point.y + Math.sin(theta) * radius));
          const box = {x: x - labelWidth / 2, y: y - 9, width: labelWidth, height: 18};
          if (trackIntersectsLabel(box, canvasGeometry)) continue;
          if (occupiedLabels.some(b => box.x < b.x + b.width + 3 && box.x + box.width + 3 > b.x && box.y < b.y + b.height + 3 && box.y + box.height + 3 > b.y)) continue;
          const connector = cornerLabelConnector(point, box, leaders, occupiedLabels);
          if (!connector) continue;
          placement = {x, y, box, ...connector};
          break;
        }
        if (placement) break;
      }
      if (!placement) return; // Never render overlapping text on tiny maps.
      occupiedLabels.push(placement.box);
      if (placement.line) {
      leaders.push(placement.line);
      ctx.beginPath();
      ctx.moveTo(placement.line.a.x, placement.line.a.y);
      ctx.lineTo(placement.line.b.x, placement.line.b.y);
      ctx.strokeStyle = theme.labelFill;
      ctx.globalAlpha = .35;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.globalAlpha = 1;
      }
      ctx.fillStyle = theme.labelFill;
      ctx.fillText(label, placement.x, placement.y);
    });
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
  }

  // Ball Tracker indicator when hovering (telemetry charts or track map)
  const staticMap=document.createElement('canvas');staticMap.width=canvas.width;staticMap.height=canvas.height;
  staticMap.getContext('2d').drawImage(canvas,0,0);
  mapStaticLayer={image:staticMap,canvas,rect,dpr,pointAt,color:getLapColor(mapEntries[0].lap)};
  if (hoverFraction !== null) {
    const hPoint = pointAt(hoverFraction);
    if (hPoint) {
      const refColor = getLapColor(mapEntries[0].lap);
      ctx.fillStyle = hexToRgba(refColor, 0.35);
      ctx.beginPath();
      ctx.arc(hPoint.x, hPoint.y, 10, 0, 2 * Math.PI);
      ctx.fill();
      
      ctx.fillStyle = lightThemeActive() ? '#161b22' : '#ffffff';
      ctx.beginPath();
      ctx.arc(hPoint.x, hPoint.y, 4.5, 0, 2 * Math.PI);
      ctx.fill();
      ctx.strokeStyle = refColor;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  // The compass is fixed in the conventional screen orientation and the map
  // remains north-up: N top, E right, S bottom, W left. WindDirection is
  // meteorological, so its arrow travels from the reported bearing.
  const referenceConditions = loaded[0]?.real?.conditions || {};
  const windDegrees = referenceConditions.wind_direction == null ? NaN : Number(referenceConditions.wind_direction);
  const windSpeed = referenceConditions.wind_speed == null ? NaN : Number(referenceConditions.wind_speed);
  let windText = '';
  if (Number.isFinite(windDegrees)) {
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const windLabel = directions[Math.round((((windDegrees % 360) + 360) % 360) / 45) % directions.length];
    windText = `<span class="map-wind">Wind from ${windLabel}${Number.isFinite(windSpeed) ? ` · ${windSpeed.toFixed(1)} m/s` : ''}</span>`;
  }

  empty.style.display = 'none';
  const legendIndexes = comparative ? mapEntries.map((_, index) => index) : [0];
  legend.innerHTML = `<span class="map-north" aria-label="North is up"><svg viewBox="0 0 16 20" width="12" height="16" aria-hidden="true"><path d="M8 1 14 18 8 14 2 18Z" fill="currentColor"/></svg>N</span>${windText}` + legendIndexes.map(index => {
    const lap = mapEntries[index]?.lap;
    if (!lap) return '';
    return `<span class="legend-item"><i class="legend-color" style="--team:${getLapColor(lap)}"></i>${lap.code} L${lap.lap}</span>`;
  }).join('') + (unavailableSegments ? `<span class="legend-item" title="Every selected lap needs a supported positive timing for a segment to be compared.">${unavailableSegments} segments unavailable · grey</span>` : '');
}

function drawMapHover() {
  if(!mapStaticLayer)return;
  const {canvas,image,dpr,pointAt,color}=mapStaticLayer,ctx=canvas.getContext('2d');
  ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0);ctx.setTransform(dpr,0,0,dpr,0,0);
  if(hoverFraction===null)return;
  const point=pointAt(hoverFraction);if(!point)return;
  ctx.fillStyle=hexToRgba(color,.35);ctx.beginPath();ctx.arc(point.x,point.y,10,0,2*Math.PI);ctx.fill();
  ctx.fillStyle=lightThemeActive()?'#161b22':'#fff';ctx.strokeStyle=color;ctx.lineWidth=2;ctx.beginPath();ctx.arc(point.x,point.y,4.5,0,2*Math.PI);ctx.fill();ctx.stroke();
}

function applyTheme(theme, persist = true) {
  const nextTheme = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = nextTheme;
  const button = $('#themeToggle');
  if (button) {
    const light = nextTheme === 'light';
    button.setAttribute('aria-pressed', String(light));
    button.setAttribute('aria-label', light ? 'Switch to dark mode' : 'Switch to light mode');
    const label = button.querySelector('span');
    if (label) label.textContent = light ? 'Dark mode' : 'Light mode';
  }
  if (persist) {
    try { localStorage.setItem('apex-theme', nextTheme); } catch (_) { /* storage can be disabled */ }
  }
  if (loaded.length) drawAll();
  else if (selected.length) renderMiniSectorMap();
}
