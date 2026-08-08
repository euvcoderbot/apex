// Physical lap alignment and quality-aware telemetry rendering.
//
// Alignment follows the circuit, not the shape of a driver's speed trace:
//   1. project position samples onto the reference lap when X/Y is trustworthy;
//   2. lock the result to official sector boundaries when sector times exist;
//   3. fall back to sector-normalized integrated distance when position is absent.
//
// Trace reconstruction is display-only. Raw samples remain the source for
// hover values and corner calculations; official sector/finish timing anchors
// are restored exactly after smoothing the displayed delta line.

const ALIGNMENT_SEARCH_WINDOW = 0.12;

function clampTelemetry(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function telemetryNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function hasTelemetryNumber(value) {
  return telemetryNumber(value) !== null;
}

function medianTelemetry(values) {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!finite.length) return null;
  const middle = Math.floor(finite.length / 2);
  return finite.length % 2 ? finite[middle] : (finite[middle - 1] + finite[middle]) / 2;
}

function setTelemetryMeta(samples, name, value) {
  Object.defineProperty(samples, name, {
    value,
    writable: true,
    configurable: true,
  });
}

function lapMetadata(lap) {
  return lap?.real || lap || {};
}

function referenceDistance() {
  const reference = loaded[0] && telemetryCache.get(telemetryKey(loaded[0]));
  return reference?.length ? (+reference[reference.length - 1].Distance || 1) : 1;
}

function rawFractionAt(samples, point) {
  const total = +samples?.[samples.length - 1]?.Distance || 1;
  return clampTelemetry((+point?.Distance || 0) / total);
}

function telemetryQuality(samples, source = 'Unknown') {
  const timeSteps = [];
  let repeatedSpeed = 0;
  let positionCount = 0;
  for (let index = 0; index < samples.length; index++) {
    const point = samples[index];
    if (hasTelemetryNumber(point.X) && hasTelemetryNumber(point.Y)) positionCount++;
    if (index > 0) {
      const dt = (+point.ElapsedSeconds || 0) - (+samples[index - 1].ElapsedSeconds || 0);
      if (dt > 0 && dt < 5) timeSteps.push(dt);
      if (hasTelemetryNumber(point.Speed) && hasTelemetryNumber(samples[index - 1].Speed)
        && +point.Speed === +samples[index - 1].Speed) repeatedSpeed++;
    }
  }
  return {
    source,
    samples: samples.length,
    medianInterval: medianTelemetry(timeSteps) || 0,
    repeatSpeedRatio: repeatedSpeed / Math.max(1, samples.length - 1),
    positionCoverage: positionCount / Math.max(1, samples.length),
  };
}

function normalizeTelemetry(samples, lap, source = 'Unknown') {
  if (!Array.isArray(samples) || !samples.length) return samples || [];

  const ordered = samples
    .filter(point => Number.isFinite(+point.ElapsedSeconds) && Number.isFinite(+point.Distance))
    .sort((a, b) => (+a.ElapsedSeconds || 0) - (+b.ElapsedSeconds || 0));
  if (ordered.length < 2) return ordered;

  const firstRawTime = +ordered[0].ElapsedSeconds || 0;
  const officialDuration = Number.isFinite(+lap?.time) && +lap.time > 0 ? +lap.time : null;
  const trimmed = officialDuration
    ? ordered.filter(point => {
        const elapsed = (+point.ElapsedSeconds || 0) - firstRawTime;
        return elapsed >= -0.35 && elapsed <= officialDuration + 0.45;
      })
    : ordered;
  const usable = trimmed.length >= 2 ? trimmed : ordered;
  const firstDistance = +usable[0].Distance || 0;
  const firstTime = +usable[0].ElapsedSeconds || 0;
  let previousDistance = 0;
  let previousTime = 0;

  const normalized = usable.map((point, index) => {
    const distance = Math.max(previousDistance, (+point.Distance || 0) - firstDistance);
    const elapsed = Math.max(previousTime, (+point.ElapsedSeconds || 0) - firstTime);
    previousDistance = distance;
    previousTime = elapsed;
    return {
      ...point,
      Distance: distance,
      ElapsedSeconds: elapsed,
      Speed: telemetryNumber(point.Speed),
      Throttle: telemetryNumber(point.Throttle),
      RPM: telemetryNumber(point.RPM),
      nGear: telemetryNumber(point.nGear),
      DRS: point.DRS,
      X: telemetryNumber(point.X),
      Y: telemetryNumber(point.Y),
      SampleIndex: index,
    };
  });

  const rawDuration = +normalized[normalized.length - 1].ElapsedSeconds || 0;
  setTelemetryMeta(normalized, 'lapDuration', officialDuration || rawDuration);
  setTelemetryMeta(normalized, 'rawDuration', rawDuration);
  setTelemetryMeta(normalized, 'lapMeta', lapMetadata(lap));
  setTelemetryMeta(normalized, 'source', source);
  setTelemetryMeta(normalized, 'quality', telemetryQuality(normalized, source));
  setTelemetryMeta(normalized, 'alignmentMethod', 'distance');
  setTelemetryMeta(normalized, 'speedModel', null);
  setTelemetryMeta(normalized, 'throttleModel', null);
  return normalized;
}

async function fetchTelemetry(lap) {
  const key = telemetryKey(lap);
  if (telemetryCache.has(key)) return telemetryCache.get(key);
  const query = currentQuery();
  query.set('driver', lap.code);
  query.set('lap', lap.lap);
  query.set('alignment', '3');
  const response = await fetch(`/api/telemetry?${query}`, { cache: 'no-store' });
  const payload = await readApiResponse(response);
  if (!response.ok) throw new Error(payload.detail || 'Telemetry unavailable for this lap');

  const samples = normalizeTelemetry(payload.samples || [], lap, payload.source || 'Unknown');
  lap.cornerMarkers = Array.isArray(payload.corners) ? payload.corners : [];
  const season = Number($('#year').value);
  const rawModeValues = samples.map(point => Number(point.DRS)).filter(Number.isFinite);
  const hasRawMode = rawModeValues.some(value => value > 0);
  setTelemetryMeta(samples, 'modeAvailable', hasRawMode || season < 2026);

  samples.forEach(point => {
    const speed = +point.Speed || 0;
    const throttle = +point.Throttle || 0;
    const brake = point.Brake === true ? 100 : (+point.Brake || 0);
    const nGear = +point.nGear || 0;
    const rawDrs = Number(point.DRS);
    if (season < 2026) {
      point.DRS = hasRawMode
        ? (([10, 12, 14, 1].includes(rawDrs) || rawDrs >= 10) ? 1 : 0)
        : ((speed >= 250 && throttle >= 95 && brake <= 5) ? 1 : 0);
    } else {
      point.DRS = hasRawMode
        ? (rawDrs > 0 ? 1 : 0)
        : ((speed >= 250 && throttle >= 95 && brake <= 5 && nGear >= 6) ? 1 : 0);
    }
    point.Brake = brake;
  });

  telemetryCache.set(key, samples);
  return samples;
}

