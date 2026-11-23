// Speed-domain car metrics (car_physics.py, `speed_domain` in trace-batch).
// Straight line and braking compare cars at equal speed; cornering times every
// car's measured speed over the same path, without hypothetical entry/exit
// credits. See docs/corner-trace-audit-20261021.md for assumptions and validation.

import {avg, finite, matchedRivalScores, median} from './performance-format.js';

export const SPEED_DOMAIN_METRICS = Object.freeze({
  corner_low: {label: 'Low-speed corners', unit: ' s', digits: 3, reliability: 'cornering'},
  corner_medium: {label: 'Medium-speed corners', unit: ' s', digits: 3, reliability: 'cornering'},
  corner_high: {label: 'High-speed corners', unit: ' s', digits: 3, reliability: 'cornering'},
  // Several GPs: seconds are not comparable across circuits, % of the time
  // spent in that corner type is.
  corner_low_pct: {label: 'Low-speed corners', unit: '%', digits: 2, reliability: 'cornering'},
  corner_medium_pct: {label: 'Medium-speed corners', unit: '%', digits: 2, reliability: 'cornering'},
  corner_high_pct: {label: 'High-speed corners', unit: '%', digits: 2, reliability: 'cornering'},
  // Several GPs, as a share of the lap: the same scale as the qualifying gap,
  // so the bands and straights add up towards it.
  corner_low_lap: {label: 'Low-speed corners', unit: '% of lap', digits: 3, reliability: 'cornering'},
  corner_medium_lap: {label: 'Medium-speed corners', unit: '% of lap', digits: 3, reliability: 'cornering'},
  corner_high_lap: {label: 'High-speed corners', unit: '% of lap', digits: 3, reliability: 'cornering'},
  // The track's own straights between timed corners (car_physics.track_straight_timing).
  track_straights: {label: 'Straights', unit: ' s', digits: 3, reliability: 'track_straights'},
  track_straights_pct: {label: 'Straights', unit: '%', digits: 2, reliability: 'track_straights'},
  track_straights_lap: {label: 'Straights', unit: '% of lap', digits: 3, reliability: 'track_straights'},
  straight: {label: 'Straight line', unit: ' s', digits: 3, reliability: 'straight'},
  straight_mid: {label: '160–250 km/h', unit: ' s', digits: 3, reliability: 'straight_mid'},
  straight_top: {label: '250 km/h and above', unit: ' s', digits: 3, reliability: 'straight_top'},
  traction: {label: 'Exit acceleration', unit: ' s', digits: 3, reliability: 'traction'},
  braking: {label: 'Braking distance', unit: '%', digits: 1, reliability: 'braking'},
  energy: {label: 'Speed lost at full throttle', unit: ' km/h', digits: 0, reliability: 'energy'}
});

// One car's value for one GP, as a deficit: larger is worse.
// Seasons in which a metric's car-specific signal measured weaker than the label the backend attaches (RELIABILITY in car_physics.py).
// Braking in 2026: teammate agreement after removing lap time is +0.14 (2025: +0.42; traction, labelled low, fails below about +0.3).
// See docs/physics-validation-20261031.md. The backend label is per metric, not per season, so the season override lives here.
export const LOW_CONFIDENCE_SEASONS = Object.freeze({braking: [2026]});
export function speedDomainIsLowConfidence(year, metricKey, labels) {
  return labels.includes('low') || (LOW_CONFIDENCE_SEASONS[metricKey] || []).includes(Number(year));
}

