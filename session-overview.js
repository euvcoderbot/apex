/* Session overview and "where the time went".

   Overview (above the telemetry): a readout of the loaded session (fastest lap, best ideal lap, best execution, most time
   left on the table, top speed trap) and a lap chart: lap time against lap number for the chosen drivers (or the top three),
   where clicking a point adds that lap to the comparison, as the lap list does.

   Where the time went (under the sector times): for each compared lap against the reference, the corners and straights where
   it lost and gained the most, measured as elapsed time over the same distance windows the corner analysis uses. The windows
   come from the reference lap's corners (adaptiveCornerZones / sessionPerformanceZones), so every lap is measured over the
   same stretch of track.

   Classic script: uses the session globals (realDrivers, loaded, selected, telemetryCache...) at call time only. */
(() => {
  const SVG = 'http://www.w3.org/2000/svg';
  const esc = value => (typeof escapeUI === 'function' ? escapeUI(value) : String(value ?? ''));
  const fmtLap = t => (typeof time === 'function' ? time(t) : `${t.toFixed(3)}`);
  const signedS = v => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(3)} s`;
  let showSlowLaps = false, renderedOverview = '', drawnWidth = 0;
  // Charts are drawn at the card's real pixel width (16 px padding each side), so an 11 px label stays 11 px on any screen.
  // Phones get at least 560 px and scroll inside the card.
  const chartWidth = () => {
    const root = document.getElementById('sessionOverview');
    const inner = (root?.clientWidth || 672) - 34;
    return Math.round(Math.max(innerWidth <= 600 ? 560 : 320, inner));
  };

  // A lap that counts as a representative timed lap: timed, not deleted, not a pit in- or out-lap.
  const timed = lap => Number.isFinite(lap?.time) && lap.time > 0 && !lap.deleted && !lap.in_lap && !lap.out_lap;
  const bestOf = (laps, field) => { const v = laps.map(l => l[field]).filter(x => Number.isFinite(x) && x > 0); return v.length ? Math.min(...v) : null; };

  /** Per driver: best lap, ideal lap (sum of their best sectors), best speed trap. Exported for tests. */
  function driverSummary(driver) {
    const laps = (driver.laps || []).filter(l => !l.deleted);
    const best = bestOf(laps.filter(timed), 'time');
    const sectors = ['s1', 's2', 's3'].map(f => bestOf(laps, f));
    const ideal = sectors.every(Number.isFinite) ? sectors.reduce((a, b) => a + b, 0) : null;
    const trap = bestOf(laps, 'speed_st') && Math.max(...laps.map(l => l.speed_st).filter(Number.isFinite));
    // The ideal can only be at or below the best lap; a gap above a second means the sector bests came from different
    // conditions (or a mis-timed sector) and is not a fair "time left" figure.
    const left = Number.isFinite(best) && Number.isFinite(ideal) && best - ideal >= -0.0005 && best - ideal < 1 ? Math.max(0, best - ideal) : null;
    return {code: driver.code, team: driver.team, number: driver.number, best, ideal, trap: Number.isFinite(trap) ? trap : null, left};
  }

  function readout(rows) {
    const pick = (key, better) => rows.filter(r => Number.isFinite(r[key])).sort((a, b) => better(a[key], b[key]))[0];
    const fastest = pick('best', (a, b) => a - b);
    const ideal = pick('ideal', (a, b) => a - b);
    // Execution only among drivers within 2% of the fastest lap: a slow car's tidy lap is not the session's best execution.
    const quick = rows.filter(r => Number.isFinite(r.left) && fastest && r.best <= fastest.best * 1.02);
    const execution = quick.sort((a, b) => a.left - b.left)[0];
    const leftOver = rows.filter(r => Number.isFinite(r.left)).sort((a, b) => b.left - a.left)[0];
    const trap = pick('trap', (a, b) => b - a);
    const tile = (label, row, value, note) => row ? `<div class="overview-tile"><small>${label}</small><b>${esc(value)}</b><span>${teamLogoMarkup(row.team, row.number)}${esc(row.code)}${note ? `<em>${esc(note)}</em>` : ''}</span></div>` : '';
    return [
      tile('Fastest lap', fastest, fastest && fmtLap(fastest.best)),
      tile('Best ideal lap', ideal, ideal && fmtLap(ideal.ideal), 'sum of best sectors'),
      tile('Best execution', execution, execution && signedS(execution.left).replace('+', ''), 'best lap to ideal'),
      tile('Most time left', leftOver, leftOver && signedS(leftOver.left).replace('+', ''), leftOver && `ideal ${fmtLap(leftOver.ideal)}`),
      tile('Top speed trap', trap, trap && `${Math.round(trap.trap)} km/h`),
    ].join('');
  }

  // Teammates share a team colour: the second driver of a colour in a chart is drawn dashed with hollow points, so the two
  // can be told apart without leaving the team's colour (identity) for something arbitrary. A colour picked from a legend
  // dot (chartColours) replaces the team colour for that driver, and then the line is solid.
  const chartColours = new Map();
  const colourOf = code => chartColours.get(code) || getDriverColor(code);
  function styleFor(codes) {
    const seen = new Set(), out = new Map();
    for (const code of codes) { const c = colourOf(code); out.set(code, {colour: c, dashed: seen.has(c)}); seen.add(c); }
    return out;
  }
  // A legend entry: the dot is a colour picker (the native input sits on top of it, invisible), the name says who.
  const legendItem = (code, style) => `<span class="overview-legend-item"><label class="overview-swatch${style.dashed ? ' is-dashed' : ''}" style="--c:${esc(style.colour)}" title="Change ${esc(code)}’s colour"><input type="color" value="${esc(toHex(style.colour))}" data-chart-colour="${esc(code)}" aria-label="Change ${esc(code)}’s chart colour"></label>${esc(code)}</span>`;
  function toHex(colour) {
    if (/^#[0-9a-f]{6}$/i.test(colour)) return colour;
    if (/^#[0-9a-f]{3}$/i.test(colour)) return '#' + [...colour.slice(1)].map(c => c + c).join('');
    const m = String(colour).match(/rgba?\((\d+)[ ,]+(\d+)[ ,]+(\d+)/);
    return m ? '#' + m.slice(1, 4).map(v => Number(v).toString(16).padStart(2, '0')).join('') : '#777777';
  }

  // Slow laps (hidden unless asked for): over 107% of the driver's best lap on the same kind of tyre (intermediates and
  // wets against the best wet-tyre lap, slicks against the best slick lap). In a race a lap must also be over 107% of the
  // fastest lap anyone set on that lap, so laps everyone ran slowly (rain arriving on slicks, a drying track) stay; a
  // safety car, red flag or virtual safety car always counts as slow.
  const tyreKind = lap => (/INTER|WET/i.test(String(lap.compound || '')) ? 'wet' : 'slick');
  const isPit = lap => Boolean(lap.in_lap || lap.out_lap);
  const neutralised = lap => /[4567]/.test(String(lap.track_status || '')) || /^(SC|VSC|RED)$/.test(lap.neutralised || '');
  let fieldBest = null;   // lap number -> fastest timed lap of the race on that lap; rebuilt each render
  function representative(laps) {
    const best = {wet: bestOf(laps.filter(l => tyreKind(l) === 'wet'), 'time'), slick: bestOf(laps.filter(l => tyreKind(l) === 'slick'), 'time')};
    return lap => {
      if (lap.time <= (best[tyreKind(lap)] ?? Infinity) * 1.07) return true;
      if (!fieldBest || neutralised(lap)) return false;
      return lap.time <= (fieldBest.get(lap.lap) ?? Infinity) * 1.07;
    };
  }

  // ---------- hover readout shared by the three charts ----------
  // Each chart registers, per lap, a line for every driver shown; hovering anywhere over the plot picks the nearest lap,
  // draws a guide line there and lists the values, sorted as the chart reads (fastest, nearest the leader, best place first).
  const hoverCharts = new Map();
  function registerHover(id, spec) { hoverCharts.set(id, spec); return `data-hover="${id}"`; }

  // ---------- lap chart ----------
  function chartDrivers() {
    const chosen = selected.filter(code => realDrivers.has(code));
    if (chosen.length) return chosen.slice(0, 6);
    return [...realDrivers.values()].filter(d => Number.isFinite(d.position)).sort((a, b) => a.position - b.position).slice(0, 3).map(d => d.code);
  }

  function lapChart() {
    const codes = chartDrivers();
    fieldBest = null;
    if (/^(race|sprint)$/i.test(loadedSessionName || '')) {
      fieldBest = new Map();
      for (const d of realDrivers.values()) for (const l of (d.laps || []).filter(timed)) if (!(fieldBest.get(l.lap) <= l.time)) fieldBest.set(l.lap, l.time);
    }
    const styles = styleFor(codes);
    const series = codes.map(code => {
      // Every lap with a time is a candidate. The driver's bests come from representative laps only. In a race the pit
      // in- and out-laps are always drawn, so a stop never breaks the line; the scale is set by the other laps and a pit
      // lap beyond it sits on the top edge (marked, with its real time in the hover card).
      const d = realDrivers.get(code), laps = (d?.laps || []).filter(l => Number.isFinite(l?.time) && l.time > 0 && !l.deleted);
      const keep = representative(laps.filter(timed));
      return {code, colour: styles.get(code).colour, dashed: styles.get(code)?.dashed, laps: laps.filter(l => showSlowLaps || keep(l) || (fieldBest && isPit(l)))};
    }).filter(s => s.laps.length);
    if (!series.length) return '<p class="section-empty">No timed laps for these drivers.</p>';
    const all = series.flatMap(s => s.laps);
    const scaled = showSlowLaps || !fieldBest ? all : all.filter(l => !isPit(l));
    const lapLo = Math.min(...all.map(l => l.lap)), lapHi = Math.max(...all.map(l => l.lap));
    const tLo = Math.min(...(scaled.length ? scaled : all).map(l => l.time)), tHi = Math.max(...(scaled.length ? scaled : all).map(l => l.time));
    // Round second ticks that enclose the data.
    const span = Math.max(0.5, tHi - tLo), step = [0.25, 0.5, 1, 2, 5, 10, 20].find(s => span / s <= 5) || 30;
    const yLo = Math.floor(tLo / step) * step, yHi = Math.ceil(tHi / step) * step;
    const W = chartWidth(), H = 240, L = 48, R = 12, T = 10, B = 26;
    const x = lap => L + (lapHi === lapLo ? (W - L - R) / 2 : (lap - lapLo) / (lapHi - lapLo) * (W - L - R));
    const y = t => T + (yHi - Math.min(t, yHi)) / ((yHi - yLo) || 1) * (H - T - B);
    const hover = registerHover('laps', {W, H, L, R, T, B, lapLo, lapHi, title: lap => `Lap ${lap}`, rows: lap => series.map(s => {
      const l = s.laps.find(z => z.lap === lap);
      return l && {code: s.code, colour: s.colour, hollow: s.dashed, value: l.time, text: `${fmtLap(l.time)}${l.compound && l.compound !== 'UNKNOWN' ? ` · ${String(l.compound).charAt(0)}${Number.isFinite(l.tyre_life) ? ` ${l.tyre_life}` : ''}` : ''}${l.in_lap ? ' · pit in' : l.out_lap ? ' · pit out' : ''}`};
    }).filter(Boolean).sort((a, b) => a.value - b.value)});
    // Many laps: small points (full size on hover) so overlapping lines stay readable.
    const dense = (W - L - R) / Math.max(1, lapHi - lapLo) < 16;
    let svg = `<svg class="overview-lap-chart${dense ? ' is-dense' : ''}" ${hover} viewBox="0 0 ${W} ${H}" role="group" aria-label="Lap times by lap for ${esc(codes.join(', '))}">`;  // a group: its lap points are buttons
    // Tick labels carry only the decimals the step needs: 1:16 for whole seconds, 1:16.5 for halves, 1:16.25 for quarters.
    const decimals = step >= 1 ? 0 : step >= .5 ? 1 : 2;
    const tick = t => { const m = Math.floor(t / 60), sec = t - m * 60; return `${m}:${sec.toFixed(decimals).padStart(decimals ? 3 + decimals : 2, '0')}`; };
    for (let t = yLo; t <= yHi + 1e-9; t += step) svg += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"/><text class="axis" x="${L - 8}" y="${(y(t) + 3.5).toFixed(1)}" text-anchor="end">${esc(tick(t))}</text>`;
    const lapStep = Math.max(1, Math.ceil((lapHi - lapLo) / 10));
    for (let lap = lapLo; lap <= lapHi; lap += lapStep) svg += `<text class="axis" x="${x(lap).toFixed(1)}" y="${H - 8}" text-anchor="middle">${lap}</text>`;
    for (const s of series) {
      const pts = s.laps.map(l => `${x(l.lap).toFixed(1)},${y(l.time).toFixed(1)}`).join(' ');
      svg += `<polyline class="line${s.dashed ? ' is-dashed' : ''}" points="${pts}" style="stroke:${esc(s.colour)}"/>`;
      for (const l of s.laps) {
        const isLoaded = loaded.some(item => item.code === s.code && item.lap === l.lap);
        if (l.time > yHi + 1e-9) {
          // Off the scale (a pit lap): a small triangle on the top edge pointing up.
          const px = x(l.lap), py = y(yHi);
          svg += `<path class="point is-off-scale${s.dashed ? ' is-hollow' : ''}" style="--c:${esc(s.colour)}" d="M${(px - 3.5).toFixed(1)} ${(py + 3).toFixed(1)}L${px.toFixed(1)} ${(py - 2.5).toFixed(1)}L${(px + 3.5).toFixed(1)} ${(py + 3).toFixed(1)}Z" data-code="${esc(s.code)}" data-lap="${l.lap}" tabindex="0" role="button" aria-label="${esc(`${s.code} lap ${l.lap}, ${fmtLap(l.time)}, ${l.in_lap ? 'pit in-lap' : l.out_lap ? 'pit out-lap' : 'off the scale'}. Select to compare`)}"/>`;
          continue;
        }
        svg += `<circle class="point${isLoaded ? ' is-loaded' : ''}${s.dashed ? ' is-hollow' : ''}" style="--c:${esc(s.colour)}" cx="${x(l.lap).toFixed(1)}" cy="${y(l.time).toFixed(1)}" r="${isLoaded ? 5 : 3.5}" data-code="${esc(s.code)}" data-lap="${l.lap}" tabindex="0" role="button" aria-label="${esc(`${s.code} lap ${l.lap}, ${fmtLap(l.time)}${l.compound ? `, ${l.compound}` : ''}. ${isLoaded ? 'In the comparison; select to remove' : 'Select to compare'}`)}"/>`;
      }
    }
    svg += '</svg>';
    const legend = series.map(s => legendItem(s.code, styles.get(s.code))).join('');
    return `<div class="overview-legend">${legend}<button type="button" class="overview-slow-toggle" aria-pressed="${showSlowLaps}">${showSlowLaps ? 'Hide slow laps' : 'Show slow laps'}</button></div>${svg}
      <p class="overview-note">${selected.length ? 'The drivers chosen in the list' : 'With no driver chosen in the list, the top three finishers'}; laps over 107% of a driver’s best on the same kind of tyre (slick or wet)${fieldBest ? ', and of the fastest lap anyone set on that lap,' : ''} are ${showSlowLaps ? 'shown' : 'hidden'}${fieldBest ? '; pit stops are always drawn, a ▲ on the top edge when off the scale' : ''}. Select a point to add that lap to the comparison; select a colour dot to change a driver’s colour.</p>`;
  }

  // End labels (docs/linear-components.md, Chart): the driver code in its colour, at least 13 px apart.
  function endKey(entries, labelX) {
    const list = [...entries].sort((a, b) => a.y - b.y);
    list.forEach((e, i) => { e.ly = i ? Math.max(e.y, list[i - 1].ly + 13) : e.y; });
    return list.map(e => `<text class="label" style="fill:${e.colour}" x="${(labelX + 4).toFixed(1)}" y="${(e.ly + 3.5).toFixed(1)}">${esc(e.code)}</text>`).join('');
  }

  // ---------- race: gap to the leader and position, lap by lap ----------
  // When each driver finished each lap, on the session clock: the lap's own end, or the next lap's start.
  function lapEnds(driver) {
    const laps = [...(driver.laps || [])].sort((x, y) => x.lap - y.lap), out = new Map();
    laps.forEach((l, i) => {
      const end = Number.isFinite(l.lap_end_seconds) ? l.lap_end_seconds : Number.isFinite(laps[i + 1]?.lap_start_seconds) && laps[i + 1].lap === l.lap + 1 ? laps[i + 1].lap_start_seconds : null;
      if (Number.isFinite(end)) out.set(l.lap, end);
    });
    return out;
  }
  /** {laps, rows: [{code, gaps: Map(lap -> s behind the leader), positions: Map(lap -> place)}]}. Exported for tests. */
  function raceProgress(driverList) {
    const ends = driverList.map(d => ({code: d.code, ends: lapEnds(d)}));
    const maxLap = Math.max(0, ...ends.flatMap(e => [...e.ends.keys()]));
    const rows = ends.map(e => ({code: e.code, gaps: new Map(), positions: new Map()}));
    for (let lap = 1; lap <= maxLap; lap++) {
      // Running order at the line: more laps first is implicit (only drivers who completed this lap are ranked).
      const done = ends.map((e, i) => [i, e.ends.get(lap)]).filter(([, t]) => Number.isFinite(t)).sort((x, y) => x[1] - y[1]);
      if (!done.length) continue;
      const leader = done[0][1];
      done.forEach(([i, t], place) => { rows[i].gaps.set(lap, t - leader); rows[i].positions.set(lap, place + 1); });
    }
    return {laps: maxLap, rows};
  }

  function raceCharts() {
    if (!/^(race|sprint)$/i.test(loadedSessionName || '')) return '';
    const progress = raceProgress([...realDrivers.values()]);
    if (progress.laps < 2) return '';
    const codes = chartDrivers();
    const shown = progress.rows.filter(r => codes.includes(r.code));
    const styles = styleFor(codes);
    const W = chartWidth(), L = 58, R = 40, T = 10, B = 24;
    const x = lap => L + (lap - 1) / Math.max(1, progress.laps - 1) * (W - L - R);
    const lapAxis = H => { let out = ''; const step = Math.max(1, Math.ceil(progress.laps / 12)); for (let lap = 1; lap <= progress.laps; lap += step) out += `<text class="axis" x="${x(lap).toFixed(1)}" y="${H - 7}" text-anchor="middle">${lap}</text>`; return out; };
    const path = (map, y) => { let d = '', open = false; for (let lap = 1; lap <= progress.laps; lap++) { const v = map.get(lap); if (v == null) { open = false; continue; } d += `${open ? 'L' : 'M'}${x(lap).toFixed(1)} ${y(v).toFixed(1)}`; open = true; } return d; };
    // Gap to the leader: the leader on the top line; capped at 60 s so one lapped car does not flatten the rest.
    const H1 = 220, cap = Math.min(60, Math.max(5, ...shown.flatMap(r => [...r.gaps.values()]).filter(Number.isFinite)));
    const step1 = [1, 2, 5, 10, 20].find(st => cap / st <= 6) || 30, top1 = Math.ceil(cap / step1) * step1;
    const y1 = v => T + Math.min(v, top1) / top1 * (H1 - T - B);
    const span = {W, L, R, T, B, lapLo: 1, lapHi: progress.laps, title: lap => `Lap ${lap}`};
    const gapHover = registerHover('gap', {...span, H: H1, rows: lap => shown.map(r => r.gaps.has(lap) && {code: r.code, colour: colourOf(r.code), hollow: styles.get(r.code)?.dashed, value: r.gaps.get(lap), text: r.gaps.get(lap) < .0005 ? 'Leader' : `+${r.gaps.get(lap).toFixed(3)} s`}).filter(Boolean).sort((a, b) => a.value - b.value)});
    const gapKeys = [], posKeys = [];
    let gap = `<svg class="overview-lap-chart" ${gapHover} viewBox="0 0 ${W} ${H1}" role="img" aria-label="Gap to the race leader by lap">`;
    for (let v = 0; v <= top1 + 1e-9; v += step1) gap += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y1(v).toFixed(1)}" y2="${y1(v).toFixed(1)}"/><text class="axis" x="${L - 6}" y="${(y1(v) + 3.5).toFixed(1)}" text-anchor="end">${v ? `+${v}s` : 'Leader'}</text>`;
    for (const r of shown) {
      const colour = esc(colourOf(r.code)), last = [...r.gaps.entries()].at(-1), dash = styles.get(r.code)?.dashed ? ' is-dashed' : '';
      gap += `<path class="line is-solid${dash}" d="${path(r.gaps, y1)}" style="stroke:${colour}"/>`;
      if (last) gapKeys.push({code: r.code, colour, x: x(last[0]), y: y1(last[1])});
    }
    gap += endKey(gapKeys, W - R + 2) + lapAxis(H1) + '</svg>';
    // Position by lap, every driver in the session, the chosen ones in full colour.
    const n = progress.rows.length, H2 = Math.max(200, n * 12 + T + B);
    const y2 = p => T + (p - 1) / Math.max(1, n - 1) * (H2 - T - B);
    const posHover = registerHover('position', {...span, H: H2, rows: lap => shown.map(r => r.positions.has(lap) && {code: r.code, colour: colourOf(r.code), hollow: styles.get(r.code)?.dashed, value: r.positions.get(lap), text: `P${r.positions.get(lap)}`}).filter(Boolean).sort((a, b) => a.value - b.value)});
    let pos = `<svg class="overview-lap-chart" ${posHover} viewBox="0 0 ${W} ${H2}" role="img" aria-label="Position by lap">`;
    for (const p of [1, 5, 10, 15, 20].filter(p => p <= n)) pos += `<text class="axis" x="${L - 6}" y="${(y2(p) + 3.5).toFixed(1)}" text-anchor="end">P${p}</text>`;
    for (const r of [...progress.rows].sort((a, b) => codes.includes(a.code) - codes.includes(b.code))) {
      const colour = esc(codes.includes(r.code) ? colourOf(r.code) : getDriverColor(r.code)), chosen = codes.includes(r.code), last = [...r.positions.entries()].at(-1);
      pos += `<path class="line is-solid${chosen ? (styles.get(r.code)?.dashed ? ' is-dashed' : '') : ' is-faint'}" d="${path(r.positions, y2)}" style="stroke:${colour}"/>`;
      if (last && chosen) posKeys.push({code: r.code, colour, x: x(last[0]), y: y2(last[1])});
    }
    pos += endKey(posKeys, W - R + 2) + lapAxis(H2) + '</svg>';
    return `<div class="overview-chart"><h3>Gap to the leader</h3>${gap}<p class="overview-note">Time behind the car leading at the line on each lap, from when each lap ended on the session clock; capped at ${top1} s.</p></div>
      <div class="overview-chart"><h3>Position by lap</h3>${pos}</div>`;
  }

  function renderSessionOverview() {
    const root = document.getElementById('sessionOverview');
    if (!root) return;
    if (!realDrivers?.size) { root.hidden = true; root.innerHTML = ''; renderedOverview = ''; return; }
    root.hidden = false;
    const rows = [...realDrivers.values()].map(driverSummary);
    // Rendered from many places (every renderAll): replace the markup only when it changed, so a point being clicked is
    // never swapped out between mouse down and up.
    const html = `<div class="section-heading analysis-heading"><h2 id="sessionOverviewTitle">Session overview</h2></div>
      <div class="overview-readout">${readout(rows)}</div>
      <div class="overview-chart"><h3>Lap times</h3>${lapChart()}</div>${raceCharts()}`;
    if (renderedOverview !== html || !root.firstChild) { root.innerHTML = html; renderedOverview = html; }
    drawnWidth = chartWidth();
  }

  // ---------- where the time went ----------
  function timeBreakdown(referenceSamples, samples, zones) {
    return zones.filter(z => z.end > z.start && z.kind !== 'transition').map(z => {
      const ref = performanceSectionDuration(referenceSamples, z.start, z.end), own = performanceSectionDuration(samples, z.start, z.end);
      return Number.isFinite(ref) && Number.isFinite(own) ? {label: z.kind === 'corner' ? cornerLabel(z) : (z.label || '').replace(/^Straight /, ''), kind: z.kind, delta: own - ref} : null;
    }).filter(Boolean);
  }

  function renderTimeSummary() {
    let root = document.getElementById('timeSummary');
    const sectors = document.querySelector('.sector-times');
    if (!root && sectors) { root = document.createElement('div'); root.id = 'timeSummary'; root.className = 'time-summary'; sectors.after(root); }
    if (!root) return;
    const reference = loaded[0] && telemetryCache.get(telemetryKey(loaded[0]));
    if (loaded.length < 2 || !reference?.length || typeof adaptiveCornerZones !== 'function') { root.hidden = true; root.innerHTML = ''; return; }
    const totalDistance = reference[reference.length - 1].Distance || 1;
    const zones = sessionPerformanceZones(adaptiveCornerZones(resolveCornerMarkers(reference, totalDistance, loaded[0].cornerMarkers)), totalDistance);
    const cards = loaded.slice(1).map(lap => {
      const samples = telemetryCache.get(telemetryKey(lap));
      if (!samples?.length || lap.real?.out_lap || loaded[0].real?.out_lap) return '';
      const parts = timeBreakdown(reference, samples, zones);
      if (!parts.length) return '';
      const losses = parts.filter(p => p.delta > 0.005).sort((a, b) => b.delta - a.delta).slice(0, 3);
      const gains = parts.filter(p => p.delta < -0.005).sort((a, b) => a.delta - b.delta).slice(0, 3);
      const corners = parts.filter(p => p.kind === 'corner').reduce((a, p) => a + p.delta, 0);
      const straights = parts.filter(p => p.kind === 'straight').reduce((a, p) => a + p.delta, 0);
      const list = (items, cls) => items.length ? items.map(p => `<li class="${cls}"><b>${esc(p.label)}</b><span>${signedS(p.delta)}</span></li>`).join('') : '<li class="is-none">None over 0.005 s</li>';
      return `<article class="time-summary-card" style="--team:${esc(getLapColor(lap))}">
        <header><b>${esc(lap.code)}</b> L${lap.lap} vs ${esc(loaded[0].code)} L${loaded[0].lap}<span>Corners ${signedS(corners)} · Straights ${signedS(straights)}</span></header>
        <div class="time-summary-lists"><div><small>Loses most</small><ol>${list(losses, 'is-loss')}</ol></div><div><small>Gains most</small><ol>${list(gains, 'is-gain')}</ol></div></div>
      </article>`;
    }).filter(Boolean);
    root.hidden = !cards.length;
    root.innerHTML = cards.length ? `<h3>Where the time went</h3>${cards.join('')}<p class="overview-note">Elapsed time over the same corner and straight windows of the reference lap. Short links between corners are left out, so the parts do not add up exactly to the lap gap.</p>` : '';
  }

  // Bound on the section itself: page-level handlers elsewhere stop some clicks before they reach the document.
  const host = document.getElementById('sessionOverview') || document;
  host.addEventListener('click', event => {
    const point = event.target.closest?.('#sessionOverview .point');
    if (point) { toggleLoadedLap(point.dataset.code, Number(point.dataset.lap)); return; }
    if (event.target.closest?.('#sessionOverview .overview-slow-toggle')) { showSlowLaps = !showSlowLaps; renderSessionOverview(); }
  });
  host.addEventListener('change', event => {
    const input = event.target.closest?.('#sessionOverview input[data-chart-colour]');
    if (input) { chartColours.set(input.dataset.chartColour, input.value); renderSessionOverview(); }
  });
  // The hover card: nearest lap under the pointer, a guide line on that lap and the values of every driver shown.
  let tip = null;
  const hideHover = () => { if (tip) tip.hidden = true; host.querySelectorAll?.('.hover-guide').forEach(g => g.remove()); };
  const showHover = event => {
    const svg = event.target.closest?.('#sessionOverview svg[data-hover]'), spec = svg && hoverCharts.get(svg.dataset.hover);
    if (!spec) { hideHover(); return; }
    const box = svg.getBoundingClientRect(), vx = (event.clientX - box.left) * spec.W / box.width;
    const span = spec.W - spec.L - spec.R, laps = spec.lapHi - spec.lapLo;
    const lap = Math.round(spec.lapLo + Math.min(1, Math.max(0, (vx - spec.L) / span)) * laps);
    const rows = spec.rows(lap);
    if (!rows.length) { hideHover(); return; }
    const gx = spec.L + (laps ? (lap - spec.lapLo) / laps * span : span / 2);
    let guide = svg.querySelector('.hover-guide');
    if (!guide) { guide = document.createElementNS(SVG, 'line'); guide.setAttribute('class', 'hover-guide'); svg.prepend(guide); }
    for (const [k, v] of Object.entries({x1: gx, x2: gx, y1: spec.T, y2: spec.H - spec.B})) guide.setAttribute(k, v.toFixed(1));
    if (!tip) { tip = document.createElement('div'); tip.className = 'tooltip overview-tip'; tip.setAttribute('role', 'tooltip'); document.body.append(tip); }
    tip.innerHTML = `<b>${esc(spec.title(lap))}</b>${rows.map(r => `<span><i class="${r.hollow ? 'is-hollow' : ''}" style="--c:${esc(r.colour)}"></i>${esc(r.code)}<em>${esc(r.text)}</em></span>`).join('')}`;
    tip.hidden = false;
    const w = tip.offsetWidth, h = tip.offsetHeight, px = box.left + gx * box.width / spec.W;
    tip.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, px + 14 + w > innerWidth - 8 ? px - 14 - w : px + 14))}px`;
    tip.style.top = `${Math.min(innerHeight - h - 8, Math.max(8, event.clientY - h / 2))}px`;
  };
  host.addEventListener('pointermove', showHover);
  host.addEventListener('focusin', event => {
    const point = event.target.closest?.('#sessionOverview .point');
    if (!point) return;
    const box = point.getBoundingClientRect(); showHover({target: point, clientX: box.left + box.width / 2, clientY: box.top});
  });
  host.addEventListener('focusout', hideHover);
  host.addEventListener('pointerleave', hideHover);
  host.addEventListener('keydown', event => {
    if (event.key === 'Escape') hideHover();
    const point = event.target.closest?.('#sessionOverview .point');
    if (point && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); toggleLoadedLap(point.dataset.code, Number(point.dataset.lap)); }
  });

  // Redraw when the card's width changes (window resize, sidebar toggled), so the charts keep their real pixel size.
  if (typeof ResizeObserver === 'function') {
    const host = document.getElementById('sessionOverview');
    // Redraw on the next frame: drawing inside the callback changes the observed size and WebKit reports a ResizeObserver loop.
    if (host) new ResizeObserver(() => requestAnimationFrame(() => { if (!host.hidden && Math.abs(chartWidth() - drawnWidth) > 8) renderSessionOverview(); })).observe(host);
  }

  window.ApexSessionOverview = {driverSummary, timeBreakdown, raceProgress, render: renderSessionOverview, renderTimeSummary};
})();