function fractionAtElapsed(samples, elapsed) {
  if (!samples?.length || !Number.isFinite(elapsed)) return null;
  if (elapsed <= 0) return 0;
  const total = +samples[samples.length - 1].Distance || 1;
  if (elapsed >= (+samples[samples.length - 1].ElapsedSeconds || 0)) return 1;
  let low = 1;
  let high = samples.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((+samples[middle].ElapsedSeconds || 0) < elapsed) low = middle + 1;
    else high = middle;
  }
  const after = samples[low];
  const before = samples[low - 1];
  const ratio = (elapsed - before.ElapsedSeconds) / (after.ElapsedSeconds - before.ElapsedSeconds || 1);
  return clampTelemetry((before.Distance + (after.Distance - before.Distance) * ratio) / total);
}

function sectorFractions(samples, lap) {
  const meta = lapMetadata(lap);
  const s1 = Number(meta.s1);
  const s2 = Number(meta.s2);
  const result = [];
  if (Number.isFinite(s1) && s1 > 0) result.push(fractionAtElapsed(samples, s1));
  if (Number.isFinite(s1) && Number.isFinite(s2) && s1 > 0 && s2 > 0) {
    result.push(fractionAtElapsed(samples, s1 + s2));
  }
  return result.filter(value => Number.isFinite(value) && value > 0 && value < 1);
}

function alignedSectorFractions(samples, lap) {
  return Array.isArray(samples?.alignmentSectors) && samples.alignmentSectors.length
    ? samples.alignmentSectors
    : sectorFractions(samples, lap);
}

function spatialReferenceTelemetry() {
  return loaded
    .map(lap => ({ lap, samples: telemetryCache.get(telemetryKey(lap)) }))
    .filter(item => item.samples?.length)
    .sort((left, right) =>
      (right.samples.quality?.positionCoverage || 0)
        - (left.samples.quality?.positionCoverage || 0))[0] || null;
}

function referencePositionPath(reference) {
  const total = +reference?.[reference.length - 1]?.Distance || 0;
  const positioned = reference?.filter(point => hasTelemetryNumber(point.X) && hasTelemetryNumber(point.Y)) || [];
  if (!total || positioned.length < 12) return null;
  const xs = positioned.map(point => +point.X);
  const ys = positioned.map(point => +point.Y);
  const diagonal = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  if (!diagonal) return null;
  const minimumStep = diagonal * 0.00035;
  const points = [];
  positioned.forEach(point => {
    const candidate = { x: +point.X, y: +point.Y, fraction: rawFractionAt(reference, point) };
    const previous = points[points.length - 1];
    if (!previous || Math.hypot(candidate.x - previous.x, candidate.y - previous.y) >= minimumStep) {
      points.push(candidate);
    }
  });
  if (points.length < 12) return null;
  const segments = points.slice(0, -1).map((point, index) => ({
    a: point,
    b: points[index + 1],
    middle: (point.fraction + points[index + 1].fraction) / 2,
  }));
  return { points, segments, diagonal };
}

function projectPosition(path, x, y, expectedFraction) {
  let best = null;
  let bestDistanceSq = Infinity;
  const search = path.segments.filter(segment => Math.abs(segment.middle - expectedFraction) <= ALIGNMENT_SEARCH_WINDOW);
  const candidates = search.length ? search : path.segments;
  candidates.forEach(segment => {
    const dx = segment.b.x - segment.a.x;
    const dy = segment.b.y - segment.a.y;
    const lengthSq = dx * dx + dy * dy || 1;
    const amount = clampTelemetry(((x - segment.a.x) * dx + (y - segment.a.y) * dy) / lengthSq);
    const projectedX = segment.a.x + dx * amount;
    const projectedY = segment.a.y + dy * amount;
    const distanceSq = (x - projectedX) ** 2 + (y - projectedY) ** 2;
    if (distanceSq < bestDistanceSq) {
      bestDistanceSq = distanceSq;
      best = {
        fraction: segment.a.fraction + (segment.b.fraction - segment.a.fraction) * amount,
        error: Math.sqrt(distanceSq) / path.diagonal,
      };
    }
  });
  return best;
}

function interpolateControls(controls, input, inputField = 'raw', outputField = 'mapped') {
  if (input <= controls[0][inputField]) return controls[0][outputField];
  if (input >= controls[controls.length - 1][inputField]) return controls[controls.length - 1][outputField];
  let low = 1;
  let high = controls.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (controls[middle][inputField] < input) low = middle + 1;
    else high = middle;
  }
  const after = controls[low];
  const before = controls[low - 1];
  const ratio = (input - before[inputField]) / (after[inputField] - before[inputField] || 1);
  return before[outputField] + (after[outputField] - before[outputField]) * ratio;
}

function regularizedPositionControls(controls) {
  if (!controls?.length) return null;
  const gridSize = 100;
  const window = 0.025;
  const minimumSlope = 0.7;
  const maximumSlope = 1.3;
  const source = controls.map(control => ({
    ...control,
    correction: control.mapped - control.raw,
  }));
  source.unshift({ raw: 0, mapped: 0, correction: 0, error: 0 });
  source.push({ raw: 1, mapped: 1, correction: 0, error: 0 });

  const nodes = Array.from({ length: gridSize + 1 }, (_, index) => {
    const raw = index / gridSize;
    const local = source
      .filter(control => Math.abs(control.raw - raw) <= window)
      .map(control => control.correction);
    const correction = local.length
      ? medianTelemetry(local)
      : interpolateControls(source, raw, 'raw', 'correction');
    return { raw, mapped: clampTelemetry(raw + correction) };
  });
  nodes[0].mapped = 0;
  nodes[gridSize].mapped = 1;

  // Smooth the GPS correction, rather than the telemetry itself. A roughly
  // 100 m support window removes repeated/jumping OpenF1 location samples but
  // still follows the gradual distance difference caused by racing lines.
  for (let pass = 0; pass < 3; pass++) {
    const correction = nodes.map(node => node.mapped - node.raw);
    for (let index = 1; index < gridSize; index++) {
      const filtered = (correction[index - 1] + 2 * correction[index]
        + correction[index + 1]) / 4;
      nodes[index].mapped = clampTelemetry(nodes[index].raw + filtered);
    }
  }

  // Limit local distance compression/expansion. GPS remains responsible for
  // the broad physical alignment, while speed-integrated distance preserves
  // the shape and spacing of acceleration and braking samples.
  for (let pass = 0; pass < 6; pass++) {
    nodes[0].mapped = 0;
    for (let index = 1; index <= gridSize; index++) {
      const rawStep = nodes[index].raw - nodes[index - 1].raw;
      nodes[index].mapped = clampTelemetry(
        nodes[index].mapped,
        nodes[index - 1].mapped + minimumSlope * rawStep,
        nodes[index - 1].mapped + maximumSlope * rawStep,
      );
    }
    nodes[gridSize].mapped = 1;
    for (let index = gridSize - 1; index >= 0; index--) {
      const rawStep = nodes[index + 1].raw - nodes[index].raw;
      nodes[index].mapped = clampTelemetry(
        nodes[index].mapped,
        nodes[index + 1].mapped - maximumSlope * rawStep,
        nodes[index + 1].mapped - minimumSlope * rawStep,
      );
    }
  }
  nodes[0].mapped = 0;
  nodes[gridSize].mapped = 1;
  return nodes;
}