export function speedDomainValue(car, key) {
  if (!car) return null;
  const section = key.startsWith('corner_') ? car.cornering?.[key.slice(7).replace(/_(pct|lap)$/, '')]
    : key.startsWith('track_straights') ? car.track_straights : undefined;
  if (section !== undefined) {
    // Seconds per lap lost in this corner band (or on the straights) against
    // the median car; or that as % of the section's own time (_pct), or of
    // the field's lap time (_lap).
    if (!section || section.index === null) return null;
    const value = key.endsWith('_pct') ? section.pct_vs_median
      : key.endsWith('_lap') ? (finite(section.time_vs_median_s) && finite(car.field_lap_time_s) && car.field_lap_time_s > 0 ? section.time_vs_median_s/car.field_lap_time_s*100 : null)
      : section.time_vs_median_s;
    return finite(value) ? value : null;
  }
  if (key === 'braking') return finite(car.braking?.gap_pct) ? car.braking.gap_pct : null;
  if (key === 'energy') return finite(car.energy?.fade_kmh) ? car.energy.fade_kmh : null;
  const value = car[key]?.gap_to_median_s;
  return finite(value) && car[key]?.index !== null ? value : null;
}

// Per-GP values relative to that GP's median entrant, so a season mean is not
// skewed by which rivals happened to be measured; the chart rebases to best.
export function speedDomainEventValues(result, key) {
  const raw = Object.entries(result?.cars || {}).map(([name, car]) => [name, speedDomainValue(car, key)]).filter(([, v]) => finite(v));
  if (raw.length < 3) return {};
  const centre = median(raw.map(([, v]) => v));
  return Object.fromEntries(raw.map(([name, v]) => [name, v-centre]));
}

function sharedWeekendCohort(perEvent) {
  const names = [...new Set(perEvent.flatMap(row => Object.keys(row.values)))];
  const minimum = Math.max(1, Math.ceil(perEvent.length/2));
  const observed = new Map(names.map(name => [name, perEvent.filter(row => Object.hasOwn(row.values,name))]));
  const eligible = names.filter(name => observed.get(name).length >= minimum);
  const shared = eligible.length < 2 ? [] : perEvent.filter(row => eligible.every(name => Object.hasOwn(row.values,name)));
  return {observed, minimum, eligible, shared};
}

// Keep expanded inputs separate from older single-lap snapshots.
function chooseSampleCohort(rows) {
  const repeat = rows.filter(row => row.samplePolicy === 'repeat');
  const single = rows.filter(row => row.samplePolicy !== 'repeat');
  if (repeat.length && repeat.length >= single.length) return {used: repeat, policy: 'repeat', other: single.length};
  return {used: single, policy: 'single', other: repeat.length};
}

// Equal weight per shared GP. The half-calendar requirement applies both to
// each entrant and to the common set or each directly measured rival pair.
export function speedDomainSeason(events, subject, key) {
  const supported = events
    .map(event => ({event: event.name, samplePolicy: event.speedDomain?.[subject]?.samplePolicy,
      values: speedDomainEventValues(event.speedDomain?.[subject], key)}))
    .filter(row => Object.keys(row.values).length);
  const {used: perEvent, policy: samplePolicy, other: otherPolicyGPs} = chooseSampleCohort(supported);
  const {observed, eligible, minimum, shared} = sharedWeekendCohort(perEvent);
  const matched = shared.length < minimum && perEvent.length >= 4
    ? matchedRivalScores(eligible.map(name=>new Map(observed.get(name).map(row=>[row.event,row.values[name]]))),minimum) : null;
  const rivalValues = new Map(matched ? eligible.map((name,i)=>[name,matched.values[i]]) : []);
  const sharedEvents = new Set(shared.map(row => row.event));
  const rows = [...observed].map(([name, observations]) => {
    const value = matched ? rivalValues.get(name) ?? null : observations.length >= minimum && shared.length >= minimum
      ? avg(shared.map(row => row.values[name])) : null;
    const band = key.startsWith('corner_') ? key.slice(7).replace(/_(pct|lap)$/, '') : null;
    const section = car => band ? car?.cornering?.[band] : key.startsWith('track_straights') ? car?.track_straights : null;
    const evidence = matched ? new Set(observations.map(row => row.event)) : sharedEvents;
    const provisional = events.some(event => evidence.has(event.name)
      && section(event.speedDomain?.[subject]?.cars?.[name])?.provisional);
    return {name, value, gps: observations.length, provisional: Boolean(provisional),
      missingReason: finite(value) ? null : observations.length < minimum ? `Measured in ${observations.length} of ${perEvent.length} GPs`
        : `Insufficient overlap: ${shared.length} shared GPs of ${perEvent.length} supported`,
      perEvent: observations.map(row => ({event: row.event, value: row.values[name]}))};
  });
  return {rows, sharedEvents: [...sharedEvents], gps: perEvent.length, events: perEvent.map(row => row.event), samplePolicy, otherPolicyGPs,
    rivalOverlap: matched?.overlap || null};
}

