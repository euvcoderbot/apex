// Physical lap alignment and quality-aware telemetry rendering.
//
// Alignment follows the circuit, not the shape of a driver's speed trace:
//   1. project position samples onto the reference lap when X/Y is trustworthy;
//   2. lock the result to official sector boundaries when sector times exist;
//   3. fall back to sector-normalized integrated distance when position is absent.
//
// Accurate traces and corner calculations retain the supplied samples.
// Enhanced display/hover values use the bounded reconstruction; official
// sector/finish timing anchors remain exact.

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
        // d(v²)/distance is proportional to longitudinal acceleration. Extend
        // the measured acceleration trend through the gap with bounded slopes.
        const width = after.x - before.x || 1;
        const startEnergy = before.y ** 2;
        const endEnergy = after.y ** 2;
        const secant = (endEnergy - startEnergy) / width;
        const previous = points[index - 1];
        const following = points[index + 2];
        const neighbourSlope = (left, right) => left && right && right.x > left.x
          ? (right.y ** 2 - left.y ** 2) / (right.x - left.x) : secant;
        const limitSlope = slope => {
          if (!Number.isFinite(slope) || secant === 0 || Math.sign(slope) !== Math.sign(secant)) return secant;
          return Math.sign(secant) * Math.min(Math.abs(slope), Math.abs(secant) * 3);
        };
        const startSlope = limitSlope(neighbourSlope(previous, before));
        const endSlope = limitSlope(neighbourSlope(after, following));
        const t2 = ratio * ratio;
        const t3 = t2 * ratio;
        const predicted = (2 * t3 - 3 * t2 + 1) * startEnergy
          + (t3 - 2 * t2 + ratio) * width * startSlope
          + (-2 * t3 + 3 * t2) * endEnergy
          + (t3 - t2) * width * endSlope;
        const energy = Math.max(
          Math.min(startEnergy, endEnergy),
          Math.min(Math.max(startEnergy, endEnergy), predicted)
        );
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

function monotonicTelemetryFit(values, increasing) {
  if (values.length < 3) return [...values];
  const direction = increasing ? 1 : -1;
  const blocks = values.map((value, index) => ({
    start: index,
    end: index,
    weight: index === 0 || index === values.length - 1 ? 1e6 : 1,
    total: value * direction * (index === 0 || index === values.length - 1 ? 1e6 : 1),
  }));
  for (let index = 0; index < blocks.length - 1;) {
    const left = blocks[index];
    const right = blocks[index + 1];
    if (left.total / left.weight <= right.total / right.weight) {
      index++;
      continue;
    }
    left.end = right.end;
    left.weight += right.weight;
    left.total += right.total;
    blocks.splice(index + 1, 1);
    if (index > 0) index--;
  }
  const result = new Array(values.length);
  blocks.forEach(block => {
    const value = block.total / block.weight * direction;
    for (let index = block.start; index <= block.end; index++) result[index] = value;
  });
  result[0] = values[0];
  result[result.length - 1] = values[values.length - 1];
  return result;
}

function significantTelemetryAnchors(points, threshold, radius = 4) {
  const anchors = new Set([0, points.length - 1]);
  const values = points.map(point => point.y);
  anchors.add(values.indexOf(Math.min(...values)));
  anchors.add(values.indexOf(Math.max(...values)));
  for (let index = radius; index < points.length - radius; index++) {
    const value = points[index].y;
    const left = points.slice(index - radius, index).map(point => point.y);
    const right = points.slice(index + 1, index + radius + 1).map(point => point.y);
    const peakProminence = Math.min(value - Math.min(...left), value - Math.min(...right));
    const troughProminence = Math.min(Math.max(...left) - value, Math.max(...right) - value);
    if (value >= Math.max(...left, ...right) && peakProminence >= threshold) anchors.add(index);
    if (value <= Math.min(...left, ...right) && troughProminence >= threshold) anchors.add(index);
  }
  return anchors;
}