function positionAlignment(reference, samples) {
  const path = referencePositionPath(reference);
  if (!path || samples.quality?.positionCoverage < 0.55) return null;
  const total = +samples[samples.length - 1].Distance || 0;
  if (!total) return null;
  const controls = [];
  let lastCoordinate = null;
  const minimumStep = path.diagonal * 0.0005;
  samples.forEach(point => {
    if (!hasTelemetryNumber(point.X) || !hasTelemetryNumber(point.Y)) return;
    if (lastCoordinate && Math.hypot(+point.X - lastCoordinate.x, +point.Y - lastCoordinate.y) < minimumStep) return;
    const raw = clampTelemetry((+point.Distance || 0) / total);
    const projected = projectPosition(path, +point.X, +point.Y, raw);
    lastCoordinate = { x: +point.X, y: +point.Y };
    if (projected && projected.error <= 0.075) {
      controls.push({ raw, mapped: projected.fraction, error: projected.error });
    }
  });
  if (controls.length < 12) return null;
  controls.sort((a, b) => a.raw - b.raw);
  const unique = controls.filter((control, index) => index === 0 || control.raw - controls[index - 1].raw > 0.0001);
  const errors = unique.map(control => control.error);
  if (unique.length < 12 || (medianTelemetry(errors) || 1) > 0.035) return null;
  const regularized = regularizedPositionControls(unique);
  if (!regularized) return null;
  return samples.map(point => interpolateControls(regularized, rawFractionAt(samples, point)));
}

function remapWithSectorAnchors(samples, fractions, lap, targetSectors) {
  const sourceSectors = sectorFractions(samples, lap);
  if (sourceSectors.length !== targetSectors.length || !sourceSectors.length) {
    return { fractions, used: false };
  }
  const controls = [{ current: 0, target: 0 }];
  sourceSectors.forEach((sourceFraction, index) => {
    const current = interpolateControls(
      samples.map((point, pointIndex) => ({ raw: rawFractionAt(samples, point), mapped: fractions[pointIndex] })),
      sourceFraction
    );
    const target = targetSectors[index];
    if (Number.isFinite(current) && Number.isFinite(target)) controls.push({ current, target });
  });
  controls.push({ current: 1, target: 1 });
  controls.sort((a, b) => a.current - b.current);
  if (controls.some((control, index) => index > 0 && control.current <= controls[index - 1].current)) {
    return { fractions, used: false };
  }
  return {
    fractions: fractions.map(fraction => interpolateControls(controls, fraction, 'current', 'target')),
    used: true,
  };
}

function setAlignedFractions(samples, fractions, method) {
  let previous = 0;
  samples.forEach((point, index) => {
    const aligned = index === samples.length - 1
      ? 1
      : Math.max(previous, clampTelemetry(fractions[index] ?? rawFractionAt(samples, point)));
    point.AlignedFraction = aligned;
    previous = aligned;
  });
  if (samples.length) samples[0].AlignedFraction = 0;
  setTelemetryMeta(samples, 'alignmentMethod', method);
  setTelemetryMeta(samples, 'speedModel', null);
  setTelemetryMeta(samples, 'throttleModel', null);
  setTelemetryMeta(samples, 'deltaModel', null);
  setTelemetryMeta(samples, 'performanceTimeModel', null);
}

function alignedValue(samples, fraction, field) {
  if (!samples?.length) return null;
  const target = clampTelemetry(fraction);
  if (target <= 0) return samples[0][field];
  if (target >= 1) return samples[samples.length - 1][field];
  let low = 1;
  let high = samples.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    const current = Number.isFinite(samples[middle].AlignedFraction)
      ? samples[middle].AlignedFraction
      : rawFractionAt(samples, samples[middle]);
    if (current < target) low = middle + 1;
    else high = middle;
  }
  let beforeIndex = low - 1;
  let afterIndex = low;
  while (beforeIndex >= 0 && !hasTelemetryNumber(samples[beforeIndex][field])) beforeIndex--;
  while (afterIndex < samples.length && !hasTelemetryNumber(samples[afterIndex][field])) afterIndex++;
  if (beforeIndex < 0 && afterIndex >= samples.length) return null;
  if (beforeIndex < 0) return samples[afterIndex][field];
  if (afterIndex >= samples.length) return samples[beforeIndex][field];
  const before = samples[beforeIndex];
  const after = samples[afterIndex];
  const beforeFraction = Number.isFinite(before.AlignedFraction) ? before.AlignedFraction : rawFractionAt(samples, before);
  const afterFraction = Number.isFinite(after.AlignedFraction) ? after.AlignedFraction : rawFractionAt(samples, after);
  const ratio = clampTelemetry((target - beforeFraction) / (afterFraction - beforeFraction || 1));
  if (field === 'nGear' || field === 'DRS' || field === 'Brake') {
    return ratio < 0.5 ? before[field] : after[field];
  }
  return (+before[field]) + ((+after[field]) - (+before[field])) * ratio;
}

function interpolate(samples, targetDistance, field) {
  const fraction = clampTelemetry(targetDistance / referenceDistance());
  return alignedValue(samples, fraction, field);
}

function buildTimeCalibration(samples, lap, referenceSectors) {
  const meta = lapMetadata(lap);
  const officialDuration = Number(lap?.time ?? meta.time ?? samples.lapDuration);
  const controls = [{ fraction: 0, raw: 0, official: 0 }];
  const officialSectorEnds = [];
  if (Number.isFinite(+meta.s1) && +meta.s1 > 0) officialSectorEnds.push(+meta.s1);
  if (Number.isFinite(+meta.s1) && Number.isFinite(+meta.s2) && +meta.s1 > 0 && +meta.s2 > 0) {
    officialSectorEnds.push(+meta.s1 + +meta.s2);
  }
  referenceSectors.forEach((fraction, index) => {
    const official = officialSectorEnds[index];
    const raw = alignedValue(samples, fraction, 'ElapsedSeconds');
    if (Number.isFinite(raw) && Number.isFinite(official)) controls.push({ fraction, raw, official });
  });
  const finalRaw = alignedValue(samples, 1, 'ElapsedSeconds');
  controls.push({
    fraction: 1,
    raw: Number.isFinite(finalRaw) ? finalRaw : samples.rawDuration,
    official: Number.isFinite(officialDuration) && officialDuration > 0 ? officialDuration : samples.rawDuration,
  });
  setTelemetryMeta(samples, 'timeCalibration', controls.filter((control, index) => {
    if (index === 0) return true;
    const previous = controls[index - 1];
    return control.fraction > previous.fraction && control.raw > previous.raw && control.official > previous.official;
  }));
}

