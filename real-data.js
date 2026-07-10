// Replaces the representative session selection with real FastF1 timing data.
let realDrivers = new Map();

function currentQuery() {
  return new URLSearchParams({
    year: document.querySelector('#year').value,
    gp: document.querySelector('#gp').value.split(' — ')[0],
    session: document.querySelector('#session').value === 'Qualifying' ? 'Q' : document.querySelector('#session').value,
  });
}

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
    const best = first.laps.reduce((a, b) => a.time < b.time ? a : b);
    selected = [first.code];
    loaded = [{ code: first.code, lap: best.lap, time: best.time, real: best }];
    openStint = { [first.code]: best.stint };
    renderDrivers();
    renderStints();
    renderAll();
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
    const d = drivers.find(x => x[0] === code);
    const stints = [...new Set(driver.laps.map(lap => lap.stint))];
    const active = openStint[code] ?? stints[0];
    const laps = driver.laps.filter(lap => lap.stint === active);
    return `<article class="driver-panel"><h3>${code} · ${driver.name}</h3><div class="stints">${stints.map(s => {
      const group = driver.laps.filter(lap => lap.stint === s);
      return `<button class="stint ${s === active ? 'selected' : ''}" style="--team:${d[3]}" data-code="${code}" data-stint="${s}">Stint ${s}<small>${group[0].compound} · ${group.length} laps</small></button>`;
    }).join('')}</div><div class="lap-pills">${laps.map(lap => `<button class="lap" style="--team:${d[3]}" data-code="${code}" data-lap="${lap.lap}">LAP ${lap.lap} · ${time(lap.time)}s</button>`).join('')}</div></article>`;
  }).join('');
  root.querySelectorAll('.stint').forEach(button => button.onclick = () => { openStint[button.dataset.code] = +button.dataset.stint; renderStints(); });
  root.querySelectorAll('.lap').forEach(button => button.onclick = () => {
    const lap = realDrivers.get(button.dataset.code).laps.find(item => item.lap === +button.dataset.lap);
    if (!loaded.some(item => item.code === button.dataset.code && item.lap === lap.lap)) loaded.push({ code: button.dataset.code, lap: lap.lap, time: lap.time, real: lap });
    renderAll();
  });
}

function renderSectors() {
  const root = document.querySelector('#sectorRows');
  root.innerHTML = loaded.map(item => {
    const lap = item.real || {};
    return `<div class="sector-row sector-data"><span>${item.code} · L${item.lap}</span><span>${lap.s1?.toFixed(3) ?? '—'}</span><span>${lap.s2?.toFixed(3) ?? '—'}</span><span>${lap.s3?.toFixed(3) ?? '—'}</span></div>`;
  }).join('');
}

document.querySelector('#loadSession').onclick = loadRealSession;