function regularizeSpeedEnergy(points, values, increasing, passes = 1, radius = 2) {
  if (values.length < 4) return [...values];
  const fitted = monotonicTelemetryFit(values, increasing);
  const energy = fitted.map(value => value * value);
  const widths = [];
  let slopes = [];
  for (let index = 0; index < points.length - 1; index++) {
    const width = Math.max(1e-7, points[index + 1].x - points[index].x);
    widths.push(width);
    slopes.push((energy[index + 1] - energy[index]) / width);
  }

  for (let pass = 0; pass < passes; pass++) {
    slopes = slopes.map((slope, index, source) => {
      let weighted = 0;
      let totalWeight = 0;
      for (let offset = -radius; offset <= radius; offset++) {
        const sampleIndex = Math.max(0, Math.min(source.length - 1, index + offset));
        const weight = radius + 1 - Math.abs(offset);
        weighted += source[sampleIndex] * weight;
        totalWeight += weight;
      }
      const value = weighted / totalWeight;
      return increasing ? Math.max(0, value) : Math.min(0, value);
    });
  }

  const targetDelta = energy[energy.length - 1] - energy[0];
  const smoothedDelta = slopes.reduce((sum, slope, index) => sum + slope * widths[index], 0);
  if (!Number.isFinite(smoothedDelta) || Math.abs(smoothedDelta) < 1e-8
      || Math.sign(smoothedDelta) !== Math.sign(targetDelta)) {
    return fitted;
  }
  const scale = targetDelta / smoothedDelta;
  const rebuilt = [energy[0]];
  slopes.forEach((slope, index) => {
    rebuilt.push(rebuilt[rebuilt.length - 1] + slope * scale * widths[index]);
  });
  const result = rebuilt.map(value => Math.sqrt(Math.max(0, value)));
  result[0] = values[0];
  result[result.length - 1] = values[values.length - 1];
  return result;
}

function nearestTelemetryPoint(points, fraction) {
  let best = 0;
  let error = Infinity;
  points.forEach((point, index) => {
    const current = Math.abs(point.x - fraction);
    if (current < error) {
      error = current;
      best = index;
    }
  });
  return best;
}

function addControlInformedSpeedAnchors(anchors, points, samples) {
  if (!samples?.length || points.length < 7) return;
  const candidates = significantTelemetryAnchors(points, 3.5, 4);
  const controlSpan = 0.009; // roughly 35–50 m on a typical circuit
  candidates.forEach(index => {
    if (index <= 0 || index >= points.length - 1 || anchors.has(index)) return;
    const point = points[index];
    const beforeThrottle = telemetryNumber(alignedValue(samples, clampTelemetry(point.x - controlSpan), 'Throttle'));
    const atThrottle = telemetryNumber(alignedValue(samples, point.x, 'Throttle'));
    const afterThrottle = telemetryNumber(alignedValue(samples, clampTelemetry(point.x + controlSpan), 'Throttle'));
    const beforeBrake = telemetryNumber(alignedValue(samples, clampTelemetry(point.x - controlSpan), 'Brake')) || 0;
    const atBrake = telemetryNumber(alignedValue(samples, point.x, 'Brake')) || 0;
    const afterBrake = telemetryNumber(alignedValue(samples, clampTelemetry(point.x + controlSpan), 'Brake')) || 0;
    const left = points[Math.max(0, index - 2)].y;
    const right = points[Math.min(points.length - 1, index + 2)].y;
    const isPeak = point.y >= left && point.y >= right;
    const isTrough = point.y <= left && point.y <= right;
    const throttleLift = Number.isFinite(beforeThrottle) && Number.isFinite(atThrottle)
      && beforeThrottle - Math.min(atThrottle, afterThrottle ?? atThrottle) >= 8;
    const throttleRecovery = Number.isFinite(atThrottle) && Number.isFinite(afterThrottle)
      && afterThrottle - Math.min(beforeThrottle ?? atThrottle, atThrottle) >= 8;
    const brakeOnset = Math.max(atBrake, afterBrake) > 0 && beforeBrake <= 0;
    const brakingIntoCorner = Math.max(beforeBrake, atBrake) > 0;
    if ((isPeak && (brakeOnset || throttleLift))
        || (isTrough && (brakingIntoCorner || throttleRecovery))) {
      anchors.add(index);
    }
  });
}

function speedControlState(samples, fraction) {
  const throttle = telemetryNumber(alignedValue(samples, fraction, 'Throttle'));
  const brake = telemetryNumber(alignedValue(samples, fraction, 'Brake')) || 0;
  if (brake > 0) return 'brake';
  if (Number.isFinite(throttle) && throttle >= 97) return 'full';
  return 'partial';
}