function repairDisplaySpeeds(points) {
  const repaired = points.map(point => ({ ...point }));
  for (let index = 1; index < repaired.length - 1; index++) {
    const previous = repaired[index - 1].y;
    const current = repaired[index].y;
    const next = repaired[index + 1].y;
    const neighbourMean = (previous + next) / 2;
    if (Math.abs(current - neighbourMean) > 42 && Math.abs(previous - next) < 18) {
      repaired[index].y = neighbourMean;
    }
  }
  return repaired;
}

function reconstructLargeGaps(points, samples, field) {
  if (points.length < 2) return { points, gaps: [] };
  const typicalInterval = samples.quality?.medianInterval || 0.24;
  const threshold = Math.max(0.55, typicalInterval * 2.4);
  const reconstructed = [];
  const gaps = [];
  for (let index = 0; index < points.length - 1; index++) {
    const before = points[index];
    const after = points[index + 1];
    reconstructed.push(before);
    const interval = after.time - before.time;
    if (!(interval > threshold) || !(after.x > before.x)) continue;
    const pieces = Math.max(2, Math.ceil(interval / typicalInterval));
    gaps.push({ start: before.x, end: after.x, interval });
    for (let piece = 1; piece < pieces; piece++) {
      const ratio = piece / pieces;
      let value;
      if (field === 'Speed') {
        // Constant longitudinal acceleration makes v² linear with distance.
        // It is a conservative physical reconstruction for a missing braking
        // or acceleration interval and cannot introduce an artificial wave.
        const energy = before.y ** 2 + (after.y ** 2 - before.y ** 2) * ratio;
        value = Math.sqrt(Math.max(0, energy));
      } else {
        // Throttle is an analogue driver input. A linear transition is the
        // least-assumptive estimate when intermediate samples are absent.
        value = before.y + (after.y - before.y) * ratio;
      }
      reconstructed.push({
        x: before.x + (after.x - before.x) * ratio,
        y: value,
        time: before.time + interval * ratio,
        reconstructed: true,
      });
    }
  }
  reconstructed.push(points[points.length - 1]);
  return { points: reconstructed, gaps };
}

function resampleSpeedUniformly(points) {
  const source = points
    .sort((a, b) => a.x - b.x)
    .filter((point, index, array) => index === 0 || point.x - array[index - 1].x > 1e-5);
  if (source.length < 3) return source;
  const gridSize = Math.max(360, Math.min(1200, Math.ceil(referenceDistance() / 5)));
  const result = [];
  let cursor = 1;
  for (let index = 0; index <= gridSize; index++) {
    const x = index / gridSize;
    while (cursor < source.length - 1 && source[cursor].x < x) cursor++;
    const before = source[Math.max(0, cursor - 1)];
    const after = source[Math.min(source.length - 1, cursor)];
    const ratio = clampTelemetry((x - before.x) / (after.x - before.x || 1));
    const energy = before.y ** 2 + (after.y ** 2 - before.y ** 2) * ratio;
    result.push({
      x,
      y: Math.sqrt(Math.max(0, energy)),
      time: before.time + (after.time - before.time) * ratio,
      reconstructed: before.reconstructed || after.reconstructed,
    });
  }
  return result;
}

// Enhanced mode removes packet/sample-and-hold ripple without moving the real
// braking and corner landmarks.  A single zero-phase pass is blended strongly
// only through monotonic acceleration/deceleration.  Local extrema and their
// neighbours are effectively pinned to the source samples, so a peak or trough
// cannot drift along the distance axis or be noticeably flattened.
function smoothEnhancedSpeed(points, quality = {}) {
  if (points.length < 9) return points;
  const heldChannel = (quality?.repeatSpeedRatio || 0) >= 0.35;
  const radius = heldChannel ? 5 : 4;
  const sigma = heldChannel ? 2.35 : 1.9;
  const source = points.map(point => point.y);
  const extremaDistance = new Array(source.length).fill(Infinity);

  // Mark genuine changes of direction and protect two surrounding samples.
  // This keeps both the location and magnitude of braking minima and speed
  // maxima while still allowing straights and braking ramps to be cleaned up.
  for (let index = 1; index < source.length - 1; index++) {
    const left = source[index] - source[index - 1];
    const right = source[index + 1] - source[index];
    if (left === 0 || right === 0 || Math.sign(left) !== Math.sign(right)) {
      for (let offset = -2; offset <= 2; offset++) {
        const protectedIndex = index + offset;
        if (protectedIndex >= 0 && protectedIndex < source.length) {
          extremaDistance[protectedIndex] = Math.min(extremaDistance[protectedIndex], Math.abs(offset));
        }
      }
    }
  }

  const values = source.map((value, index) => {
    if (index < radius || index >= source.length - radius) return value;
    let weighted = 0;
    let weightTotal = 0;
    let localMin = Infinity;
    let localMax = -Infinity;
    for (let offset = -radius; offset <= radius; offset++) {
      const sample = source[index + offset];
      const weight = Math.exp(-(offset * offset) / (2 * sigma * sigma));
      weighted += sample * weight;
      weightTotal += weight;
      localMin = Math.min(localMin, sample);
      localMax = Math.max(localMax, sample);
    }

    const filtered = weighted / (weightTotal || 1);
    const leftSlope = value - source[index - 1];
    const rightSlope = source[index + 1] - value;
    const monotonic = leftSlope !== 0 && rightSlope !== 0
      && Math.sign(leftSlope) === Math.sign(rightSlope);
    const curvature = Math.abs(rightSlope - leftSlope);
    let blend = monotonic ? (heldChannel ? 0.7 : 0.56) : 0.22;
    if (extremaDistance[index] === 0) blend = 0.02;
    else if (extremaDistance[index] === 1) blend = 0.08;
    else if (extremaDistance[index] === 2) blend = 0.16;
    if (curvature > 4) blend *= 0.45;
    else if (curvature > 2) blend *= 0.7;
    const mixed = value + (filtered - value) * blend;
    return Math.max(localMin, Math.min(localMax, mixed));
  });

  return points.map((point, index) => ({ ...point, y: values[index] }));
}

function finishShapePreservingModel(points, gaps = []) {
  points = points
    .sort((a, b) => a.x - b.x)
    .filter((point, index, array) => index === 0 || point.x - array[index - 1].x > 1e-5);
  if (points.length < 3) return null;
  const intervals = [];
  const slopes = [];
  for (let index = 0; index < points.length - 1; index++) {
    const width = points[index + 1].x - points[index].x;
    intervals.push(width);
    slopes.push((points[index + 1].y - points[index].y) / width);
  }
  const tangents = new Array(points.length);
  tangents[0] = slopes[0];
  tangents[tangents.length - 1] = slopes[slopes.length - 1];
  for (let index = 1; index < points.length - 1; index++) {
    if (slopes[index - 1] === 0 || slopes[index] === 0
        || Math.sign(slopes[index - 1]) !== Math.sign(slopes[index])) {
      tangents[index] = 0;
    } else {
      const leftWeight = 2 * intervals[index] + intervals[index - 1];
      const rightWeight = intervals[index] + 2 * intervals[index - 1];
      tangents[index] = (leftWeight + rightWeight)
        / (leftWeight / slopes[index - 1] + rightWeight / slopes[index]);
    }
  }
  return { points, intervals, tangents, gaps };
}

