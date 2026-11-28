/* Isolate the shared Session Analysis chart state from the main page's loaded session. */
(() => {
  let sessionKey = '', traces = new Map();
  let partial = false;
  const card = $('#telemetryCard');
  const number = value => Number.isFinite(value) ? value : null;
  const frame = window.frameElement;
  if (!frame) return;

  function resize() {
    const expanded = document.body.classList.contains('trace-focus');
    frame.toggleAttribute('data-expanded', expanded);
    if (!expanded) {
      const height = Math.ceil(card.getBoundingClientRect().height) + 'px';
      if (frame.style.height !== height) frame.style.height = height;
    }
  }
  const observer = new ResizeObserver(() => requestAnimationFrame(resize));
  observer.observe(card);
  new MutationObserver(resize).observe(document.body, {attributes: true, attributeFilter: ['class']});
  window.addEventListener('pointerup', finishZoomDrag);
  window.addEventListener('resize', () => { if (loaded.length) paintReadyTelemetry(); });

  function update({key, year, mode, theme, title, event, distance, sectors, laps}) {
    const nextKey = key + ':' + mode + ':' + year;
    const newSession = nextKey !== sessionKey;
    const previous = loaded.map(telemetryKey).join('|');
    partial = mode === 'current';
    if (newSession) {
      if (document.body.classList.contains('trace-focus')) setTraceFocus(false);
      sessionKey = nextKey;
      hiddenTraceKeys.clear(); lapColorOverrides.clear(); traces.clear();
      traceZoom = {start: 0, end: 1}; timingDeltaZoom = 1; hoverFraction = null; estimateAlignmentCorrection = false;
    }
    document.documentElement.dataset.theme = theme === 'light' ? 'light' : 'dark';
    if (theme === 'black') document.documentElement.dataset.surface = 'black'; else delete document.documentElement.dataset.surface;
    sessionYear = Number(year) || 2026;
    sessionEventName = event || '';
    $('#year').value = String(sessionYear);
    $('#loadedSessionContext').textContent = title;
    const next = new Map();
    loaded = laps.filter(entry => /^[A-Z0-9]{2,4}$/.test(entry.code) && Number.isInteger(entry.lap)).map(entry => {
      const {code, lap, trace} = entry;
      const item = {code, lap, time: number(entry.seconds), cornerMarkers: trace?.corners || [], real: {
        s1: number(entry.sectors?.[0]?.seconds), s2: number(entry.sectors?.[1]?.seconds), s3: number(entry.sectors?.[2]?.seconds),
      }};
      const id = telemetryKey(item);
      if (!lapColorOverrides.has(id) && /^#[\da-f]{6}$/i.test(entry.colour || '')) lapColorOverrides.set(id, entry.colour);
      if (trace?.x?.length > 1) {
        const cached = traces.get(id);
        if (!partial && cached?.trace === trace) {
          next.set(id, cached);
          return cached.item;
        }
        const points = trace.x.flatMap((metres, i) => Number.isFinite(metres) && (!partial || metres >= 0) ? [{
          Distance: metres, ElapsedSeconds: number(trace.t?.[i]), Speed: number(trace.speed?.[i]), Throttle: window.ApexAnalysis.observedThrottle(trace.throttle?.[i]),
          Brake: window.ApexAnalysis.observedBrake(trace.brake?.[i]), RPM: number(trace.rpm?.[i]), nGear: number(trace.gear?.[i]),
          DRS: sessionYear < 2026 ? window.ApexAnalysis.observedDRS(trace.drs?.[i]) : null,
          X: number(trace.posX?.[i]), Y: number(trace.posY?.[i]),
        }] : []);
        const samples = partial ? points : normalizeTelemetry(points, item, trace.source || 'Live timing');
        setTelemetryMeta(samples, 'modeAvailable', points.some(point => point.DRS !== null));
        if (!partial) {
          item.sectorGuide = makeSectorGuide(item, points, item.cornerMarkers, true);
          setTelemetryMeta(samples, 'sectorGuide', item.sectorGuide);
        }
        if (partial && samples.length) {
          const length = distance || samples.at(-1).Distance || 1;
          setTelemetryMeta(samples, 'traceDistance', length);
          setTelemetryMeta(samples, 'alignmentSectors', (sectors || []).map(metres => metres / length));
          setTelemetryMeta(samples, 'alignmentMethod', 'live-distance');
          samples.forEach(point => { point.AlignedFraction = clampTelemetry(point.Distance / length); });
        }
        if (samples.length > 1) next.set(id, {trace, samples, item});
      }
      return item;
    });
    telemetryCache.clear();
    for (const [id, entry] of next) telemetryCache.set(id, entry.samples);
    traces = next;
    if (newSession || !$('#charts').firstChild) {
      renderCharts();
      if (partial) {
        $('#alignmentCorrectionToggle').disabled = true;
        $('#alignmentCorrectionToggle').closest('label').title = 'Estimated alignment requires completed laps.';
      }
    } else if (previous !== loaded.map(telemetryKey).join('|')) renderTraceVisibilityControls();
    paintReadyTelemetry();
    updateZoomReadout(); updateTimingDeltaZoomReadout();
    resize();
  }
  window.ApexTelemetryFrame = {update, partial: () => partial};
  window.dispatchEvent(new Event('apex-telemetry-ready'));
})();