// Enhanced speed is deliberately conservative: real local extrema, input
// transitions and reconstructed-gap edges are pinned. Within each resulting
// short monotonic phase, smooth d(v²)/distance (longitudinal acceleration)
// instead of averaging speed itself. This removes sample steps without moving
// a braking peak or a corner minimum.
function smoothEnhancedSpeed(points, samples = []) {
  if (points.length < 7) return points;
  const anchors = significantTelemetryAnchors(points, 0.9, 2);
  addControlInformedSpeedAnchors(anchors, points, samples);
  let previousControl = speedControlState(samples, points[0].x);
  for (let index = 1; index < points.length; index++) {
    const control = speedControlState(samples, points[index].x);
    if (control !== previousControl) {
      anchors.add(index - 1);
      anchors.add(index);
      previousControl = control;
    }
  }
  for (let index = 1; index < points.length; index++) {
    if (Boolean(points[index].reconstructed) !== Boolean(points[index - 1].reconstructed)) {
      anchors.add(index - 1);
      anchors.add(index);
    }
  }
  const ordered = [...anchors].sort((a, b) => a - b);
  const result = points.map(point => ({ ...point }));
  for (let anchorIndex = 0; anchorIndex < ordered.length - 1; anchorIndex++) {
    const start = ordered[anchorIndex];
    const end = ordered[anchorIndex + 1];
    if (end - start < 3) continue;
    const segment = points.slice(start, end + 1);
    const values = segment.map(point => point.y);
    const edge = Math.min(3, Math.floor(values.length / 3));
    const startMean = values.slice(0, edge).reduce((sum, value) => sum + value, 0) / edge;
    const endMean = values.slice(-edge).reduce((sum, value) => sum + value, 0) / edge;
    const steadyControlSamples = segment.filter(point => {
      const state = speedControlState(samples, point.x);
      return state === 'full' || state === 'brake';
    }).length;
    const steadyControl = steadyControlSamples / segment.length >= 0.7;
    const fitted = regularizeSpeedEnergy(
      segment,
      values,
      endMean >= startMean,
      steadyControl ? 3 : 1,
      steadyControl ? 3 : 2
    );
    fitted.forEach((value, offset) => { result[start + offset].y = value; });
  }
  return result;
}