function buildSpeedModel(samples) {
  let points = samples
    .map(point => ({
      x: Number.isFinite(point.AlignedFraction) ? point.AlignedFraction : rawFractionAt(samples, point),
      y: telemetryNumber(point.Speed),
      time: telemetryNumber(point.ElapsedSeconds),
    }))
    .filter(point => Number.isFinite(point.x) && point.y !== null && point.time !== null);
  if (points.length < 3) return null;
  points = repairDisplaySpeeds(points);
  let gaps = [];

  // Restore missing source intervals before filtering. The adaptive smoother
  // below operates on the common grid directly; a second polynomial pass here
  // used to shift and flatten genuine peaks and troughs.
  if ((samples.quality?.repeatSpeedRatio || 0) < 0.35 && points.length >= 7) {
    const reconstruction = reconstructLargeGaps(points, samples, 'Speed');
    points = resampleSpeedUniformly(reconstruction.points);
    gaps = reconstruction.gaps;
  }

  // OpenF1 often publishes speed as a sample-and-hold channel. Collapse each
  // held run to its centre before fitting a shape-preserving curve.
  if ((samples.quality?.repeatSpeedRatio || 0) >= 0.35) {
    const runs = [];
    let run = [points[0]];
    for (let index = 1; index < points.length; index++) {
      if (Math.abs(points[index].y - run[run.length - 1].y) <= 0.5) run.push(points[index]);
      else {
        runs.push(run);
        run = [points[index]];
      }
    }
    runs.push(run);
    points = runs.map(group => ({
      x: group.reduce((sum, point) => sum + point.x, 0) / group.length,
      y: group.reduce((sum, point) => sum + point.y, 0) / group.length,
      time: group.reduce((sum, point) => sum + point.time, 0) / group.length,
    }));
    points.unshift({ x: 0, y: +samples[0].Speed });
    points.push({ x: 1, y: +samples[samples.length - 1].Speed });
  }

  // A common final grid gives every source the same enhanced-mode treatment.
  // This also makes the visual difference from accurate mode deliberate and
  // predictable instead of depending on which provider supplied the lap.
  points = resampleSpeedUniformly(points);
  points = smoothEnhancedSpeed(points, samples.quality);
  return finishShapePreservingModel(points, gaps);
}

function buildThrottleModel(samples) {
  let points = samples
    .map(point => ({
      x: Number.isFinite(point.AlignedFraction) ? point.AlignedFraction : rawFractionAt(samples, point),
      y: telemetryNumber(point.Throttle),
      time: telemetryNumber(point.ElapsedSeconds),
    }))
    .filter(point => Number.isFinite(point.x) && point.y !== null && point.time !== null);
  if (points.length < 3) return null;
  const reconstruction = reconstructLargeGaps(points, samples, 'Throttle');
  // Accurate mode bypasses this model and connects measured samples linearly.
  // Enhanced mode uses a bounded, shape-preserving curve that cannot overshoot
  // the published throttle values and bridges explicitly detected gaps.
  return finishShapePreservingModel(reconstruction.points, reconstruction.gaps);
}

function evaluateSpeedModel(model, fraction) {
  const x = clampTelemetry(fraction);
  const points = model.points;
  if (x <= points[0].x) return points[0].y;
  if (x >= points[points.length - 1].x) return points[points.length - 1].y;
  let low = 1;
  let high = points.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (points[middle].x < x) low = middle + 1;
    else high = middle;
  }
  const index = low - 1;
  const width = model.interpolation === 'linear'
    ? (points[index + 1].x - points[index].x || 1)
    : (model.intervals[index] || 1);
  const t = clampTelemetry((x - points[index].x) / width);
  if (model.interpolation === 'linear') {
    return points[index].y + (points[index + 1].y - points[index].y) * t;
  }
  const t2 = t * t;
  const t3 = t2 * t;
  const value = (2 * t3 - 3 * t2 + 1) * points[index].y
    + (t3 - 2 * t2 + t) * width * model.tangents[index]
    + (-2 * t3 + 3 * t2) * points[index + 1].y
    + (t3 - t2) * width * model.tangents[index + 1];
  return Math.max(
    Math.min(points[index].y, points[index + 1].y),
    Math.min(Math.max(points[index].y, points[index + 1].y), value)
  );
}

function smoothedTelemetryValue(samples, fraction, field) {
  if (field === 'Speed') {
    if (!samples.speedModel) setTelemetryMeta(samples, 'speedModel', buildSpeedModel(samples));
    return samples.speedModel
      ? evaluateSpeedModel(samples.speedModel, fraction)
      : alignedValue(samples, fraction, field);
  }
  if (field === 'Throttle') {
    if (!samples.throttleModel) setTelemetryMeta(samples, 'throttleModel', buildThrottleModel(samples));
    return samples.throttleModel
      ? clampTelemetry(evaluateSpeedModel(samples.throttleModel, fraction), 0, 100)
      : alignedValue(samples, fraction, field);
  }
  return alignedValue(samples, fraction, field);
}

function enhancedInterpolationEnabled() {
  return Boolean(document.getElementById('interpolationToggle')?.checked);
}

function traceTelemetryValue(samples, fraction, field) {
  if (!enhancedInterpolationEnabled() || (field !== 'Speed' && field !== 'Throttle')) {
    return alignedValue(samples, fraction, field);
  }
  return smoothedTelemetryValue(samples, fraction, field);
}

function isReconstructedTelemetry(samples, fraction, field) {
  if (!enhancedInterpolationEnabled()) return false;
  const model = field === 'Speed' ? samples?.speedModel
    : field === 'Throttle' ? samples?.throttleModel : null;
  return Boolean(model?.gaps?.some(gap => fraction > gap.start && fraction < gap.end));
}

function calibratedElapsed(samples, fraction) {
  if (!samples?.length) return null;
  const raw = alignedValue(samples, fraction, 'ElapsedSeconds');
  if (!Number.isFinite(raw)) return null;
  const controls = samples.timeCalibration;
  if (!Array.isArray(controls) || controls.length < 2) {
    const rawDuration = samples.rawDuration || samples[samples.length - 1].ElapsedSeconds;
    return rawDuration > 0 ? raw / rawDuration * (samples.lapDuration || rawDuration) : raw;
  }
  const target = clampTelemetry(fraction);
  let afterIndex = controls.findIndex(control => control.fraction >= target);
  if (afterIndex <= 0) afterIndex = 1;
  const after = controls[Math.min(afterIndex, controls.length - 1)];
  const before = controls[Math.max(0, afterIndex - 1)];
  const ratio = clampTelemetry((raw - before.raw) / (after.raw - before.raw || 1));
  return before.official + (after.official - before.official) * ratio;
}