// A scatter point uses the same cars and weekends on both axes. Even if
// each band has a ranking, those band rankings can use different calendars.
export function speedDomainTradeOff(events, several) {
  const suffix = several ? '_lap' : '';
  const supported = events.map(event => {
    const values = Object.fromEntries(Object.entries(event.speedDomain?.team?.cars || {}).flatMap(([name, car]) => {
      const straight = speedDomainValue(car, 'track_straights'+suffix);
      const corners = ['low','medium','high'].map(band => speedDomainValue(car, 'corner_'+band+suffix));
      return finite(straight) && corners.every(finite)
        ? [[name, {straight, corner: corners.reduce((total,value) => total+value,0)}]] : [];
    }));
    return {event: event.name, samplePolicy: event.speedDomain?.team?.samplePolicy, values};
  }).filter(row => Object.keys(row.values).length >= 3);
  const {used: perEvent} = chooseSampleCohort(supported);
  const {observed, minimum, eligible, shared} = sharedWeekendCohort(perEvent);
  if (eligible.length < 3) return {rows: [], shared: shared.length};
  if (shared.length < minimum) {
    if (perEvent.length < 4) return {rows: [], shared: shared.length};
    const axis = key => matchedRivalScores(eligible.map(name=>new Map(observed.get(name)
      .map(row=>[row.event,row.values[name][key]]))),minimum);
    const straights=axis('straight'), corners=axis('corner');
    if (!straights || !corners) return {rows: [], shared: shared.length};
    return {rows: eligible.map((name,i)=>({name,x:straights.values[i],y:corners.values[i]})),
      shared: shared.length, rivalOverlap: straights.overlap};
  }
  const average = (name, key) => shared.reduce((total,row) => total+row.values[name][key],0)/shared.length;
  return {rows: eligible.map(name => ({name,x:average(name,'straight'),y:average(name,'corner')})), shared: shared.length};
}

// Where the band's time goes: braking, mid-corner and exit seconds per GP,
// each centred on that GP's median entrant and averaged with equal GP weight.
export function speedDomainPhases(events, subject, band) {
  const sums = new Map();
  const supported = [];
  for (const event of events) {
    const cars = Object.entries(event.speedDomain?.[subject]?.cars || {})
      // A car is in the breakdown only with all three phases measured. A missing one is not zero seconds.
      .map(([name, car]) => [name, car.cornering?.[band]]).filter(([, b]) => b && b.index !== null && ['braking', 'mid', 'exit'].every(k => finite(b.phases_s?.[k])));
    if (cars.length < 3) continue;
    supported.push({cars, samplePolicy: event.speedDomain?.[subject]?.samplePolicy});
  }
  for (const {cars} of chooseSampleCohort(supported).used) {
    const centre = Object.fromEntries(['braking', 'mid', 'exit'].map(k => [k, median(cars.map(([, b]) => b.phases_s[k]))]));
    for (const [name, b] of cars) {
      const row = sums.get(name) || {braking: 0, mid: 0, exit: 0, gps: 0};
      for (const k of ['braking', 'mid', 'exit']) row[k] += b.phases_s[k]-centre[k];
      row.gps++; sums.set(name, row);
    }
  }
  return [...sums].map(([name, r]) => ({name, gps: r.gps, braking: r.braking/r.gps, mid: r.mid/r.gps, exit: r.exit/r.gps}));
}
