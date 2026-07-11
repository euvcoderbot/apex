// Dynamic FastF1 calendar, complete stints, fastest laps and synchronized hover values.
const yearSelect = document.querySelector('#year');
const gpSelect = document.querySelector('#gp');
const sessionSelect = document.querySelector('#session');
let calendar = [];

function populate(select, values, valueFor = x => x, labelFor = x => x) {
  select.innerHTML = values.map(value => `<option value="${valueFor(value)}">${labelFor(value)}</option>`).join('');
}

async function loadCalendar() {
  gpSelect.innerHTML = '<option>Loading calendar…</option>';
  const response = await fetch(`/api/events?year=${yearSelect.value}`);
  calendar = await response.json();
  if (!response.ok) throw new Error(calendar.detail || 'Calendar unavailable');
  populate(gpSelect, calendar, event => event.name, event => `R${event.round} · ${event.name}`);
  populateSessions();
}

function populateSessions() {
  const event = calendar.find(item => item.name === gpSelect.value) || calendar[0];
  populate(sessionSelect, event?.sessions || []);
}

function currentQuery() {
  return new URLSearchParams({ year: yearSelect.value, gp: gpSelect.value, session: sessionSelect.value });
}

function lapText(lap) {
  if (lap.out_lap) return `OUT LAP ${lap.lap} · ${lap.time == null ? '—' : `${time(lap.time)}s`}`;
  if (lap.in_lap) return `IN LAP ${lap.lap} · ${lap.time == null ? '—' : `${time(lap.time)}s`}`;
  return `LAP ${lap.lap} · ${lap.time == null ? '—' : `${time(lap.time)}s`}`;
}

function renderStints() {
  const root = document.querySelector('#stintPanels');
  root.innerHTML = selected.map(code => {
    const driver = realDrivers.get(code); if (!driver) return '';
    const display = drivers.find(item => item[0] === code);
    const valid = driver.laps.filter(lap => Number.isFinite(lap.time));
    if (!valid.length) return `<article class="driver-panel"><h3>${code} · ${driver.name}</h3><p>No timed laps in this session.</p></article>`;
    const fastest = valid.reduce((a, b) => a.time < b.time ? a : b);
    const stintIds = [...new Set(driver.laps.map(lap => lap.stint))];
    const active = openStint[code] ?? stintIds[0];
    const stintButtons = stintIds.map(id => {
      const group = driver.laps.filter(lap => lap.stint === id);
      return `<button class="stint ${id === active ? 'selected' : ''}" style="--team:${display[3]}" data-code="${code}" data-stint="${id}">Stint ${id}<small>${group[0]?.compound || 'Unknown'} · ${group.length} laps</small></button>`;
    }).join('');
    const lapButtons = driver.laps.filter(lap => lap.stint === active).map(lap => `<button class="lap ${lap.in_lap || lap.out_lap ? 'in-out' : ''}" style="--team:${display[3]}" data-code="${code}" data-lap="${lap.lap}" ${lap.time == null ? 'disabled' : ''}>${lapText(lap)}</button>`).join('');
    return `<article class="driver-panel"><h3>${code} · ${driver.name}</h3><div class="lap-pills fastest-gap"><button class="lap" style="--team:${display[3]}" data-code="${code}" data-lap="${fastest.lap}">FASTEST · ${lapText(fastest)}</button></div><div class="stints">${stintButtons}</div><div class="lap-pills">${lapButtons}</div></article>`;
  }).join('');
  root.querySelectorAll('.stint').forEach(button => button.onclick = () => { openStint[button.dataset.code] = +button.dataset.stint; renderStints(); });
  root.querySelectorAll('.lap:not(:disabled)').forEach(button => button.onclick = () => {
    const lap = realDrivers.get(button.dataset.code).laps.find(item => item.lap === +button.dataset.lap);
    if (!loaded.some(item => item.code === button.dataset.code && item.lap === lap.lap)) loaded.push({ code: button.dataset.code, lap: lap.lap, time: lap.time, real: lap });
    renderAll();
  });
}