// Build a smooth physical time curve by integrating ds / speed along the
// aligned lap. Each sector is then scaled back to its official duration. This
// is more stable than subtracting adjacent sparse timestamps over a 25 m slice
// and keeps local dominance consistent with the displayed speed trace.
function buildPerformanceTimeModel(samples) {
  if (!samples?.length) return null;
  const totalDistance = referenceDistance();
  if (!Number.isFinite(totalDistance) || totalDistance <= 0) return null;
  const resolution = Math.max(600, Math.min(1800, Math.ceil(totalDistance / 4)));
  const raw = new Array(resolution + 1).fill(0);
  for (let index = 1; index <= resolution; index++) {
    const beforeFraction = (index - 1) / resolution;
    const afterFraction = index / resolution;
    const beforeSpeed = traceTelemetryValue(samples, beforeFraction, 'Speed');
    const afterSpeed = traceTelemetryValue(samples, afterFraction, 'Speed');
    if (!Number.isFinite(beforeSpeed) || !Number.isFinite(afterSpeed)) return null;
    const meanSpeed = Math.max(10, (beforeSpeed + afterSpeed) / 2);
    raw[index] = raw[index - 1] + (totalDistance / resolution) / (meanSpeed / 3.6);
  }

  const rawAt = fraction => {
    const index = clampTelemetry(fraction) * resolution;
    const lower = Math.floor(index);
    const upper = Math.min(resolution, Math.ceil(index));
    const ratio = index - lower;
    return raw[lower] + (raw[upper] - raw[lower]) * ratio;
  };
  const controls = (samples.timeCalibration || [])
    .map(control => ({ fraction: control.fraction, official: control.official }))
    .filter(control => Number.isFinite(control.fraction) && Number.isFinite(control.official))
    .sort((a, b) => a.fraction - b.fraction)
    .filter((control, index, array) => index === 0 || control.fraction > array[index - 1].fraction);
  if (controls.length < 2) {
    controls.splice(0, controls.length,
      { fraction: 0, official: 0 },
      { fraction: 1, official: samples.lapDuration || raw[resolution] });
  }
  controls.forEach(control => { control.integrated = rawAt(control.fraction); });

  const values = raw.map((integrated, index) => {
    const fraction = index / resolution;
    let afterIndex = controls.findIndex(control => control.fraction >= fraction);
    if (afterIndex <= 0) afterIndex = 1;
    const after = controls[Math.min(afterIndex, controls.length - 1)];
    const before = controls[Math.max(0, afterIndex - 1)];
    const ratio = clampTelemetry((integrated - before.integrated) /
      (after.integrated - before.integrated || 1));
    return before.official + (after.official - before.official) * ratio;
  });
  return { resolution, values, controls };
}

function performanceElapsed(samples, fraction) {
  if (!samples?.length) return null;
  if (!samples.performanceTimeModel) {
    setTelemetryMeta(samples, 'performanceTimeModel', buildPerformanceTimeModel(samples));
  }
  const model = samples.performanceTimeModel;
  if (!model) return calibratedElapsed(samples, fraction);
  const target = clampTelemetry(fraction);
  const exact = model.controls.find(control => Math.abs(control.fraction - target) < 1e-8);
  if (exact) return exact.official;
  const index = target * model.resolution;
  const lower = Math.floor(index);
  const upper = Math.min(model.resolution, Math.ceil(index));
  const ratio = index - lower;
  return model.values[lower] + (model.values[upper] - model.values[lower]) * ratio;
}

function performanceSectionDuration(samples, start, end) {
  const startTime = performanceElapsed(samples, start);
  const endTime = performanceElapsed(samples, end);
  return Number.isFinite(startTime) && Number.isFinite(endTime) ? endTime - startTime : null;
}

function deltaAt(samples, reference, targetDistance) {
  const fraction = clampTelemetry(targetDistance / referenceDistance());
  const timeHere = calibratedElapsed(samples, fraction);
  const referenceHere = calibratedElapsed(reference, fraction);
  if (!Number.isFinite(timeHere) || !Number.isFinite(referenceHere)) return null;
  return timeHere - referenceHere;
}

function buildDeltaModel(samples, reference) {
  const resolution = 360;
  const raw = Array.from({ length: resolution + 1 }, (_, index) => {
    const fraction = index / resolution;
    const timeHere = performanceElapsed(samples, fraction);
    const referenceHere = performanceElapsed(reference, fraction);
    return Number.isFinite(timeHere) && Number.isFinite(referenceHere) ? timeHere - referenceHere : null;
  });
  if (!raw.every(Number.isFinite)) return null;

  // Put official start, sector and finish deltas back exactly. Integrated
  // speed already produces a smooth curve, so no additional low-pass filter
  // is needed and local map winners remain consistent with the delta trace.
  const referenceLap = loaded[0];
  const anchors = [0, ...alignedSectorFractions(reference, referenceLap), 1].map(fraction => {
    const index = clampTelemetry(fraction) * resolution;
    const lower = Math.floor(index);
    const upper = Math.min(resolution, Math.ceil(index));
    const ratio = index - lower;
    const filteredValue = raw[lower] + (raw[upper] - raw[lower]) * ratio;
    const officialValue = deltaAt(samples, reference, referenceDistance() * fraction);
    return { fraction, correction: officialValue - filteredValue };
  });
  const corrected = raw.map((value, index) => {
    const fraction = index / resolution;
    return value + interpolateControls(anchors, fraction, 'fraction', 'correction');
  });
  return {
    resolution,
    values: corrected,
    anchors: anchors.map(anchor => ({
      fraction: anchor.fraction,
      value: deltaAt(samples, reference, referenceDistance() * anchor.fraction),
    })),
  };
}

function displayDeltaAt(samples, reference, fraction) {
  if (samples === reference) return 0;
  if (!samples.deltaModel) setTelemetryMeta(samples, 'deltaModel', buildDeltaModel(samples, reference));
  if (!samples.deltaModel) return deltaAt(samples, reference, referenceDistance() * fraction);
  const target = clampTelemetry(fraction);
  const exactAnchor = samples.deltaModel.anchors?.find(anchor => Math.abs(anchor.fraction - target) < 1e-8);
  if (exactAnchor) return exactAnchor.value;
  const index = target * samples.deltaModel.resolution;
  const lower = Math.floor(index);
  const upper = Math.min(samples.deltaModel.resolution, Math.ceil(index));
  const ratio = index - lower;
  return samples.deltaModel.values[lower]
    + (samples.deltaModel.values[upper] - samples.deltaModel.values[lower]) * ratio;
}

