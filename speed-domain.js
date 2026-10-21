// Speed-domain car metrics (car_physics.py, `speed_domain` in trace-batch).
// Straight line and braking compare cars at equal speed; cornering times every
// car's measured speed over the same path, without hypothetical entry/exit
// credits. See docs/corner-trace-audit-20261021.md for assumptions and validation.

export const SPEED_DOMAIN_METRICS = Object.freeze({
  corner_low: {label: 'Low-speed corners', unit: ' s', digits: 3, reliability: 'cornering'},
  corner_medium: {label: 'Medium-speed corners', unit: ' s', digits: 3, reliability: 'cornering'},
  corner_high: {label: 'High-speed corners', unit: ' s', digits: 3, reliability: 'cornering'},
  // Several GPs: seconds are not comparable across circuits, % of the time
  // spent in that corner type is.
  corner_low_pct: {label: 'Low-speed corners', unit: '%', digits: 2, reliability: 'cornering'},
  corner_medium_pct: {label: 'Medium-speed corners', unit: '%', digits: 2, reliability: 'cornering'},
  corner_high_pct: {label: 'High-speed corners', unit: '%', digits: 2, reliability: 'cornering'},
  straight: {label: 'Straight line', unit: ' s', digits: 3, reliability: 'straight'},
  straight_mid: {label: '160–250 km/h', unit: ' s', digits: 3, reliability: 'straight_mid'},
  straight_top: {label: '250 km/h and above', unit: ' s', digits: 3, reliability: 'straight_top'},
  traction: {label: 'Traction (corner exit)', unit: ' s', digits: 3, reliability: 'traction'},
  braking: {label: 'Braking distance', unit: '%', digits: 1, reliability: 'braking'},
  energy: {label: 'Speed lost at full throttle', unit: ' km/h', digits: 0, reliability: 'energy'}
});

const finite = value => typeof value === 'number' && Number.isFinite(value);
const median = values => {
  const a = values.filter(finite).sort((x, y) => x-y), i = Math.floor(a.length/2);
  return a.length ? a.length % 2 ? a[i] : (a[i-1]+a[i])/2 : null;
};

// One car's value for one GP, as a deficit: larger is worse.
export function speedDomainValue(car, key) {
  if (!car) return null;
  if (key.startsWith('corner_')) {
    // Seconds per lap (or % of the field's time) lost in this band against
    // the median car, over the same fixed stretch of every corner.
    const pct = key.endsWith('_pct'), band = car.cornering?.[key.slice(7).replace(/_pct$/, '')];
    const value = pct ? band?.pct_vs_median : band?.time_vs_median_s;
    return band && band.index !== null && finite(value) ? value : null;
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

// Equal weight per GP. Entrants measured in fewer than half of the GPs that
// produced this metric stay unranked rather than being compared on a subset.
export function speedDomainSeason(events, subject, key) {
  const perEvent = events
    .map(event => ({event: event.name, values: speedDomainEventValues(event.speedDomain?.[subject], key)}))
    .filter(row => Object.keys(row.values).length);
  const names = [...new Set(perEvent.flatMap(row => Object.keys(row.values)))];
  const minimum = Math.max(1, Math.ceil(perEvent.length/2));
  const rows = names.map(name => {
    const observed = perEvent.filter(row => finite(row.values[name]));
    const values = observed.map(row => row.values[name]);
    const value = values.reduce((s, v) => s+v, 0)/values.length;
    const band = key.startsWith('corner_') ? key.slice(7).replace(/_pct$/, '') : null;
    const provisional = band && events.some(event => observed.some(row => row.event === event.name)
      && event.speedDomain?.[subject]?.cars?.[name]?.cornering?.[band]?.provisional);
    return {name, value: observed.length >= minimum ? value : null, gps: observed.length, provisional: Boolean(provisional),
      missingReason: observed.length >= minimum ? null : `Measured in ${observed.length} of ${perEvent.length} GPs`,
      perEvent: observed.map(row => ({event: row.event, value: row.values[name]}))};
  });
  return {rows, gps: perEvent.length, events: perEvent.map(row => row.event)};
}

// Where the band's time goes: braking, mid-corner and exit seconds per GP,
// each centred on that GP's median entrant and averaged with equal GP weight.
export function speedDomainPhases(events, subject, band) {
  const sums = new Map();
  for (const event of events) {
    const cars = Object.entries(event.speedDomain?.[subject]?.cars || {})
      .map(([name, car]) => [name, car.cornering?.[band]]).filter(([, b]) => b && b.index !== null && b.phases_s);
    if (cars.length < 3) continue;
    const centre = Object.fromEntries(['braking', 'mid', 'exit'].map(k => [k, median(cars.map(([, b]) => b.phases_s[k]))]));
    for (const [name, b] of cars) {
      const row = sums.get(name) || {braking: 0, mid: 0, exit: 0, gps: 0};
      for (const k of ['braking', 'mid', 'exit']) row[k] += b.phases_s[k]-centre[k];
      row.gps++; sums.set(name, row);
    }
  }
  return [...sums].map(([name, r]) => ({name, gps: r.gps, braking: r.braking/r.gps, mid: r.mid/r.gps, exit: r.exit/r.gps}));
}
