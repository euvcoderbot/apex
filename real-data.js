// FastF1 integration: real session, lap, stint, sector and telemetry data.
let realDrivers = new Map();
const telemetryCache = new Map();

function currentQuery() {
  return new URLSearchParams({
    year: document.querySelector('#year').value,
    gp: document.querySelector('#gp').value.split(' — ')[0],
    session: document.querySelector('#session').value === 'Qualifying' ? 'Q' : document.querySelector('#session').value,
  });
}

function telemetryKey(lap) { return `${lap.code}:${lap.lap}`; }

async function loadRealSession() {
  const button = document.querySelector('#loadSession');
  button.disabled = true;
  button.textContent = 'Loading FastF1 data…';
  try {
    const response = await fetch(`/api/session?${currentQuery()}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.detail || 'Session unavailable');
    realDrivers = new Map(payload.drivers.map(driver => [driver.code, driver]));
    drivers.splice(0, drivers.length, ...payload.drivers.map(driver => [
      driver.code, driver.number, driver.name, driver.team_color, driver.team.slice(0, 2).toUpperCase(),
    ]));
    const first = payload.drivers.find(driver => driver.laps.length);
    const fastest = first.laps.reduce((a, b) => a.time < b.time ? a : b);
    selected = [first.code];
    loaded = [{ code: first.code, lap: fastest.lap, time: fastest.time, real: fastest }];
    openStint = { [first.code]: fastest.stint };
    telemetryCache.clear();
    renderDrivers(); renderStints(); renderAll();
  } catch (error) {
    alert(`FastF1 could not load this session. ${error.message}`);
  } finally {
    button.disabled = false;
    button.textContent = 'Load session';
  }
}

function renderStints() {
  const root = document.querySelector('#stintPanels');
  root.innerHTML = selected.map(code => {
    const driver = realDrivers.get(code);
    if (!driver) return '';
    const display = drivers.find(item => item[0] === code);
    const stintIds = [...new Set(driver.laps.map(lap => lap.stint))];
    const active = openStint[code] ?? stintIds[0];
    const fastest = driver.laps.reduce((a, b) => a.time < b.time ? a : b);
    const stintButtons = stintIds.map(id => {
      const group = driver.laps.filter(lap => lap.stint === id);
      return `<button class="stint ${id === active ? 'selected' : ''}" style="--team:${display[3]}" data-code="${code}" data-stint="${id}">Stint ${id}<small>${group[0].compound} · ${group.length} laps</small></button>`;
    }).join('');
    const lapButtons = driver.laps.filter(lap => lap.stint === active).map(lap => `<button class="lap" style="--team:${display[3]}" data-code="${code}" data-lap="${lap.lap}">LAP ${lap.lap} · ${time(lap.time)}s</button>`).join('');
    return `<article class="driver-panel"><h3>${code} · ${driver.name}</h3><div class="lap-pills"><button class="lap selected" style="--team:${display[3]}" data-code="${code}" data-lap="${fastest.lap}">FASTEST · LAP ${fastest.lap} · ${time(fastest.time)}s</button></div><div class="stints">${stintButtons}</div><div class="lap-pills">${lapButtons}</div></article>`;
  }).join('');
  root.querySelectorAll('.stint').forEach(button => button.onclick = () => { openStint[button.dataset.code] = +button.dataset.stint; renderStints(); });
  root.querySelectorAll('.lap').forEach(button => button.onclick = () => {
    const lap = realDrivers.get(button.dataset.code).laps.find(item => item.lap === +button.dataset.lap);
    if (!loaded.some(item => item.code === button.dataset.code && item.lap === lap.lap)) loaded.push({ code: button.dataset.code, lap: lap.lap, time: lap.time, real: lap });
    renderAll();
  });
}

function renderSectors() {
  document.querySelector('#sectorRows').innerHTML = loaded.map(item => {
    const lap = item.real || {};
    return `<div class="sector-row sector-data"><span>${item.code} · L${item.lap}</span><span>${lap.s1?.toFixed(3) ?? '—'}</span><span>${lap.s2?.toFixed(3) ?? '—'}</span><span>${lap.s3?.toFixed(3) ?? '—'}</span></div>`;
  }).join('');
}

async function fetchTelemetry(lap) {
  const key = telemetryKey(lap);
  if (telemetryCache.has(key)) return telemetryCache.get(key);
  const query = currentQuery(); query.set('driver', lap.code); query.set('lap', lap.lap);
  const response = await fetch(`/api/telemetry?${query}`);
  if (!response.ok) throw new Error('Telemetry unavailable for this lap');
  const data = await response.json(); telemetryCache.set(key, data.samples); return data.samples;
}

const chartField = { 'Speed trace': 'Speed', 'Throttle application': 'Throttle', 'Brake pressure': 'Brake', 'Engine speed': 'RPM', 'Gear': 'nGear', 'DRS / straight-line mode': 'DRS' };
function interpolate(samples, fraction, field) {
  if (!samples?.length) return null;
  const distance = samples[samples.length - 1].Distance || 1, target = distance * fraction;
  const index = samples.findIndex(point => point.Distance >= target);
  if (index <= 0) return samples[0][field];
  const a = samples[index - 1], b = samples[index], ratio = (target - a.Distance) / (b.Distance - a.Distance || 1);
  return a[field] + (b[field] - a[field]) * ratio;
}
function deltaAt(samples, reference, fraction) {
  const timeAtPoint = interpolate(samples, fraction, 'ElapsedSeconds');
  const refTime = interpolate(reference, fraction, 'ElapsedSeconds');
  return Number.isFinite(timeAtPoint) && Number.isFinite(refTime) ? timeAtPoint - refTime : null;
}
function axis(ctx, width, height, bounds, unit) {
  const { left, right, top, bottom, min, max } = bounds;
  ctx.strokeStyle = '#d7d6d0'; ctx.fillStyle = '#74756f'; ctx.font = '9px monospace';
  for (let tick = 0; tick <= 4; tick++) {
    const y = top + (height - top - bottom) * tick / 4, value = max - (max - min) * tick / 4;
    ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(width - right, y); ctx.stroke();
    ctx.fillText(unit.includes('SECONDS') ? value.toFixed(2) : Math.round(value), 2, y + 3);
  }
}
function drawRealChart(name) {
  const canvas = document.querySelector(`[data-chart="${name}"]`); if (!canvas) return;
  const rect = canvas.getBoundingClientRect(), scale = devicePixelRatio || 1; canvas.width = rect.width * scale; canvas.height = rect.height * scale;
  const ctx = canvas.getContext('2d'); ctx.scale(scale, scale); ctx.clearRect(0, 0, rect.width, rect.height);
  const unit = defs.find(definition => definition[0] === name)?.[1] || '', field = chartField[name];
  const data = loaded.map(lap => telemetryCache.get(telemetryKey(lap))).filter(Boolean);
  if (!data.length) { ctx.fillStyle = '#74756f'; ctx.font = '11px monospace'; ctx.fillText('Loading real telemetry…', 43, 30); return; }
  let values = [];
  if (name === 'Timing delta') { data.slice(1).forEach(series => { for (let i = 0; i <= 100; i++) values.push(deltaAt(series, data[0], i / 100)); }); values.push(0); }
  else data.forEach(series => series.forEach(point => values.push(point[field])));
  values = values.filter(Number.isFinite); if (!values.length) return;
  const rawMin = Math.min(...values), rawMax = Math.max(...values), pad = Math.max((rawMax - rawMin) * .08, name === 'Timing delta' ? .02 : 1);
  const min = ['Throttle application', 'Brake pressure', 'DRS / straight-line mode'].includes(name) ? 0 : rawMin - pad;
  const max = name === 'Throttle application' ? 100 : name === 'Brake pressure' ? Math.max(100, rawMax + pad) : rawMax + pad;
  const bounds = { left: 43, right: 7, top: 8, bottom: 15, min, max }; axis(ctx, rect.width, rect.height, bounds, unit);
  loaded.forEach((lap, index) => {
    const series = telemetryCache.get(telemetryKey(lap)); if (!series) return;
    ctx.strokeStyle = drivers.find(driver => driver[0] === lap.code)?.[3] || '#111'; ctx.lineWidth = 2; ctx.beginPath();
    for (let step = 0; step <= 160; step++) {
      const fraction = step / 160;
      const value = name === 'Timing delta' ? (index === 0 ? 0 : deltaAt(series, telemetryCache.get(telemetryKey(loaded[0])), fraction)) : interpolate(series, fraction, field);
      const x = bounds.left + fraction * (rect.width - bounds.left - bounds.right), y = bounds.top + (bounds.max - value) / (bounds.max - bounds.min || 1) * (rect.height - bounds.top - bounds.bottom);
      step ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
  });
}
async function drawAll() {
  try { await Promise.all(loaded.map(fetchTelemetry)); } catch (error) { console.warn(error); }
  defs.forEach(definition => drawRealChart(definition[0]));
}
function renderAll() { renderLoaded(); renderSectors(); drawAll(); }
document.querySelector('#loadSession').onclick = loadRealSession;