function adaptiveCornerZones(markers) {
  const totalDistance = referenceDistance();
  if (!totalDistance || !markers?.length) return [];
  const ordered = [...markers]
    .filter(marker => Number.isFinite(marker.fraction))
    .sort((a, b) => a.fraction - b.fraction);
  const series = loaded.map(lap => telemetryCache.get(telemetryKey(lap))).filter(samples => samples?.length);
  const reference = series.reduce((best, samples) =>
    (samples.quality?.positionCoverage || 0) > (best?.quality?.positionCoverage || 0)
      ? samples : best, series[0]);
  const ensembleSpeed = fraction => medianTelemetry(series
    .map(samples => traceTelemetryValue(samples, fraction, 'Speed'))
    .filter(Number.isFinite));
  const geometryCurvature = fraction => {
    if (!reference?.length) return null;
    const arm = 18 / totalDistance;
    const point = offset => ({
      x: alignedValue(reference, clampTelemetry(fraction + offset), 'X'),
      y: alignedValue(reference, clampTelemetry(fraction + offset), 'Y'),
    });
    const before = point(-arm);
    const centre = point(0);
    const after = point(arm);
    if (![before.x, before.y, centre.x, centre.y, after.x, after.y].every(Number.isFinite)) return null;
    const incoming = { x: centre.x - before.x, y: centre.y - before.y };
    const outgoing = { x: after.x - centre.x, y: after.y - centre.y };
    const incomingLength = Math.hypot(incoming.x, incoming.y);
    const outgoingLength = Math.hypot(outgoing.x, outgoing.y);
    if (!incomingLength || !outgoingLength) return null;
    const cosine = clampTelemetry(
      (incoming.x * outgoing.x + incoming.y * outgoing.y) / (incomingLength * outgoingLength),
      -1,
      1
    );
    return Math.acos(cosine) / 36;
  };

  const descriptors = ordered.map((marker, index) => {
    const previousGap = index ? (marker.fraction - ordered[index - 1].fraction) * totalDistance : Infinity;
    const nextGap = index < ordered.length - 1 ? (ordered[index + 1].fraction - marker.fraction) * totalDistance : Infinity;
    const complex = Math.min(previousGap, nextGap) < 185;
    const searchMetres = Math.min(complex ? 62 : 125, previousGap * .46, nextGap * .46);
    const searchHalf = Math.max(24, searchMetres) / totalDistance;
    const searchStart = Math.max(0, marker.fraction - searchHalf,
      index ? (ordered[index - 1].fraction + marker.fraction) / 2 : 0);
    const searchEnd = Math.min(1, marker.fraction + searchHalf,
      index < ordered.length - 1 ? (marker.fraction + ordered[index + 1].fraction) / 2 : 1);
    let apex = marker.fraction;
    let bestGeometryScore = -Infinity;
    let minimumSpeed = Infinity;
    const searchSteps = Math.max(12, Math.ceil((searchEnd - searchStart) * totalDistance / 4));
    for (let step = 0; step <= searchSteps; step++) {
      const fraction = searchStart + (searchEnd - searchStart) * step / searchSteps;
      const speed = ensembleSpeed(fraction);
      if (Number.isFinite(speed) && speed < minimumSpeed) minimumSpeed = speed;
      const curvatureSamples = [-5, 0, 5]
        .map(offset => geometryCurvature(fraction + offset / totalDistance))
        .filter(Number.isFinite);
      const curvature = medianTelemetry(curvatureSamples);
      const range = Math.max(searchEnd - searchStart, 1 / totalDistance);
      const proximityWeight = 1 - .22 * Math.abs(fraction - marker.fraction) / range;
      const score = Number.isFinite(curvature) ? curvature * proximityWeight : -Infinity;
      if (score > bestGeometryScore) {
        bestGeometryScore = score;
        apex = fraction;
      }
    }

    // If geometry is absent or essentially straight, the projected official
    // corner marker is a safer centre than a telemetry speed trough.
    if (!Number.isFinite(bestGeometryScore) || bestGeometryScore <= 1e-7) apex = marker.fraction;

    const threshold = minimumSpeed + (minimumSpeed < 145 ? 14 : minimumSpeed < 220 ? 11 : 8);
    const stepFraction = 5 / totalDistance;
    let basinStart = apex;
    let basinEnd = apex;
    for (let fraction = apex; fraction >= searchStart; fraction -= stepFraction) {
      if (ensembleSpeed(fraction) > threshold) break;
      basinStart = fraction;
    }
    for (let fraction = apex; fraction <= searchEnd; fraction += stepFraction) {
      if (ensembleSpeed(fraction) > threshold) break;
      basinEnd = fraction;
    }
    const basinMetres = Math.max(0, (basinEnd - basinStart) * totalDistance);
    const longRadius = !complex && basinMetres >= 75;
    const type = complex ? 'CHICANE / COMPLEX' : longRadius ? 'LONG RADIUS' : minimumSpeed < 145 ? 'SLOW CORNER' : minimumSpeed > 225 ? 'HIGH SPEED' : 'MEDIUM SPEED';
    const apexHalfMetres = complex ? 26 : longRadius ? Math.min(105, Math.max(52, basinMetres * .62))
      : minimumSpeed < 145 ? 42 : minimumSpeed > 225 ? 34 : 38;
    const sectorReach = longRadius ? 220 : complex ? 175 : 190;
    return { ...marker, apex, minimumSpeed, type, apexHalfMetres, sectorReach, previousGap, nextGap };
  });

  return descriptors.map((descriptor, index) => {
    const previous = descriptors[index - 1];
    const next = descriptors[index + 1];
    const leftDistance = previous ? (descriptor.apex - previous.apex) * totalDistance : Infinity;
    const rightDistance = next ? (next.apex - descriptor.apex) * totalDistance : Infinity;
    const start = Math.max(0, descriptor.apex - (previous && leftDistance <= descriptor.sectorReach + previous.sectorReach
      ? leftDistance / 2 : descriptor.sectorReach) / totalDistance);
    const end = Math.min(1, descriptor.apex + (next && rightDistance <= descriptor.sectorReach + next.sectorReach
      ? rightDistance / 2 : descriptor.sectorReach) / totalDistance);
    const apexStart = Math.max(start, descriptor.apex - descriptor.apexHalfMetres / totalDistance);
    const apexEnd = Math.min(end, descriptor.apex + descriptor.apexHalfMetres / totalDistance);
    return {
      ...descriptor,
      start,
      end,
      apexStart,
      apexEnd,
      metres: Math.round((end - start) * totalDistance),
      apexMetres: Math.round((apexEnd - apexStart) * totalDistance),
    };
  });
}