async function loadRealSession() {
  const button = document.querySelector('#loadSession'); button.disabled = true; button.textContent = 'Loading FastF1 data…';
  try {
    const response = await fetch(`/api/session?${currentQuery()}`); const payload = await response.json();
    if (!response.ok) throw new Error(payload.detail || 'Session unavailable');
    realDrivers = new Map(payload.drivers.map(driver => [driver.code, driver]));
    drivers.splice(0, drivers.length, ...payload.drivers.map(driver => [driver.code, driver.number, driver.name, driver.team_color, driver.team.slice(0, 2).toUpperCase()]));
    selected = []; loaded = []; openStint = {}; telemetryCache.clear();
    renderDrivers(); renderStints(); renderAll();
  } catch (error) { alert(`FastF1 could not load this session. ${error.message}`); }
  finally { button.disabled = false; button.textContent = 'Load session'; }
}

function bindAllChartHover() {
  document.querySelectorAll('canvas[data-chart]').forEach(canvas => {
    canvas.onmousemove = event => {
      const name = canvas.dataset.chart, rect = canvas.getBoundingClientRect();
      const fraction = Math.max(0, Math.min(1, (event.clientX - rect.left - 43) / (rect.width - 50)));
      const field = chartField[name], tip = document.querySelector('#realTooltip');
      defs.forEach(def => drawRealChart(def[0]));
      document.querySelectorAll('canvas[data-chart]').forEach(chart => {
        const context = chart.getContext('2d');
        const x = 43 + fraction * (chart.clientWidth - 50);
        context.strokeStyle = '#111216'; context.globalAlpha = .45; context.lineWidth = 1;
        context.beginPath(); context.moveTo(x, 6); context.lineTo(x, chart.clientHeight - 10); context.stroke(); context.globalAlpha = 1;
      });
      const lines = loaded.map((lap, index) => {
        const samples = telemetryCache.get(telemetryKey(lap));
        const value = name === 'Timing delta' ? (index ? deltaAt(samples, telemetryCache.get(telemetryKey(loaded[0])), fraction) : 0) : interpolate(samples, fraction, field);
        const unit = defs.find(def => def[0] === name)?.[1] || '';
        const display = Number.isFinite(value) ? (name === 'Timing delta' ? `${value >= 0 ? '+' : ''}${value.toFixed(3)}s` : `${Math.round(value)} ${unit}`) : '—';
        return `${lap.code} L${lap.lap} · ${display}`;
      });
      tip.innerHTML = `<b>${(fraction * 5.891).toFixed(3)} KM</b><br>${lines.join('<br>')}`;
      const host = document.querySelector('.telemetry').getBoundingClientRect();
      tip.style.display = 'block'; tip.style.left = `${Math.max(44, event.clientX - host.left + 4)}px`; tip.style.top = `${event.clientY - host.top + 4}px`;
    };
    canvas.onmouseleave = () => document.querySelector('#realTooltip').style.display = 'none';
  });
}

yearSelect.addEventListener('change', () => loadCalendar().catch(error => alert(error.message)));
gpSelect.addEventListener('change', populateSessions);
document.querySelector('#loadSession').onclick = loadRealSession;
document.querySelector('#cornerToggle').addEventListener('change', event => {
  document.querySelector('#cornerStatus').textContent = event.target.checked
    ? 'Corner overlays need circuit-distance mapping; this will appear automatically when FastF1 provides it.'
    : 'Corner labels appear when mapped distance data is available.';
});
function clearBeforeSessionLoad() {
  selected = []; loaded = []; openStint = {}; telemetryCache.clear();
  document.querySelector('#driverPills').innerHTML = '<span class="section-empty">Load a session to see its drivers.</span>';
  document.querySelector('#stintPanels').innerHTML = '<span class="section-empty">Select a driver to see stints and laps.</span>';
  document.querySelector('#sectorRows').innerHTML = '';
  document.querySelector('#referenceLap').textContent = '—';
  document.querySelector('#loadedCount').textContent = '00';
  document.querySelector('#finalDeltas').textContent = '—';
}
populate(yearSelect, Array.from({ length: new Date().getFullYear() - 2014 + 1 }, (_, i) => new Date().getFullYear() - i));
yearSelect.value = '2025';
loadCalendar().catch(error => { gpSelect.innerHTML = '<option>Calendar unavailable</option>'; console.warn(error); });
clearBeforeSessionLoad();
bindAllChartHover();
