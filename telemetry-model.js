/* Enhanced telemetry reconstruction. Pure functions: no DOM, no source mutation.
 * Time is the independent variable for v(t), so dv/dt is acceleration.
 * Aligned distance only locates the result on the shared circuit axis.
 * PCHIP: Fritsch/Butland weighted harmonic tangents, limited endpoints.
 */
(function (root) {
  'use strict';
  const finite = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
  const number = value => finite(value) ? Number(value) : null;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const median = values => {
    const a = values.filter(Number.isFinite).sort((x, y) => x - y);
    return a.length ? (a[(a.length - 1) >> 1] + a[a.length >> 1]) / 2 : null;
  };
  const slope = (a, b) => (b.y - a.y) / (b.t - a.t);
  const state = p => p.brake !== null && p.brake > 0 && p.throttle !== null && p.throttle <= 5
    ? 'brake' : p.brake === 0 && p.throttle !== null && p.throttle >= 97 ? 'power' : 'other';

  function spline(points) {
    if (points.length < 2) return null;
    const h = [], d = [], m = new Array(points.length);
    for (let i = 0; i < points.length - 1; i++) {
      h.push(points[i + 1].t - points[i].t);
      d.push(slope(points[i], points[i + 1]));
    }
    const endpoint = (h0, h1, d0, d1) => {
      let v = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1);
      if (Math.sign(v) !== Math.sign(d0)) v = 0;
      else if (Math.sign(d0) !== Math.sign(d1) && Math.abs(v) > Math.abs(3 * d0)) v = 3 * d0;
      return v;
    };
    m[0] = d.length === 1 ? d[0] : endpoint(h[0], h[1], d[0], d[1]);
    const last = d.length - 1;
    m[m.length - 1] = d.length === 1 ? d[0] : endpoint(h[last], h[last - 1], d[last], d[last - 1]);
    for (let i = 1; i < m.length - 1; i++) {
      if (d[i - 1] * d[i] <= 0) m[i] = 0;
      else {
        const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1];
        m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
      }
    }
    return { points, h, m };
  }

  function segmentAt(points, t) {
    let low = 1, high = points.length - 1;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (points[mid].t < t) low = mid + 1;
      else high = mid;
    }
    return low - 1;
  }

  function evaluateSpline(model, t) {
    if (!model) return null;
    const p = model.points;
    if (t <= p[0].t) return p[0].y;
    if (t >= p[p.length - 1].t) return p[p.length - 1].y;
    const i = segmentAt(p, t), h = model.h[i], u = (t - p[i].t) / h;
    // Hermite endpoint velocities make the repair join the neighbouring
    // acceleration continuously, without a straight chord or spline overshoot.
    const y = (2 * u ** 3 - 3 * u ** 2 + 1) * p[i].y
      + (u ** 3 - 2 * u ** 2 + u) * h * model.m[i]
      + (-2 * u ** 3 + 3 * u ** 2) * p[i + 1].y
      + (u ** 3 - u ** 2) * h * model.m[i + 1];
    return clamp(y, Math.min(p[i].y, p[i + 1].y), Math.max(p[i].y, p[i + 1].y));
  }

  function sourcePoints(samples, field) {
    const total = number(samples[samples.length - 1]?.Distance) || 1;
    const points = samples.map((p, index) => ({
      t: number(p.ElapsedSeconds),
      x: number(p.AlignedFraction) ?? (number(p.Distance) ?? 0) / total,
      y: number(p[field]), throttle: number(p.Throttle),
      brake: number(Object.hasOwn(p, 'ReconstructionBrake') ? p.ReconstructionBrake : p.Brake),
      gear: number(p.nGear), rpm: number(p.RPM), index,
    })).filter(p => p.t !== null && Number.isFinite(p.x)).sort((a, b) => a.t - b.t);
    // Duplicated timestamps cannot supply two independent observations. Keep
    // the last valid value at a timestamp; never average unrelated packets.
    const result = [];
    for (const p of points) {
      const prev = result[result.length - 1];
      if (prev && p.t === prev.t) {
        if (p.y !== null) result[result.length - 1] = p;
      } else if (!prev || p.x >= prev.x) result.push(p);
    }
    return result;
  }

  function sameInputs(points, start, end, allowGearChanges = false) {
    const s = state(points[start]);
    return s !== 'other' && points.slice(start, end + 1).every(p =>
      state(p) === s && (allowGearChanges || (p.gear !== null && p.gear === points[start].gear)));
  }

  function markSpikes(points, removed, ranges) {
    // A slope alone is insufficient evidence: real braking and gear changes
    // can be sharp. Require an isolated excursion AND an implausible rate on
    // both sides, with a plausible bridge and unchanged controls/gear.
    for (let i = 1; i < points.length - 1; i++) {
      if (removed.has(i)) continue;
      for (let count = 1; count <= 2 && i + count < points.length; count++) {
        const a = points[i - 1], b = points[i + count];
        if (b.t - a.t > 1.25 || !sameInputs(points, i - 1, i + count)) continue;
        const excursion = points.slice(i, i + count);
        const above = excursion.every(p => p.y > Math.max(a.y, b.y) + 8);
        const below = excursion.every(p => p.y < Math.min(a.y, b.y) - 8);
        if (!above && !below) continue;
        const entry = slope(a, excursion[0]) / 3.6;
        const exit = slope(excursion[excursion.length - 1], b) / 3.6;
        const bridge = slope(a, b) / 3.6;
        const impossible = v => v > 28 || v < -85;
        if (!impossible(entry) || !impossible(exit) || Math.abs(bridge) > 65) continue;
        for (let j = i; j < i + count; j++) removed.add(j);
        ranges.push({ start: a.x, end: b.x, kind: 'outlier', confidence: 'estimated', interval: b.t - a.t });
        i += count - 1;
        break;
      }
    }
  }

  function markHolds(points, removed, ranges, cadence) {
    for (let start = 1; start < points.length - 2; start++) {
      let end = start;
      while (end + 1 < points.length && Math.abs(points[end + 1].y - points[start].y) < .025) end++;
      if (end === start) continue;
      const li = start - 1, ri = end + 1;
      if (ri >= points.length || [...removed].some(i => i >= li && i <= ri)) { start = end; continue; }
      const a = points[li], b = points[ri], duration = b.t - a.t;
      const change = b.y - a.y, sign = Math.sign(change);
      const leftStep = points[start].y - a.y, rightStep = b.y - points[end].y;
      const controls = sameInputs(points, li, ri, state(a) === 'brake');
      const direction = state(a) === 'brake' ? sign < 0 : sign > 0;
      // Long steady-speed/limiter shelves are not missing samples. Small
      // integer repeats are compatible with quantisation and remain exact.
      if (!controls || !direction || duration > Math.max(1.3, cadence * 5)
          || Math.abs(change) < 3 || Math.sign(leftStep) !== sign || Math.sign(rightStep) !== sign) { start = end; continue; }
      const before = li > 0 ? slope(points[li - 1], a) : null;
      const after = ri + 1 < points.length ? slope(b, points[ri + 1]) : null;
      const bridge = slope(a, b);
      const neighbouring = [before, after].filter(v => Number.isFinite(v) && Math.sign(v) === sign);
      const trend = median(neighbouring);
      const sameGear = points.slice(li, ri + 1).every(p => p.gear === a.gear && p.gear !== null);
      const rpms = points.slice(start, end + 1).map(p => p.rpm).filter(Number.isFinite);
      const rpmMoves = sameGear && rpms.length >= 2 && (rpms[rpms.length - 1] - rpms[0]) * sign > 70;
      const rpmSteady = sameGear && rpms.length === end - start + 1 && rpms.length >= 3
        && Math.max(...rpms) - Math.min(...rpms) < 35;
      // Both adjacent trends corroborate the bridge, or independent same-gear
      // RPM moves through a frozen speed channel. Full throttle alone never
      // licenses reconstruction, and a steady RPM shelf is preserved.
      const trendSupports = neighbouring.length === 2 && Math.abs(trend) > 1
        && Math.abs(bridge / trend) >= .35 && Math.abs(bridge / trend) <= 2.8;
      if ((!trendSupports && !rpmMoves) || (rpmSteady && !rpmMoves)) { start = end; continue; }
      for (let j = start; j <= end; j++) removed.add(j);
      ranges.push({ start: a.x, end: b.x, kind: 'sample-hold', confidence: 'estimated', interval: duration });
      start = end;
    }
  }

  function build(samples, field = 'Speed') {
    if (!Array.isArray(samples) || samples.length < 2) return null;
    const source = sourcePoints(samples, field);
    const steps = source.slice(1).map((p, i) => p.t - source[i].t).filter(v => v > 0 && v < 2);
    const cadence = median(steps) || .27;
    const limit = field === 'Throttle' ? 100 : 450;
    const valid = source.filter(p => p.y !== null && p.y >= 0 && p.y <= limit);
    if (valid.length < 2) return null;
    const removed = new Set(), ranges = [];
    if (field === 'Speed') {
      markSpikes(valid, removed, ranges);
      markHolds(valid, removed, ranges, cadence);
    }
    const trusted = valid.filter((_, i) => !removed.has(i));
    for (let i = 1; i < trusted.length; i++) {
      const a = trusted[i - 1], b = trusted[i], interval = b.t - a.t;
      const missing = b.index - a.index > 1 && !ranges.some(r => a.x >= r.start && b.x <= r.end);
      if (interval > Math.max(.6, cadence * 2.2) || missing) {
        const window = source.filter(p => p.t >= a.t && p.t <= b.t);
        const controlled = window.length >= 2 && sameInputs(window, 0, window.length - 1, state(a) === 'brake');
        ranges.push({ start: a.x, end: b.x, kind: 'gap', interval,
          confidence: interval > 1.5 || !controlled ? 'low' : 'estimated' });
      }
    }
    const curve = spline(trusted);
    // Keep time-to-track registration at its source knots. A monotone map
    // smooths sub-sample movement without moving any measured landmark.
    const mapPoints = [];
    for (const p of source) {
      const prev = mapPoints[mapPoints.length - 1];
      if (!prev || p.x > prev.t + 1e-10) mapPoints.push({ t: p.x, y: p.t });
    }
    const clock = spline(mapPoints);
    if (!clock) return null;
    const model = { version: 2, field, curve, clock, cadence, gaps: ranges, points: [],
      diagnostics: { sourceSamples: source.length, trustedSamples: trusted.length,
        repairedSamples: removed.size, gaps: ranges.filter(r => r.kind === 'gap').length } };
    // Even repaired packets keep their original display position; all callers
    // use this one evaluator, including hover and delta integration.
    model.points = source.map(p => ({ x: p.x, y: evaluate(model, p.x), time: p.t }));
    return model;
  }

  function evaluate(model, fraction) {
    if (!model) return null;
    const time = evaluateSpline(model.clock, fraction);
    // Missing lap boundaries are not extrapolated: a held endpoint is an
    // estimate, never a manufactured start/finish speed.
    if (time < model.curve.points[0].t || time > model.curve.points[model.curve.points.length - 1].t) return null;
    return evaluateSpline(model.curve, time);
  }

  root.TelemetryReconstruction = Object.freeze({ build, evaluate, spline, evaluateSpline });
})(globalThis);