function cornerPerformance(samples, zone) {
  if (!samples?.length || !zone) return null;
  const totalDistance = referenceDistance();
  const steps = Math.max(8, Math.ceil((zone.apexEnd - zone.apexStart) * totalDistance / 4));
  // Sample bin centres rather than both inclusive boundaries. Adjacent
  // corners meet at a midpoint; excluding that exact shared boundary ensures
  // no speed sample can contribute to both corners' minimum calculation.
  const apexSamples = Array.from({ length: steps }, (_, index) => {
    const fraction = zone.apexStart
      + (zone.apexEnd - zone.apexStart) * (index + 0.5) / steps;
    return { fraction, speed: traceTelemetryValue(samples, fraction, 'Speed') };
  }).filter(point => Number.isFinite(point.speed));
  if (apexSamples.length < 3) return null;
  const ordered = [...apexSamples].sort((a, b) => a.speed - b.speed);
  const lowCount = Math.max(2, Math.min(5, Math.ceil(ordered.length * .12)));
  const stableMinimum = medianTelemetry(ordered.slice(0, lowCount).map(point => point.speed));
  const minimumPoint = ordered[0];
  const sectionTime = performanceSectionDuration(samples, zone.start, zone.end);
  return {
    minimumSpeed: stableMinimum,
    rawMinimum: minimumPoint.speed,
    apexFraction: minimumPoint.fraction,
    sectionTime,
    method: zone.type,
    samples: apexSamples.length,
  };
}

function getCornerMinSpeed(samples, corner) {
  if (!samples?.length) return null;
  const fallbackFraction = Number(corner?.distance) / referenceDistance();
  const fraction = clampTelemetry(Number(corner?.fraction ?? fallbackFraction));
  const windowSize = Math.max(18, Math.min(35, referenceDistance() * 0.006));
  const nearby = samples.filter(point => {
    const pointFraction = Number.isFinite(point.AlignedFraction) ? point.AlignedFraction : rawFractionAt(samples, point);
    return Math.abs(pointFraction - fraction) * referenceDistance() <= windowSize && hasTelemetryNumber(point.Speed);
  });
  if (!nearby.length) return null;
  const markerSpeed = alignedValue(samples, fraction, 'Speed');
  const adaptiveMinimum = nearby.reduce((a, b) => +a.Speed < +b.Speed ? a : b);
  const markerWindow = nearby.filter(point => {
    const pointFraction = Number.isFinite(point.AlignedFraction) ? point.AlignedFraction : rawFractionAt(samples, point);
    return Math.abs(pointFraction - fraction) * referenceDistance() <= 7;
  });
  const markerMinimum = markerWindow.length
    ? markerWindow.reduce((a, b) => +a.Speed < +b.Speed ? a : b)
    : adaptiveMinimum;
  const edgeSpeed = ((+nearby[0].Speed) + (+nearby[nearby.length - 1].Speed)) / 2;
  const hasMeaningfulTrough = Number.isFinite(markerSpeed) && edgeSpeed - (+adaptiveMinimum.Speed) >= 6;
  const point = hasMeaningfulTrough ? adaptiveMinimum : { ...nearby[Math.floor(nearby.length / 2)], Speed: markerSpeed };
  const pointFraction = Number.isFinite(point.AlignedFraction) ? point.AlignedFraction : rawFractionAt(samples, point);
  return {
    ...point,
    traceSpeed: +point.Speed,
    cornerSpeed: ((+adaptiveMinimum.Speed) + (+markerMinimum.Speed)) / 2,
    fraction: pointFraction,
    isApex: hasMeaningfulTrough,
  };
}

function updateAlignmentStatus() {
  const status = $('#alignmentStatus');
  if (!status) return;
  if (!loaded.length) {
    status.textContent = 'Awaiting lap selection';
    status.dataset.state = 'idle';
    return;
  }
  const series = loaded.map(lap => telemetryCache.get(telemetryKey(lap))).filter(Boolean);
  if (series.length !== loaded.length) {
    status.textContent = 'Preparing telemetry';
    status.dataset.state = 'loading';
    return;
  }
  const methods = new Set(series.map(samples => samples.alignmentMethod));
  const sources = [...new Set(series.map(samples => samples.source).filter(Boolean))];
  const heldChannels = series.some(samples => (samples.quality?.repeatSpeedRatio || 0) >= 0.35);
  const method = methods.size === 1 && methods.has('reference')
    ? 'Reference distance'
    : [...methods].some(value => value.startsWith('position'))
      ? 'GPS + distance aligned'
      : 'Sector-distance aligned';
  const sourceLabel = sources.length ? ` · ${sources.join(' / ')}` : '';
  status.textContent = `${method}${sourceLabel}${heldChannels ? ' · shape-preserving trace' : ''}`;
  status.dataset.state = 'ready';
}

function prepareTelemetryAlignment() {
  if (!loaded.length) {
    updateAlignmentStatus();
    return;
  }
  const referenceLap = loaded[0];
  const reference = telemetryCache.get(telemetryKey(referenceLap));
  if (!reference?.length) {
    updateAlignmentStatus();
    return;
  }
  const candidates = loaded
    .map(lap => ({ lap, samples: telemetryCache.get(telemetryKey(lap)) }))
    .filter(item => item.samples?.length)
    .sort((left, right) =>
      (right.samples.quality?.positionCoverage || 0) - (left.samples.quality?.positionCoverage || 0));
  const spatial = candidates.find(item =>
    (item.samples.quality?.positionCoverage || 0) >= 0.55
      && referencePositionPath(item.samples));
  const spatialLap = spatial?.lap || referenceLap;
  const spatialReference = spatial?.samples || reference;
  const referenceSectors = sectorFractions(spatialReference, spatialLap);

  // Corner markers are physical track locations. If the timing-reference lap
  // lacks them, borrow the projected markers from the best-positioned lap.
  if ((!Array.isArray(referenceLap.cornerMarkers) || !referenceLap.cornerMarkers.length)
      && Array.isArray(spatialLap.cornerMarkers) && spatialLap.cornerMarkers.length) {
    referenceLap.cornerMarkers = spatialLap.cornerMarkers.map(marker => ({ ...marker }));
  }

  loaded.forEach(lap => {
    const samples = telemetryCache.get(telemetryKey(lap));
    if (!samples?.length) return;
    let fractions = samples === spatialReference
      ? samples.map(point => rawFractionAt(samples, point))
      : positionAlignment(spatialReference, samples);
    let method = samples === spatialReference
      ? (spatial ? 'position-reference' : 'reference')
      : fractions ? 'position' : 'distance';
    if (!fractions) fractions = samples.map(point => rawFractionAt(samples, point));
    // Position projection already identifies the same physical place on the
    // circuit. Sector-warping that result can move real corners by tens of
    // metres when the first source sample arrives just after the timing line.
    // Use sector warping only for the coordinate-free distance fallback.
    if (method === 'distance') {
      const sectorRemap = remapWithSectorAnchors(samples, fractions, lap, referenceSectors);
      fractions = sectorRemap.fractions;
      if (sectorRemap.used) method += '+sectors';
    }
    setAlignedFractions(samples, fractions, method);
    setTelemetryMeta(samples, 'alignmentSectors', referenceSectors);
    buildTimeCalibration(samples, lap, referenceSectors);
  });
  updateAlignmentStatus();
}