function smoothEnhancedThrottle(points) {
  if (points.length < 5) return points;
  const snapped = points.map(point => ({
    ...point,
    y: point.y >= 97.5 ? 100 : point.y <= 2.5 ? 0 : point.y,
  }));
  const anchors = significantTelemetryAnchors(snapped, 7.5, 2);
  for (let index = 1; index < snapped.length; index++) {
    const previousPlateau = snapped[index - 1].y === 0 || snapped[index - 1].y === 100;
    const currentPlateau = snapped[index].y === 0 || snapped[index].y === 100;
    if (previousPlateau !== currentPlateau || (previousPlateau && snapped[index - 1].y !== snapped[index].y)) {
      anchors.add(index - 1);
      anchors.add(index);
    }
  }
  const ordered = [...anchors].sort((a, b) => a - b);
  const result = snapped.map(point => ({ ...point }));
  for (let anchorIndex = 0; anchorIndex < ordered.length - 1; anchorIndex++) {
    const start = ordered[anchorIndex];
    const end = ordered[anchorIndex + 1];
    if (end - start < 2) continue;
    const values = snapped.slice(start, end + 1).map(point => point.y);
    const fitted = monotonicTelemetryFit(values, values[values.length - 1] >= values[0]);
    fitted.forEach((value, offset) => { result[start + offset].y = clampTelemetry(value, 0, 100); });
  }
  return result;
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

// A held integer speed is not an independent physical observation at every
// car-channel timestamp. During uninterrupted full throttle or braking,
// replace only the interior of a repeated-speed run with constant-acceleration
// interpolation (linear v² over distance). Distinct samples, local extrema
// and control transitions remain exact anchors.
function interpolateHeldControlledSpeed(points) {
  if (points.length < 4) return points;
  const result = points.map(point => ({ ...point }));
  let start = 0;
  while (start < points.length) {
    let end = start;
    while (end + 1 < points.length && Math.abs(points[end + 1].y - points[start].y) <= 0.05) end++;
    const leftIndex = start - 1;
    const rightIndex = end + 1;
    if (end > start && leftIndex >= 0 && rightIndex < points.length) {
      const left = points[leftIndex];
      const right = points[rightIndex];
      const plateau = points[start].y;
      const leftStep = plateau - left.y;
      const rightStep = right.y - plateau;
      const sameDirection = Math.abs(right.y - left.y) >= 0.5
        && Math.sign(leftStep) === Math.sign(rightStep);
      const fullThrottle = points.slice(leftIndex, rightIndex + 1)
        .every(point => Number.isFinite(point.throttle) && point.throttle >= 97);
      const surrounding = points.slice(leftIndex, rightIndex + 1);
      const gears = [...new Set(surrounding.map(point => point.gear).filter(Number.isFinite))];
      const sameGear = Number.isFinite(left.gear) && gears.length === 1;
      // A two-sample plateau can straddle a single upshift: speed telemetry is
      // quantised at the shift and briefly repeats even though throttle stays
      // open. Permit only this short, monotonic case; long gear-change runs
      // remain untouched because they can represent real traction events.
      const briefGearShift = gears.length === 2
        && end - start <= 2
        && right.x - left.x <= 0.02;
      const noBrake = surrounding.every(point => Number.isFinite(point.brake) && point.brake <= 0);
      const heldSamples = points.slice(start, end + 1);
      const heldUnderBraking = heldSamples.every(point => Number.isFinite(point.brake) && point.brake > 0
        && (!Number.isFinite(point.throttle) || point.throttle <= 20));
      const brakingBefore = Number.isFinite(left.brake) && left.brake > 0
        && (!Number.isFinite(left.throttle) || left.throttle <= 20);
      // The final anchor may be the first sample after brake release. It is
      // still a valid deceleration anchor while throttle remains at coast.
      const deceleratingAfter = (Number.isFinite(right.brake) && right.brake > 0)
        || ((Number.isFinite(right.brake) ? right.brake : 0) <= 0
          && Number.isFinite(right.throttle) && right.throttle <= 20);
      const span = right.x - left.x;
      const acceleratingHold = fullThrottle && noBrake && (sameGear || briefGearShift);
      const brakingHold = heldUnderBraking && brakingBefore && deceleratingAfter
        && right.y < left.y && span <= 0.035;
      if (sameDirection && (acceleratingHold || brakingHold) && span > 1e-6) {
        const startEnergy = left.y * left.y;
        const energyDelta = right.y * right.y - startEnergy;
        for (let index = start; index <= end; index++) {
          const ratio = clampTelemetry((points[index].x - left.x) / span);
          result[index].y = Math.sqrt(Math.max(0, startEnergy + energyDelta * ratio));
          result[index].heldInterpolated = true;
        }
      }
    }
    start = end + 1;
  }
  return result;
}

function buildSpeedModel(samples) {
  let points = samples
    .map(point => ({
      x: Number.isFinite(point.AlignedFraction) ? point.AlignedFraction : rawFractionAt(samples, point),
      y: telemetryNumber(point.Speed),
      time: telemetryNumber(point.ElapsedSeconds),
      throttle: telemetryNumber(point.Throttle),
      brake: telemetryNumber(point.Brake),
      gear: telemetryNumber(point.nGear),
    }))
    .filter(point => Number.isFinite(point.x) && point.y !== null && point.time !== null);
  if (points.length < 3) return null;
  let gaps = [];

  // Every ordinary interval remains bounded by its two adjacent measurements.
  // Only repeated values under uninterrupted full throttle or full braking may
  // use the nearest distinct samples on either side as reconstruction anchors.
  // Accurate mode still uses the untouched source samples.
  points = interpolateHeldControlledSpeed(points);
  if (points.length >= 7) {
    const reconstruction = reconstructLargeGaps(points, samples, 'Speed');
    points = reconstruction.points;
    gaps = reconstruction.gaps;
  }
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
  return finishShapePreservingModel(smoothEnhancedThrottle(reconstruction.points), reconstruction.gaps);
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

// Build a physical time curve from the speed trace currently being displayed.
// Accurate mode integrates the supplied samples exactly as before; Enhanced
// mode integrates its reconstructed speed curve. Each sector is then scaled
// back to its official duration so sector and finish deltas remain exact.
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

  // Put official start, sector and finish deltas back exactly. Integration
  // makes the curve continuous without an arbitrary low-pass filter, and the
  // enhanced curve now follows the same reconstructed speed trace on screen.
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
    status.textContent = 'Speed trace controls';
    status.title = 'Speed trace controls';
    status.dataset.state = 'idle';
    return;
  }
  const series = loaded.map(lap => telemetryCache.get(telemetryKey(lap))).filter(Boolean);
  if (series.length !== loaded.length) {
    status.textContent = 'Speed trace controls';
    status.title = 'Speed trace controls';
    status.dataset.state = 'loading';
    return;
  }
  status.textContent = 'Speed trace controls';
  status.title = 'Speed trace controls';
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
