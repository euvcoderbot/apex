// Lap alignment and telemetry semantics overrides.
// All traces are compared at equal *relative* track distance, not at a raw
// reference distance. This removes endpoint drift between different lap traces.

function referenceDistance() {
  const reference = loaded[0] && telemetryCache.get(telemetryKey(loaded[0]));
  return reference?.length ? reference[reference.length - 1].Distance : 1;
}

function normalizeTelemetry(samples, lap) {
  if (!samples?.length) return samples;
  samples.sort((a, b) => (+a.Distance || 0) - (+b.Distance || 0));
  const firstDistance = +samples[0].Distance || 0;
  const firstTime = +samples[0].ElapsedSeconds || 0;
  samples.forEach(point => {
    point.Distance = Math.max(0, (+point.Distance || 0) - firstDistance);
    point.ElapsedSeconds = Math.max(0, (+point.ElapsedSeconds || 0) - firstTime);
  });
  const rawDuration = +samples[samples.length - 1].ElapsedSeconds || 0;
  Object.defineProperties(samples, {
    lapDuration: { value: Number.isFinite(lap.time) ? lap.time : rawDuration, configurable: true },
    rawDuration: { value: rawDuration, configurable: true },
  });
  return samples;
}

async function fetchTelemetry(lap) {
  const key = telemetryKey(lap);
  if (telemetryCache.has(key)) return telemetryCache.get(key);
  const query = currentQuery();
  query.set('driver', lap.code);
  query.set('lap', lap.lap);
  const response = await fetch(`/api/telemetry?${query}`);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.detail || 'Telemetry unavailable for this lap');
  const samples = normalizeTelemetry(payload.samples || [], lap);
  const season = Number($('#year').value);
  const rawModeValues = samples.map(point => Number(point.DRS)).filter(Number.isFinite);
  // A 2026 zero-only field is not evidence that the car stayed closed for an
  // entire lap. Treat it as unpublished rather than drawing a false trace.
  samples.modeAvailable = season < 2026 || rawModeValues.some(value => value !== 0);
  samples.forEach(point => {
    // 2018–2025 FastF1 encodes DRS activation as 10/12/14. Do not infer it
    // from speed or throttle. The 2026 API has no verified equivalent channel.
    if (season < 2026) point.DRS = [10, 12, 14].includes(Number(point.DRS)) ? 1 : 0;
    else point.DRS = samples.modeAvailable && Number.isFinite(Number(point.DRS))
      ? (Number(point.DRS) > 0 ? 1 : 0)
      : null;
    point.Brake = point.Brake === true ? 100 : (+point.Brake || 0);
  });
  telemetryCache.set(key, samples);
  return samples;
}

function interpolate(samples, targetDistance, field) {
  if (!samples?.length) return null;
  const sourceTotal = +samples[samples.length - 1].Distance || 0;
  const fraction = Math.max(0, Math.min(1, targetDistance / referenceDistance()));
  const target = fraction * sourceTotal;
  if (target <= 0) return samples[0][field];
  if (target >= sourceTotal) return samples[samples.length - 1][field];
  const index = samples.findIndex(point => point.Distance >= target);
  if (index <= 0) return samples[0][field];
  const a = samples[index - 1], b = samples[index];
  const ratio = (target - a.Distance) / (b.Distance - a.Distance || 1);
  if (field === 'nGear' || field === 'DRS') return ratio < .5 ? a[field] : b[field];
  return (+a[field]) + ((+b[field]) - (+a[field])) * ratio;
}

function calibratedElapsed(samples, fraction) {
  if (!samples?.length) return null;
  const totalDistance = referenceDistance();
  const raw = interpolate(samples, totalDistance * fraction, 'ElapsedSeconds');
  const rawDuration = samples.rawDuration || samples[samples.length - 1].ElapsedSeconds;
  if (!Number.isFinite(raw) || !Number.isFinite(rawDuration) || rawDuration <= 0) return null;
  return raw / rawDuration * (samples.lapDuration || rawDuration);
}

function deltaAt(samples, reference, targetDistance) {
  const fraction = Math.max(0, Math.min(1, targetDistance / referenceDistance()));
  const timeHere = calibratedElapsed(samples, fraction);
  const referenceHere = calibratedElapsed(reference, fraction);
  if (!Number.isFinite(timeHere) || !Number.isFinite(referenceHere)) return null;
  // Guaranteed: delta(0) = 0 and delta(1) = selected lap time − reference lap time.
  return timeHere - referenceHere;
}

function getCornerMinSpeed(samples, corner) {
  const ownTotal = samples?.[samples.length - 1]?.Distance || 0;
  if (!ownTotal) return null;
  const fallbackFraction = Number(corner?.distance) / referenceDistance();
  const fraction = Math.max(0, Math.min(1, Number(corner?.fraction ?? fallbackFraction)));
  const ownCorner = ownTotal * fraction;
  const windowSize = Math.max(35, Math.min(70, ownTotal * 0.012));
  const nearby = samples.filter(point => Math.abs(point.Distance - ownCorner) <= windowSize && Number.isFinite(+point.Speed));
  if (!nearby.length) return null;

  const markerSpeed = interpolate(samples, referenceDistance() * fraction, 'Speed');
  const minimum = nearby.reduce((a, b) => +a.Speed < +b.Speed ? a : b);
  const edgeSpeed = ((+nearby[0].Speed) + (+nearby[nearby.length - 1].Speed)) / 2;
  const hasMeaningfulTrough = Number.isFinite(markerSpeed) && edgeSpeed - (+minimum.Speed) >= 6;
  const point = hasMeaningfulTrough ? minimum : { Distance: ownCorner, Speed: markerSpeed };
  return { ...point, fraction: (+point.Distance || 0) / ownTotal, isApex: hasMeaningfulTrough };
}
