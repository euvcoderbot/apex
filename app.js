// Consolidated F1 Telemetry Hub Application Logic
let drivers = [];
let selected = [];
let loaded = [];
let openStint = {};
let realDrivers = new Map();
const telemetryCache = new Map();
let calendar = [];
let corners = [];
let nominatedCompounds = [];
let activeDriverTab = null;

let hoverFraction = null;
let hoveredChartName = null;

const teamMapping = {
  "McLaren": {
    "id": "mclaren",
    "shortName": "McLaren",
    "fullName": "McLaren Formula 1 Team",
    "logo": "assets/teams/mclaren.svg"
  },
  "Ferrari": {
    "id": "ferrari",
    "shortName": "Ferrari",
    "fullName": "Scuderia Ferrari HP",
    "logo": "assets/teams/ferrari.svg"
  },
  "Mercedes": {
    "id": "mercedes",
    "shortName": "Mercedes",
    "fullName": "Mercedes-AMG PETRONAS Formula One Team",
    "logo": "assets/teams/mercedes.svg"
  },
  "Red Bull Racing": {
    "id": "red_bull",
    "shortName": "Red Bull",
    "fullName": "Oracle Red Bull Racing",
    "logo": "assets/teams/red_bull.svg"
  },
  "Racing Bulls": {
    "id": "racing_bulls",
    "shortName": "Racing Bulls",
    "fullName": "Visa Cash App Racing Bulls Formula One Team",
    "logo": "assets/teams/racing_bulls.svg"
  },
  "Williams": {
    "id": "williams",
    "shortName": "Williams",
    "fullName": "Atlassian Williams Racing",
    "logo": "assets/teams/williams.svg"
  },
  "Aston Martin": {
    "id": "aston_martin",
    "shortName": "Aston Martin",
    "fullName": "Aston Martin Aramco Formula One Team",
    "logo": "assets/teams/aston_martin.svg"
  },
  "Alpine": {
    "id": "alpine",
    "shortName": "Alpine",
    "fullName": "BWT Alpine Formula One Team",
    "logo": "assets/teams/alpine.svg"
  },
  "Audi": {
    "id": "audi",
    "shortName": "Audi",
    "fullName": "Audi Formula 1 Team",
    "logo": "assets/teams/audi.svg"
  },
  "Cadillac": {
    "id": "cadillac",
    "shortName": "Cadillac",
    "fullName": "Cadillac Formula 1 Team",
    "logo": "assets/teams/cadillac.svg"
  },
  "Haas": {
    "id": "haas",
    "shortName": "Haas",
    "fullName": "TGR Haas Formula One Team",
    "logo": "assets/teams/haas.svg"
  }
};

function getTeamInfo(teamName) {
  const mapped = teamMapping[teamName];
  if (mapped) return mapped;

  const keys = Object.keys(teamMapping);
  const foundKey = keys.find(k => k.toLowerCase() === teamName.toLowerCase());
  if (foundKey) return teamMapping[foundKey];
  
  return {
    id: teamName.toLowerCase().replace(/[^a-z0-9]/g, '_'),
    shortName: teamName,
    fullName: teamName,
    logo: ''
  };
}

const $ = s => document.querySelector(s);

// Timing formatter: seconds -> M:SS.SSS
function time(t) {
  if (!Number.isFinite(t)) return '—';
  const minutes = Math.floor(t / 60);
  const seconds = (t % 60).toFixed(3).padStart(6, '0');
  return `${minutes}:${seconds}`;
}

// Convert Hex to RGBA for canvas gradients
function hexToRgba(hex, alpha = 1) {
  hex = hex.replace('#', '');
  if (hex.length === 3) {
    hex = hex.split('').map(c => c + c).join('');
  }
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Get driver team color
function getDriverColor(code) {
  const display = drivers.find(item => item[0] === code);
  return display ? display[3] : '#777777';
}

function currentQuery() {
  const selectedVal = $('#gp')?.value;
  const event = calendar.find(item => String(item.round) === String(selectedVal) || item.name === selectedVal) || calendar[0];
  const params = new URLSearchParams();
  params.set('year', $('#year').value);
  if (event) {
    params.set('gp', event.name);
    params.set('round', event.round);
  } else if (selectedVal) {
    params.set('gp', selectedVal);
  }
  params.set('session', $('#session').value);
  return params;
}

async function readApiResponse(response) {
  const body = await response.text();
  try {
    return JSON.parse(body);
  } catch {
    const summary = body.replace(/\s+/g, ' ').trim().slice(0, 140) || 'empty response';
    throw new Error(`Server returned ${response.status}: ${summary}`);
  }
}

function telemetryKey(lap) {
  return `${lap.code}:${lap.lap}`;
}

// Populate select utilities
function populate(select, values, valueFor = x => x, labelFor = x => x) {
  select.innerHTML = values.map(val => `<option value="${valueFor(val)}">${labelFor(val)}</option>`).join('');
}

// Calendar API Loader
async function loadCalendar() {
  $('#gp').innerHTML = '<option>Loading calendar…</option>';
  try {
    const response = await fetch(`/api/events?year=${$('#year').value}`);
    calendar = await readApiResponse(response);
    if (!response.ok) throw new Error(calendar.detail || 'Calendar unavailable');
    $('#gp').innerHTML = calendar.map(event => `<option value="${event.round}">R${event.round} - ${event.name}</option>`).join('');
    selectLatestCompletedEvent();
  } catch (error) {
    alert(`Could not load calendar. ${error.message}`);
  }
}

function populateSessions() {
  const selectedVal = $('#gp')?.value;
  const event = calendar.find(item => String(item.round) === String(selectedVal) || item.name === selectedVal) || calendar[0];
  const sessions = event?.sessions || [];
  populate($('#session'), sessions);
  if (sessions.length) {
    if (sessions.includes('Practice 1')) {
      $('#session').value = 'Practice 1';
    } else {
      $('#session').value = sessions[0];
    }
  }
}

function selectLatestCompletedEvent() {
  const today = new Date().toISOString().slice(0, 10);
  const completed = calendar.filter(event => event.date <= today);
  const latest = completed.length ? completed[completed.length - 1] : calendar[0];
  if (latest) $('#gp').value = String(latest.round);
  populateSessions();
}

function lapText(lap) {
  if (lap.out_lap) return `OUT L${lap.lap} · ${lap.time == null ? '—' : `${time(lap.time)}`}`;
  if (lap.in_lap) return `IN L${lap.lap} · ${lap.time == null ? '—' : `${time(lap.time)}`}`;
  return `L${lap.lap} · ${lap.time == null ? '—' : `${time(lap.time)}`}`;
}

// UI State Resets
function clearBeforeSessionLoad() {
  selected = [];
  loaded = [];
  openStint = {};
  corners = [];
  nominatedCompounds = [];
  activeDriverTab = null;
  telemetryCache.clear();
  $('#driverPills').innerHTML = '<span class="section-empty">Load a session to see its drivers.</span>';
  $('#stintPanels').innerHTML = '<span class="section-empty">Select a driver to see stints and laps.</span>';
  $('#sectorRows').innerHTML = '';
  const apexSpeeds = $('#apexSpeeds');
  if (apexSpeeds) apexSpeeds.innerHTML = '';
  
  const tireCard = $('#tireCard');
  if (tireCard) tireCard.style.display = 'none';
}

// Main Session API Loader
async function loadRealSession() {
  const button = $('#loadSession');
  button.disabled = true;
  button.textContent = 'Loading FastF1 data…';
  clearBeforeSessionLoad();
  renderCharts();
  
  try {
    const response = await fetch(`/api/session?${currentQuery()}`);
    const payload = await readApiResponse(response);
    if (!response.ok) throw new Error(payload.detail || 'Session unavailable');
    
    realDrivers = new Map(payload.drivers.map(driver => [driver.code, driver]));
    drivers.splice(0, drivers.length, ...payload.drivers.map(driver => [
      driver.code, driver.number, driver.name, driver.team_color, driver.team
    ]));
    corners = payload.corners || [];
    nominatedCompounds = payload.compounds || [];
    
    // Automatically select the top 2 drivers and load their fastest laps for instant visual comparison
    if (drivers.length > 0) {
      const initialCodes = drivers.slice(0, Math.min(2, drivers.length)).map(d => d[0]);
      selected = [...initialCodes];
      activeDriverTab = selected[0];
      
      loaded = [];
      selected.forEach(c => {
        const d = realDrivers.get(c);
        if (d && d.laps && d.laps.length) {
          const validLaps = d.laps.filter(l => Number.isFinite(l.time) && l.time > 0);
          const f = validLaps.length ? validLaps.reduce((a, b) => a.time < b.time ? a : b) : d.laps[0];
          if (f) {
            loaded.push({ code: c, lap: f.lap, time: f.time, real: f });
          }
        }
      });
    }

    renderDrivers();
    renderTireNomination();
    renderStints();
    renderAll();
  } catch (error) {
    alert(`FastF1 could not load this session. ${error.message}`);
  } finally {
    button.disabled = false;
    button.textContent = 'Load session';
  }
}

async function fetchTelemetry(lap) {
  const key = telemetryKey(lap);
  if (telemetryCache.has(key)) return telemetryCache.get(key);
  
  const query = currentQuery();
  query.set('driver', lap.code);
  query.set('lap', lap.lap);
  
  const response = await fetch(`/api/telemetry?${query}`);
  if (!response.ok) throw new Error('Telemetry unavailable for this lap');
  
  const data = await readApiResponse(response);
  const samples = data.samples || [];
  samples.forEach(pt => {
    const d = +pt.DRS;
    if (d >= 10 || pt.DRS === true || pt.DRS === 1 || pt.DRS === '1') {
      pt.DRS = 1;
    } else {
      pt.DRS = 0;
    }
    
    // Normalize Brake: check boolean, string, or number values
    if (pt.Brake === true || pt.Brake === 1 || pt.Brake === '1' || pt.Brake === 'True' || pt.Brake > 0) {
      if (pt.Brake === true || pt.Brake === 1 || pt.Brake === '1' || pt.Brake === 'True') {
        pt.Brake = 100;
      } else {
        pt.Brake = +pt.Brake;
      }
    } else {
      pt.Brake = 0;
    }
  });
  
  telemetryCache.set(key, samples);
  return samples;
}

// UI Rendering Functions
function renderDrivers() {
  const root = $('#driverPills');
  if (!drivers.length) {
    root.innerHTML = '<span class="section-empty">Load a session to see its drivers.</span>';
    return;
  }
  
  root.innerHTML = drivers.map(d => {
    const code = d[0];
    const number = d[1];
    const color = d[3];
    const isSelected = selected.includes(code);
    
    return `<button class="pill ${isSelected ? 'selected' : ''}" style="--team:${color}" data-code="${code}">#${number} · ${code}</button>`;
  }).join('');
  
  root.querySelectorAll('button').forEach(btn => {
    btn.onclick = () => {
      const code = btn.dataset.code;
      if (selected.includes(code)) {
        if (selected.length > 1) {
          selected = selected.filter(x => x !== code);
          loaded = loaded.filter(x => x.code !== code);
          if (activeDriverTab === code) {
            activeDriverTab = selected[0];
          }
        }
      } else {
        selected.push(code);
        activeDriverTab = code;
      }
      renderDrivers();
      renderStints();
      renderAll();
    };
  });
}

function renderStints() {
  const root = $('#stintPanels');
  if (!selected.length) {
    root.innerHTML = '<span class="section-empty">Select a driver to see stints and laps.</span>';
    return;
  }
  
  if (!activeDriverTab || !selected.includes(activeDriverTab)) {
    activeDriverTab = selected[0];
  }
  
  const isAllFastestLoaded = selected.length > 0 && selected.every(c => {
    const d = realDrivers.get(c);
    if (!d || !d.laps || !d.laps.length) return true;
    const timedLaps = d.laps.filter(l => Number.isFinite(l.time));
    const f = timedLaps.length ? timedLaps.reduce((a, b) => a.time < b.time ? a : b) : d.laps[0];
    return f && loaded.some(item => item.code === c && item.lap === f.lap);
  });

  const globalCompareHtml = `<button id="compareAllFastest" class="compare-all-btn ${isAllFastestLoaded ? 'selected' : ''}">⚡ COMPARE FASTEST LAPS</button>`;
  
  // Render tabs at the top
  const tabsHtml = `
    ${globalCompareHtml}
    <div class="driver-tabs">
      ${selected.map(code => {
        const isActive = code === activeDriverTab;
        const color = getDriverColor(code);
        return `<button class="driver-tab ${isActive ? 'active' : ''}" style="--team:${color}" data-code="${code}">${code}</button>`;
      }).join('')}
    </div>
  `;
  
  const code = activeDriverTab;
  const driver = realDrivers.get(code);
  if (!driver) {
    root.innerHTML = tabsHtml + '<span class="section-empty">Loading driver data…</span>';
    return;
  }
  
  const display = drivers.find(item => item[0] === code);
  
  if (!driver.laps || !driver.laps.length) {
    root.innerHTML = tabsHtml + `<article class="driver-panel"><h3>${code} · ${driver.name}</h3><p class="section-empty">No laps in this session.</p></article>`;
    return;
  }
  
  const timedLaps = driver.laps.filter(lap => Number.isFinite(lap.time));
  const fastest = timedLaps.length 
    ? timedLaps.reduce((a, b) => a.time < b.time ? a : b) 
    : driver.laps[0];
    
  const hasQualifyingPhases = driver.laps.some(lap => /^Q[1-3]$/.test(lap.phase || ''));
  const groupIds = hasQualifyingPhases
    ? ['Q1', 'Q2', 'Q3'].filter(phase => driver.laps.some(lap => lap.phase === phase))
    : [...new Set(driver.laps.map(lap => String(lap.stint)))];
  const active = String(openStint[code] ?? groupIds[0]);
  const lapsForGroup = id => hasQualifyingPhases
    ? driver.laps.filter(lap => lap.phase === id)
    : driver.laps.filter(lap => String(lap.stint) === id);
  const stintButtons = groupIds.map(id => {
    const group = lapsForGroup(id);
    const compound = group[0]?.compound || 'UNKNOWN';
    const compLabel = getCompoundCode(compound, nominatedCompounds);
    if (hasQualifyingPhases) {
      return `<button class="stint ${id === active ? 'selected' : ''}" style="--team:${display[3]}" data-code="${code}" data-stint="${id}">${id}<small>${compLabel} - ${group.length} ${group.length === 1 ? 'LAP' : 'LAPS'}</small></button>`;
    }
    return `<button class="stint ${id === active ? 'selected' : ''}" style="--team:${display[3]}" data-code="${code}" data-stint="${id}">Stint ${id}<small>${compLabel} · ${group.length} L</small></button>`;
  }).join('');
  
  const lapButtons = lapsForGroup(active).map(lap => {
    const isLoaded = loaded.some(item => item.code === code && item.lap === lap.lap);
    const classes = ['lap', lap.in_lap || lap.out_lap ? 'in-out' : '', isLoaded ? 'selected' : ''].filter(Boolean).join(' ');
    return `<button class="${classes}" style="--team:${display[3]}" data-code="${code}" data-lap="${lap.lap}">${lapText(lap)}</button>`;
  }).join('');
  
  root.innerHTML = tabsHtml + `
    <article class="driver-panel">
      <h3>${code} · ${driver.name}</h3>
      <div class="stints">${stintButtons}</div>
      <div class="lap-pills">${lapButtons}</div>
    </article>
  `;
  
  const compareAllBtn = $('#compareAllFastest');
  if (compareAllBtn) {
    compareAllBtn.onclick = () => {
      if (isAllFastestLoaded) {
        // Toggle OFF: unload all laps
        loaded = [];
      } else {
        // Toggle ON: load fastest lap of all selected drivers
        loaded = [];
        selected.forEach(c => {
          const d = realDrivers.get(c);
          if (d && d.laps && d.laps.length) {
            const validLaps = d.laps.filter(l => Number.isFinite(l.time) && l.time > 0);
            const f = validLaps.length ? validLaps.reduce((a, b) => a.time < b.time ? a : b) : d.laps[0];
            if (f) {
              loaded.push({ code: c, lap: f.lap, time: f.time, real: f });
            }
          }
        });
      }
      renderAll();
      renderStints();
    };
  }
  
  // Bind tab click handlers
  root.querySelectorAll('.driver-tab').forEach(tab => {
    tab.onclick = () => {
      activeDriverTab = tab.dataset.code;
      renderStints();
    };
  });
  
  root.querySelectorAll('.stint').forEach(btn => {
    btn.onclick = () => {
      openStint[btn.dataset.code] = btn.dataset.stint;
      renderStints();
    };
  });
  
  root.querySelectorAll('.lap').forEach(btn => {
    btn.onclick = () => {
      const code = btn.dataset.code;
      const lapNum = +btn.dataset.lap;
      const lapObj = realDrivers.get(code).laps.find(item => item.lap === lapNum);
      const index = loaded.findIndex(item => item.code === code && item.lap === lapNum);
      if (index !== -1) {
        if (loaded.length > 1) {
          loaded.splice(index, 1);
        }
      } else {
        loaded.push({ code, lap: lapNum, time: lapObj.time, real: lapObj });
      }
      renderAll();
      renderStints();
    };
  });
}


function renderLoaded() {
  const root = $('#loadedLaps');
  if (!loaded.length) {
    root.innerHTML = '<span class="section-empty">No laps loaded. Click laps in the panel to compare.</span>';
    return;
  }
  
  const ref = loaded[0];
  root.innerHTML = selected.map(code => {
    const list = loaded.map((x, index) => ({ ...x, index })).filter(x => x.code === code);
    return list.length ? `<div class="loaded-line"><span>${code}</span><div class="pills">${list.map(x => `<button class="pill ${x.index === 0 ? 'reference' : ''}" data-index="${x.index}">L${x.lap} · ${time(x.time)}s<i class="remove" data-remove="${x.index}">×</i></button>`).join('')}</div></div>` : '';
  }).join('');
  
  root.querySelectorAll('.pill').forEach(p => {
    p.onclick = e => {
      const idx = +p.dataset.index;
      if (e.target.dataset.remove !== undefined) {
        const removeIdx = +e.target.dataset.remove;
        loaded.splice(removeIdx, 1);
      } else {
        loaded.unshift(loaded.splice(idx, 1)[0]);
      }
      renderAll();
      renderStints();
    };
  });
}

function renderSectors() {
  if (!loaded.length) {
    $('#sectorRows').innerHTML = '';
    return;
  }
  
  const ref = loaded[0];
  
  function formatSector(val, refVal) {
    if (val == null) return '—';
    if (refVal == null || val === refVal) return `${val.toFixed(3)}s`;
    const diff = val - refVal;
    const color = diff >= 0 ? 'var(--red)' : 'var(--green)';
    return `${val.toFixed(3)}s <span style="color:${color}; font-size:9px;">(${diff >= 0 ? '+' : ''}${diff.toFixed(3)}s)</span>`;
  }
  
  function formatLapTime(val, refVal) {
    if (val == null) return '—';
    if (refVal == null || val === refVal) return `${time(val)}`;
    const diff = val - refVal;
    const color = diff >= 0 ? 'var(--red)' : 'var(--green)';
    return `${time(val)} <span style="color:${color}; font-size:9px;">(${diff >= 0 ? '+' : ''}${diff.toFixed(3)}s)</span>`;
  }
  
  $('#sectorRows').innerHTML = loaded.map((item, i) => {
    const lap = item.real || {};
    const refLap = ref.real || {};
    
    return `
      <div class="sector-row sector-data">
        <span style="border-left:3px solid ${getDriverColor(item.code)}; padding-left:8px; display:inline-flex; align-items:center;">${item.code} · L${item.lap}</span>
        <span>${formatLapTime(item.time, i === 0 ? null : ref.time)}</span>
        <span>${formatSector(lap.s1, i === 0 ? null : refLap.s1)}</span>
        <span>${formatSector(lap.s2, i === 0 ? null : refLap.s2)}</span>
        <span>${formatSector(lap.s3, i === 0 ? null : refLap.s3)}</span>
      </div>
    `;
  }).join('');
}

// Chart Constants and Configuration
const defs = [
  ['Speed trace', 'KM/H', false],
  ['Timing delta', 'SECONDS VS REFERENCE', false],
  ['Throttle application', '%', true],
  ['Brake pressure', 'BAR', true],
  ['Gear', '0–8', false],
  ['DRS', 'OPEN / CLOSED', true]
];

const chartField = {
  'Speed trace': 'Speed',
  'Throttle application': 'Throttle',
  'Brake pressure': 'Brake',
  'Engine speed': 'RPM',
  'Gear': 'nGear',
  'DRS': 'DRS'
};

function renderCharts() {
  const root = $('#charts');
  const season = Number($('#year').value);
  const activeDefs = season >= 2026
    ? defs.filter(([name]) => name !== 'DRS')
    : defs;
  root.innerHTML = activeDefs.map(([name, unit, compact]) => {
    return `
    <section class="chart ${compact ? 'compact' : ''}">
      <h2>${name} <small>${unit}</small></h2>
      <canvas data-chart="${name}"></canvas>
    </section>
  `;
  }).join('');
  bindAllChartHover();
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

function deltaAt(samples, reference, targetDistance) {
  const fraction = Math.max(0, Math.min(1, targetDistance / referenceDistance()));
  const timeHere = calibratedElapsed(samples, fraction);
  const referenceHere = calibratedElapsed(reference, fraction);
  if (!Number.isFinite(timeHere) || !Number.isFinite(referenceHere)) return null;
  return timeHere - referenceHere;
}

function getSectorDistances(lap) {
  if (!lap) return { s1: null, s2: null };
  const samples = telemetryCache.get(telemetryKey(lap));
  if (!samples || !samples.length) return { s1: null, s2: null };
  
  const lapTime = lap.time;
  const s1Time = lap.s1;
  const s2Time = lap.s2;
  
  if (!s1Time || !s2Time || !lapTime) return { s1: null, s2: null };
  
  const totalDist = samples[samples.length - 1].Distance || 5891;
  
  const s1TargetTime = s1Time;
  const s2TargetTime = s1Time + s2Time;
  
  let s1Pt = samples.find(pt => pt.ElapsedSeconds >= s1TargetTime);
  let s2Pt = samples.find(pt => pt.ElapsedSeconds >= s2TargetTime);
  
  const s1Dist = s1Pt ? s1Pt.Distance : totalDist * (s1Time / lapTime);
  const s2Dist = s2Pt ? s2Pt.Distance : totalDist * ((s1Time + s2Time) / lapTime);
  
  return { s1: s1Dist, s2: s2Dist };
}

function getNiceBounds(name, rawMin, rawMax) {
  let min = rawMin;
  let max = rawMax;
  let tickStep = null;
  
  if (name === 'Speed trace') {
    min = Math.max(0, Math.floor(rawMin / 20) * 20 - 20);
    let tempMax = Math.ceil(rawMax / 20) * 20 + 20;
    const diff = tempMax - min;
    const remainder = diff % 40;
    if (remainder !== 0) {
      tempMax += (40 - remainder);
    }
    max = tempMax;
  } else if (name === 'Engine speed') {
    min = Math.max(0, Math.floor(rawMin / 500) * 500 - 500);
    let tempMax = Math.ceil(rawMax / 500) * 500 + 500;
    const diff = tempMax - min;
    const remainder = diff % 2000;
    if (remainder !== 0) {
      tempMax += (2000 - remainder);
    }
    max = tempMax;
  } else if (name === 'Timing delta') {
    const span = Math.max(rawMax - rawMin, 0.02);
    const magnitude = 10 ** Math.floor(Math.log10(span / 4));
    const normalized = (span / 4) / magnitude;
    const multiplier = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
    const step = multiplier * magnitude;
    min = rawMin >= 0 ? 0 : Math.floor(rawMin / step) * step;
    max = rawMax <= 0 ? 0 : Math.ceil(rawMax / step) * step;
    if (max - min < step * 2) {
      if (rawMax > 0) max = min + step * 2;
      else min = max - step * 2;
    }
    tickStep = step;
  } else if (name === 'Brake pressure') {
    min = 0;
    max = 100;
  } else if (name === 'Throttle application') {
    min = 0;
    max = 100;
  } else if (name === 'Gear') {
    min = 0;
    max = 8;
    tickStep = 1;
  } else if (name === 'DRS / straight-line mode') {
    min = 0;
    max = 1;
  }
  
  return { min, max, tickStep };
}

function cornerFraction(corner, samples, totalDistance) {
  if (Number.isFinite(Number(corner.distance)) && Number(corner.distance) > 0 && totalDistance > 0) {
    return Number(corner.distance) / totalDistance;
  }
  if (Number.isFinite(Number(corner.fraction)) && Number(corner.fraction) > 0) {
    return Number(corner.fraction);
  }
  if (samples && samples.length && Number.isFinite(Number(corner.x)) && Number.isFinite(Number(corner.y)) && totalDistance > 0) {
    let minSq = Infinity;
    let bestDist = -1;
    const cx = Number(corner.x);
    const cy = Number(corner.y);
    for (let i = 0; i < samples.length; i++) {
      const pt = samples[i];
      if (Number.isFinite(pt.X) && Number.isFinite(pt.Y)) {
        const dx = pt.X - cx;
        const dy = pt.Y - cy;
        const distSq = dx * dx + dy * dy;
        if (distSq < minSq) {
          minSq = distSq;
          bestDist = pt.Distance || 0;
        }
      }
    }
    if (minSq < Infinity && bestDist >= 0) {
      return bestDist / totalDistance;
    }
  }
  return null;
}

// Draw chart grid axes
function drawGridAxes(ctx, width, height, bounds, unit) {
  const { left, right, top, bottom, min, max, tickStep } = bounds;
  ctx.font = '9px monospace';
  const ticks = [];
  if (Number.isFinite(tickStep) && tickStep > 0) {
    for (let value = max; value >= min - tickStep * 0.001; value -= tickStep) {
      ticks.push({ value: Math.abs(value) < tickStep * 0.001 ? 0 : value });
    }
  } else {
    for (let tick = 0; tick <= 4; tick++) {
      ticks.push({ value: max - (max - min) * tick / 4, tick });
    }
  }

  ticks.forEach(({ value, tick }) => {
    const y = top + (height - top - bottom) * ((max - value) / (max - min || 1));
    
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(width - right, y);
    
    // Highlight the 0 line on Timing delta chart
    if (unit.includes('SECONDS') && Math.abs(value) < 1e-5) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)'; // brighter line for 0 axis
      ctx.lineWidth = 1.2;
    } else {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.lineWidth = 1;
    }
    ctx.stroke();
    
    let displayVal = unit.includes('SECONDS')
      ? (Math.abs(max - min) <= 0.4 ? value.toFixed(2) : value.toFixed(1))
      : Math.round(value);
    if (unit.includes('SECONDS') && Math.abs(value) < 1e-5) {
      displayVal = '0';
    }
    
    if (unit === 'OPEN / CLOSED') {
      if (tick === 0) displayVal = 'OPEN';
    ctx.stroke();
    
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.textAlign = 'right';
    ctx.fillText(`${formatTick(val)} ${unit}`.trim(), left - 6, y + 3);
  });
  
  ctx.textAlign = 'left';
}

function bottomY(val, bounds, height) {
  const { top, bottom, min, max } = bounds;
  const h = height - top - bottom;
  if (max === min) return top + h / 2;
  return top + (1 - (val - min) / (max - min)) * h;
}

function formatTick(val) {
  if (Math.abs(val) >= 100) return val.toFixed(0);
  if (Math.abs(val) >= 10) return val.toFixed(1);
  return val.toFixed(2);
}

// Draw a single canvas chart
function drawRealChart(name) {
  const canvas = document.querySelector(`[data-chart="${name}"]`);
  if (!canvas) return;
  
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, rect.width, rect.height);
  
  const unit = defs.find(def => def[0] === name)?.[1] || '';
  const field = chartField[name];
  const data = loaded.map(lap => telemetryCache.get(telemetryKey(lap))).filter(Boolean);
  
  if (!loaded.length) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.font = '11px monospace';
    ctx.fillText('Select a driver to begin comparison.', 43, 25);
    return;
  }
  
  if (!data.length) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.font = '11px monospace';
    ctx.fillText('Loading telemetry data…', 43, 25);
    return;
  }

  if (name === 'DRS / straight-line mode' && Number($('#year').value) >= 2026
    && !data.some(series => series.modeAvailable)) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.font = '11px monospace';
    ctx.fillText('Straight-line mode is not published for this lap.', 43, 25);
    return;
  }
  
  let values = [];
  if (name === 'Timing delta') {
    const refSamples = telemetryCache.get(telemetryKey(loaded[0]));
    if (refSamples && refSamples.length) {
      const refDistance = refSamples[refSamples.length - 1].Distance || 5891;
      data.slice(1).forEach(samples => {
        for (let i = 0; i <= 100; i++) {
          const v = deltaAt(samples, refSamples, refDistance * (i / 100));
          if (Number.isFinite(v)) values.push(v);
        }
      });
    }
    values.push(0);
  } else {
    data.forEach(series => series.forEach(pt => {
      if (Number.isFinite(pt[field])) values.push(pt[field]);
    }));
  }
  
  values = values.filter(Number.isFinite);
  if (!values.length) return;
  
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  
  const niceBounds = getNiceBounds(name, rawMin, rawMax);
  const min = niceBounds.min;
  const max = niceBounds.max;
  const bounds = { left: 43, right: 7, top: 8, bottom: 15, min, max, tickStep: niceBounds.tickStep };
  
  // Render grid axes
  drawGridAxes(ctx, rect.width, rect.height, bounds, unit);
  
  const refLap = loaded[0];
  const refSamples = telemetryCache.get(telemetryKey(refLap));
  const totalDist = refSamples && refSamples.length ? refSamples[refSamples.length - 1].Distance : 5891;
  
  // Draw vertical sector lines in background
  const sectorDists = getSectorDistances(refLap);
  if (sectorDists) {
    const s1X = bounds.left + (sectorDists.s1Dist / totalDist) * (rect.width - bounds.left - bounds.right);
    const s2X = bounds.left + (sectorDists.s2Dist / totalDist) * (rect.width - bounds.left - bounds.right);
    
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(s1X, bounds.top);
    ctx.lineTo(s1X, rect.height - bounds.bottom);
    ctx.stroke();
    
    ctx.beginPath();
    ctx.moveTo(s2X, bounds.top);
    ctx.lineTo(s2X, rect.height - bounds.bottom);
    ctx.stroke();
    
    // Sector Labels at top of Speed trace
    if (name === 'Speed trace') {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.font = '8px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('SECTOR 1', bounds.left + (s1X - bounds.left)/2, bounds.top + 12);
      ctx.fillText('SECTOR 2', s1X + (s2X - s1X)/2, bounds.top + 12);
      ctx.fillText('SECTOR 3', s2X + (rect.width - bounds.right - s2X)/2, bounds.top + 12);
      ctx.textAlign = 'left';
    }
  }
  
  // Draw Corner dotted lines
  if ($('#cornerToggle').checked && corners.length) {
    corners.forEach(corner => {
      const fraction = cornerFraction(corner, refSamples, totalDist);
      if (Number.isFinite(fraction) && fraction > 0 && fraction <= 1) {
        const x = bounds.left + fraction * (rect.width - bounds.left - bounds.right);
        
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.lineWidth = 0.8;
        ctx.setLineDash([2, 3]);
        
        ctx.beginPath();
        ctx.moveTo(x, bounds.top);
        ctx.lineTo(x, rect.height - bounds.bottom);
        ctx.stroke();
        ctx.setLineDash([]);
        
        ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
        ctx.font = '8px monospace';
        const labelY = name === 'Speed trace' ? bounds.top + 10 : bounds.top - 2;
        ctx.fillText(`T${corner.number}`, x - 4, labelY);
      }
    });
  }
  
  // Draw paths for each driver
  loaded.forEach((lap, index) => {
    const series = telemetryCache.get(telemetryKey(lap));
    if (!series) return;
    
    const teamColor = getDriverColor(lap.code);
    const refSeries = telemetryCache.get(telemetryKey(loaded[0]));
    
    // Speed uses its original telemetry samples. This keeps corner-speed dots
    // exactly on the rendered line rather than on a separate 180-point grid.
    const points = [];
    if (name === 'Speed trace') {
      const ownTotal = series[series.length - 1]?.Distance || 1;
      series.forEach(point => {
        const fraction = Math.max(0, Math.min(1, (+point.Distance || 0) / ownTotal));
        const value = +point.Speed;
        if (Number.isFinite(value)) {
          const x = bounds.left + fraction * (rect.width - bounds.left - bounds.right);
          const y = bounds.top + (bounds.max - value) / (bounds.max - bounds.min || 1) * (rect.height - bounds.top - bounds.bottom);
          points.push({ x, y });
        }
      });
    } else {
      const steps = 180;
      for (let step = 0; step <= steps; step++) {
        const fraction = step / steps;
        const targetDist = totalDist * fraction;
        const value = name === 'Timing delta' ? (index === 0 ? 0 : deltaAt(series, refSeries, targetDist)) : interpolate(series, targetDist, field);
        if (Number.isFinite(value)) {
          const x = bounds.left + fraction * (rect.width - bounds.left - bounds.right);
          const y = bounds.top + (bounds.max - value) / (bounds.max - bounds.min || 1) * (rect.height - bounds.top - bounds.bottom);
          points.push({ x, y });
        }
      }
    }
    
    if (!points.length) return;
    
    // Draw translucent filled gradient area below line (only for non-discrete fields)
    const shadedFields = ['Speed trace', 'Throttle application', 'Brake pressure', 'Engine speed'];
    if (shadedFields.includes(name)) {
      const bottomY = rect.height - bounds.bottom;
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      points.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
      ctx.lineTo(points[points.length - 1].x, bottomY);
      ctx.lineTo(points[0].x, bottomY);
      ctx.closePath();
      
      const grad = ctx.createLinearGradient(0, bounds.top, 0, bottomY);
      grad.addColorStop(0, hexToRgba(teamColor, 0.15));
      grad.addColorStop(1, hexToRgba(teamColor, 0));
      ctx.fillStyle = grad;
      ctx.fill();
    }
    
    // Draw trace path line
    ctx.strokeStyle = teamColor;
    ctx.lineWidth = index === 0 ? 1.8 : 1.4;
    
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    points.slice(1).forEach((p, idx) => {
      if (name === 'Gear' || name === 'DRS / straight-line mode') {
        const prev = points[idx];
        ctx.lineTo(p.x, prev.y);
      }
      ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();
  });
  
  // Draw Corner apex min speed dots on the Speed trace chart (with clean text labels stacked at the top)
  if (name === 'Speed trace' && $('#cornerToggle').checked && corners.length) {
    corners.forEach(corner => {
      const markerFraction = cornerFraction(corner, refSamples, totalDist) ?? (Number(corner.distance) / totalDist);
      if (!Number.isFinite(markerFraction)) return;
      const x = bounds.left + markerFraction * (rect.width - bounds.left - bounds.right);
      if (x < bounds.left || x > rect.width - bounds.right) return;
      
      // Draw turn label pill
      ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.fillRect(x - 14, 2, 28, 12);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x - 14, 2, 28, 12);
      
      ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.font = '8px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`T${corner.number}`, x, 11);
      
      // Corner dots & stacked speed values
      loaded.forEach((lap, index) => {
        const samples = telemetryCache.get(telemetryKey(lap));
        if (!samples || !samples.length) return;
        
        const teamColor = getDriverColor(lap.code);
        const apexPt = getCornerMinSpeed(samples, corner);
        const markerSpeed = apexPt?.cornerSpeed ?? interpolate(samples, totalDist * markerFraction, 'Speed');
        
        if (Number.isFinite(markerSpeed)) {
          const markerY = bounds.top + (bounds.max - markerSpeed) / (bounds.max - bounds.min || 1) * (rect.height - bounds.top - bounds.bottom);
          ctx.beginPath();
          ctx.arc(x, markerY, 2.5, 0, 2 * Math.PI);
          ctx.fillStyle = teamColor;
          ctx.fill();
          
          // Stack text speed numbers under the turn pill
          const textY = 24 + index * 10;
          ctx.fillStyle = teamColor;
          ctx.font = '8px monospace';
          ctx.fillText(Math.round(markerSpeed), x, textY);
        }
      });
      
      ctx.textAlign = 'left'; // restore default alignment
    });
  }
  
  // Render hover crosshair and marker circle
  if (hoverFraction !== null) {
    const crosshairX = bounds.left + hoverFraction * (rect.width - bounds.left - bounds.right);
    
    // Draw vertical crosshair line
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(crosshairX, bounds.top);
    ctx.lineTo(crosshairX, rect.height - bounds.bottom);
    ctx.stroke();
    
    // Draw intersection highlighted circle on each line
    loaded.forEach((lap, index) => {
      const series = telemetryCache.get(telemetryKey(lap));
      if (!series) return;
      
      const refSeries = telemetryCache.get(telemetryKey(loaded[0]));
      const targetDist = totalDist * hoverFraction;
      const val = name === 'Timing delta' ? (index === 0 ? 0 : deltaAt(series, refSeries, targetDist)) : interpolate(series, targetDist, field);
      
      if (Number.isFinite(val)) {
        const x = crosshairX;
        const y = bounds.top + (bounds.max - val) / (bounds.max - bounds.min || 1) * (rect.height - bounds.top - bounds.bottom);
        const teamColor = getDriverColor(lap.code);
        
        ctx.fillStyle = teamColor;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.shadowColor = teamColor;
        ctx.shadowBlur = 8;
        
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        
        ctx.shadowBlur = 0; // reset shadow
      }
    });
  }
}

// Binds hover interactions on all canvas charts
function bindAllChartHover() {
  const canvases = document.querySelectorAll('canvas[data-chart]');
  const tooltip = $('#realTooltip');
  const telemetryCard = $('.telemetry-card');
  
  canvases.forEach(canvas => {
    canvas.addEventListener('mousemove', e => {
      if (!loaded.length) return;
      
      const rect = canvas.getBoundingClientRect();
      const printableWidth = rect.width - 43 - 7;
      const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left - 43) / printableWidth));
      
      hoverFraction = fraction;
      hoveredChartName = canvas.dataset.chart;
      
      // Repaint all charts and track map to show synchronized crosshair and ball tracker
      defs.forEach(def => drawRealChart(def[0]));
      renderMiniSectorMap();
      
      // Update floating tooltip content
      const field = chartField[hoveredChartName];
      const currentDef = defs.find(def => def[0] === hoveredChartName);
      const unit = currentDef ? currentDef[1] : '';
      
      const refSamples = telemetryCache.get(telemetryKey(loaded[0]));
      const maxDistance = refSamples && refSamples.length ? refSamples[refSamples.length - 1].Distance : 5891;
      const distanceKM = (fraction * maxDistance) / 1000;
      
      const lines = loaded.map((lap, index) => {
        const series = telemetryCache.get(telemetryKey(lap));
        let val = null;
        const targetDist = fraction * maxDistance;
        if (hoveredChartName === 'Timing delta') {
          val = index === 0 ? 0 : deltaAt(series, refSamples, targetDist);
        } else {
          val = interpolate(series, targetDist, field);
        }
        
        let display = '—';
        if (Number.isFinite(val)) {
          if (hoveredChartName === 'Timing delta') {
            display = `${val >= 0 ? '+' : ''}${val.toFixed(3)}s`;
          } else if (hoveredChartName === 'DRS / straight-line mode') {
            display = val >= 0.5 ? 'OPEN' : 'CLOSED';
          } else {
            display = `${Math.round(val)} ${unit}`;
          }
        }
        return `<span style="color: ${getDriverColor(lap.code)}">●</span> ${lap.code} L${lap.lap} · <b>${display}</b>`;
      });
      
      tooltip.innerHTML = `<b>${distanceKM.toFixed(3)} KM</b><br>${lines.join('<br>')}`;
      tooltip.style.display = 'block';
      
      const parentRect = telemetryCard.getBoundingClientRect();
      const xPos = e.clientX - parentRect.left + 15;
      const yPos = e.clientY - parentRect.top + 15;
      tooltip.style.left = `${xPos}px`;
      tooltip.style.top = `${yPos}px`;
    });
    
    canvas.addEventListener('mouseleave', () => {
      hoverFraction = null;
      hoveredChartName = null;
      tooltip.style.display = 'none';
      defs.forEach(def => drawRealChart(def[0]));
      renderMiniSectorMap();
    });
  });
}

function bindTrackMapHover() {
  const canvas = $('#dominanceCanvas');
  const tooltip = $('#realTooltip');
  const telemetryCard = $('.telemetry-card');
  if (!canvas) return;

  canvas.addEventListener('mousemove', e => {
    if (loaded.length < 2) return;
    const reference = telemetryCache.get(telemetryKey(loaded[0]));
    if (!reference?.length) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const trackSamples = reference.filter(point => Number.isFinite(+point.X) && Number.isFinite(+point.Y));
    if (!trackSamples.length) return;

    const minX = Math.min(...trackSamples.map(p => +p.X));
    const maxX = Math.max(...trackSamples.map(p => +p.X));
    const minY = Math.min(...trackSamples.map(p => +p.Y));
    const maxY = Math.max(...trackSamples.map(p => +p.Y));

    const padding = 18;
    const scale = Math.min((rect.width - padding * 2) / (maxX - minX || 1), (rect.height - padding * 2) / (maxY - minY || 1));
    const offsetX = (rect.width - (maxX - minX) * scale) / 2;
    const offsetY = (rect.height - (maxY - minY) * scale) / 2;
    const toCanvas = (x, y) => ({ x: offsetX + (x - minX) * scale, y: rect.height - offsetY - (y - minY) * scale });

    let minDistanceSq = Infinity;
    let bestFraction = null;
    const totalDistance = reference[reference.length - 1].Distance || 1;

    trackSamples.forEach(point => {
      const cPos = toCanvas(+point.X, +point.Y);
      const dSq = (cPos.x - mouseX) ** 2 + (cPos.y - mouseY) ** 2;
      if (dSq < minDistanceSq) {
        minDistanceSq = dSq;
        bestFraction = (+point.Distance || 0) / totalDistance;
      }
    });

    if (bestFraction !== null && minDistanceSq < 4000) {
      hoverFraction = bestFraction;
      hoveredChartName = 'Track map';

      defs.forEach(def => drawRealChart(def[0]));
      renderMiniSectorMap();

      if (tooltip && telemetryCard) {
        const distanceKM = (bestFraction * totalDistance) / 1000;
        const lines = loaded.map(lap => {
          const series = telemetryCache.get(telemetryKey(lap));
          const targetDist = bestFraction * totalDistance;
          const speed = interpolate(series, targetDist, 'Speed');
          const speedDisplay = Number.isFinite(speed) ? `${Math.round(speed)} KM/H` : '—';
          return `<span style="color: ${getDriverColor(lap.code)}">●</span> ${lap.code} L${lap.lap} · <b>${speedDisplay}</b>`;
        });

        tooltip.innerHTML = `<b>TRACK MAP · ${distanceKM.toFixed(3)} KM</b><br>${lines.join('<br>')}`;
        tooltip.style.display = 'block';

        const parentRect = telemetryCard.getBoundingClientRect();
        const xPos = e.clientX - parentRect.left + 15;
        const yPos = e.clientY - parentRect.top + 15;
        tooltip.style.left = `${xPos}px`;
        tooltip.style.top = `${yPos}px`;
      }
    }
  });

  canvas.addEventListener('mouseleave', () => {
    if (hoveredChartName === 'Track map') {
      hoverFraction = null;
      hoveredChartName = null;
      if (tooltip) tooltip.style.display = 'none';
      defs.forEach(def => drawRealChart(def[0]));
      renderMiniSectorMap();
    }
  });
}

async function drawAll() {
  const promises = loaded.map(async lap => {
    try {
      await fetchTelemetry(lap);
    } catch (err) {
      console.warn(err);
      alert(`Telemetry trace data is unavailable for ${lap.code} Lap ${lap.lap}.`);
      loaded = loaded.filter(x => !(x.code === lap.code && x.lap === lap.lap));
      renderLoaded();
      renderSectors();
      renderStints();
    }
  });
  await Promise.all(promises);
  const season = Number($('#year').value);
  const activeDefs = season >= 2026
    ? defs.filter(([name]) => name !== 'DRS')
    : defs;
  activeDefs.forEach(definition => drawRealChart(definition[0]));
  renderMiniSectorMap();
}

function renderAll() {
  renderLoaded();
  renderSectors();
  drawAll();
}

function renderApexSpeeds() {
  const root = $('#apexSpeeds');
  if (!root) return;
  
  if (!loaded.length || !corners.length || !$('#cornerToggle').checked) {
    root.innerHTML = '<span class="section-empty">Apex speeds appear when corner overlays are active.</span>';
    return;
  }
  
  const refLap = loaded[0];
  const refSamples = telemetryCache.get(telemetryKey(refLap));
  if (!refSamples || !refSamples.length) {
    root.innerHTML = '<span class="section-empty">Loading telemetry data…</span>';
    return;
  }
  
  const totalDist = refSamples[refSamples.length - 1].Distance || 5891;
  
  root.innerHTML = corners.map(corner => {
    const driverSpeeds = loaded.map(lap => {
      const samples = telemetryCache.get(telemetryKey(lap));
      if (!samples || !samples.length) return null;
      
      const apexPt = getCornerMinSpeed(samples, corner);
      if (!apexPt || !Number.isFinite(apexPt.cornerSpeed)) return null;
      
      return {
        code: lap.code,
        color: getDriverColor(lap.code),
        speed: Math.round(apexPt.cornerSpeed)
      };
    }).filter(Boolean);
    
    if (!driverSpeeds.length) return '';
    
    const valsHtml = driverSpeeds.map(ds => `
      <div class="apex-speed-val" style="color:${ds.color}">
        <span>${ds.code}</span>
        <strong>${ds.speed}</strong>
      </div>
    `).join('');
    
    return `
      <div class="apex-speed-card">
        <strong>T${corner.number}</strong>
        ${valsHtml}
      </div>
    `;
  }).join('');
}

function renderMiniSectorMap() {
  const canvas = $('#dominanceCanvas');
  const empty = $('#dominanceEmpty');
  const legend = $('#dominanceLegend');
  if (!canvas || !empty || !legend) return;

  if (loaded.length < 2) {
    canvas.style.display = 'none';
    empty.style.display = 'block';
    empty.textContent = 'Load at least two laps to compare mini-sector dominance.';
    legend.innerHTML = '';
    return;
  }

  const reference = telemetryCache.get(telemetryKey(loaded[0]));
  const allSeries = loaded.map(lap => telemetryCache.get(telemetryKey(lap)));
  const trackSamples = reference?.filter(point => Number.isFinite(+point.X) && Number.isFinite(+point.Y)) || [];
  if (!reference?.length || !allSeries.every(series => series?.length) || trackSamples.length < 2) {
    canvas.style.display = 'none';
    empty.style.display = 'block';
    empty.textContent = 'Track-position telemetry is unavailable for this comparison.';
    legend.innerHTML = '';
    return;
  }

  // The stylesheet hides the canvas until a comparison exists. Reveal it
  // before measuring: a hidden canvas reports a 0 × 0 drawing area.
  canvas.style.display = 'block';
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    canvas.style.display = 'none';
    empty.style.display = 'block';
    empty.textContent = 'Track map could not be sized. Resize the page and try again.';
    return;
  }
  const dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, rect.width, rect.height);

  const minX = Math.min(...trackSamples.map(point => +point.X));
  const maxX = Math.max(...trackSamples.map(point => +point.X));
  const minY = Math.min(...trackSamples.map(point => +point.Y));
  const maxY = Math.max(...trackSamples.map(point => +point.Y));
  const padding = 18;
  const scale = Math.min((rect.width - padding * 2) / (maxX - minX || 1), (rect.height - padding * 2) / (maxY - minY || 1));
  const offsetX = (rect.width - (maxX - minX) * scale) / 2;
  const offsetY = (rect.height - (maxY - minY) * scale) / 2;
  const toCanvas = (x, y) => ({ x: offsetX + (x - minX) * scale, y: rect.height - offsetY - (y - minY) * scale });
  const totalDistance = reference[reference.length - 1].Distance || 1;
  const segmentLength = 25;
  const segments = Math.ceil(totalDistance / segmentLength);

  const pointAt = fraction => {
    const distance = totalDistance * fraction;
    const x = interpolate(reference, distance, 'X');
    const y = interpolate(reference, distance, 'Y');
    return Number.isFinite(x) && Number.isFinite(y) ? toCanvas(x, y) : null;
  };

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.beginPath();
  trackSamples.forEach((point, index) => {
    const pos = toCanvas(+point.X, +point.Y);
    if (index === 0) ctx.moveTo(pos.x, pos.y);
    else ctx.lineTo(pos.x, pos.y);
  });
  ctx.stroke();

  const wins = new Set();
  for (let index = 0; index < segments; index++) {
    const start = index / segments;
    const end = Math.min(1, (index + 1) / segments);
    const from = pointAt(start);
    const to = pointAt(end);
    if (!from || !to) continue;
    let winner = -1;
    let bestTime = Infinity;
    allSeries.forEach((series, lapIndex) => {
      const startTime = calibratedElapsed(series, start);
      const endTime = calibratedElapsed(series, end);
      const duration = Number.isFinite(startTime) && Number.isFinite(endTime)
        ? endTime - startTime
        : null;
      if (Number.isFinite(duration) && duration < bestTime) {
        bestTime = duration;
        winner = lapIndex;
      }
    });
    if (winner < 0) continue;
    wins.add(winner);
    ctx.strokeStyle = getDriverColor(loaded[winner].code);
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }

  // Corner markers rendered ON TOP of mini-sector dominance lines
  if ($('#cornerToggle').checked && corners.length) {
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    corners.forEach(corner => {
      let x = Number(corner.x), y = Number(corner.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        const markerFrac = cornerFraction(corner, reference, totalDistance) ?? (Number(corner.distance) / totalDistance);
        if (Number.isFinite(markerFrac)) {
          const interpX = interpolate(reference, totalDistance * markerFrac, 'X');
          const interpY = interpolate(reference, totalDistance * markerFrac, 'Y');
          if (Number.isFinite(interpX) && Number.isFinite(interpY)) {
            x = interpX;
            y = interpY;
          }
        }
      }
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      const point = toCanvas(x, y);
      const angle = Number(corner.angle);
      const offsetX = Number.isFinite(angle) ? Math.cos(angle * Math.PI / 180) * 11 : 0;
      const offsetY = Number.isFinite(angle) ? -Math.sin(angle * Math.PI / 180) * 11 : -11;
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#101114';
      ctx.strokeText(`T${corner.number}`, point.x + offsetX, point.y + offsetY);
      ctx.fillStyle = 'rgba(255,255,255,.92)';
      ctx.fillText(`T${corner.number}`, point.x + offsetX, point.y + offsetY);
    });
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
  }

  // Ball Tracker indicator when hovering (telemetry charts or track map)
  if (hoverFraction !== null) {
    const hPoint = pointAt(hoverFraction);
    if (hPoint) {
      const refColor = getDriverColor(loaded[0].code);
      ctx.fillStyle = hexToRgba(refColor, 0.35);
      ctx.beginPath();
      ctx.arc(hPoint.x, hPoint.y, 10, 0, 2 * Math.PI);
      ctx.fill();
      
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(hPoint.x, hPoint.y, 4.5, 0, 2 * Math.PI);
      ctx.fill();
      ctx.strokeStyle = refColor;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  empty.style.display = 'none';
  legend.innerHTML = [...wins].map(index => {
    const lap = loaded[index];
    return `<span class="legend-item"><i class="legend-color" style="--team:${getDriverColor(lap.code)}"></i>${lap.code} L${lap.lap}</span>`;
  }).join('');
}

// Initial Setup on Document Load
document.addEventListener('DOMContentLoaded', () => {
  const yearSelect = $('#year');
  const currentYear = new Date().getFullYear();
  const years = [];
  for (let y = currentYear; y >= 2018; y--) {
    years.push(y);
  }
  populate(yearSelect, years);
  yearSelect.value = String(years[0]); // default to latest available season
  
  yearSelect.addEventListener('change', () => loadCalendar().catch(error => alert(error.message)));
  $('#gp').addEventListener('change', populateSessions);
  $('#loadSession').onclick = loadRealSession;
  
  $('#cornerToggle').addEventListener('change', event => {
    $('#cornerStatus').textContent = event.target.checked
      ? 'Corner overlays active.'
      : 'Corner labels hidden.';
    if (loaded.length) {
      drawAll();
    }
  });
  
  const toggleBtn = $('#sidebarToggle');
  const mainEl = $('main');
  if (toggleBtn && mainEl) {
    toggleBtn.onclick = () => {
      const isCollapsed = mainEl.classList.toggle('sidebar-collapsed');
      toggleBtn.textContent = isCollapsed ? '▶ Expand Controls' : '◀ Toggle Controls';
      if (loaded.length) {
        drawAll();
      }
    };
  }
  
  window.addEventListener('resize', () => {
    if (loaded.length) {
      drawAll();
    }
  });
  
  clearBeforeSessionLoad();
  renderCharts();
  bindTrackMapHover();
  
  loadCalendar()
    .then(selectLatestCompletedEvent)
    .catch(error => {
      $('#gp').innerHTML = '<option>Calendar unavailable</option>';
      console.warn(error);
    });
});

// Pirelli Tyre Compounds Helpers
function getCompoundCode(compound, nominated) {
  if (!nominated || nominated.length < 3) return compound;
  const comp = String(compound).toUpperCase().replace(/\s+/g, '');
  if (comp === 'HARD') return `HARD (${nominated[0]})`;
  if (comp === 'MEDIUM') return `MEDIUM (${nominated[1]})`;
  if (comp === 'SOFT') return `SOFT (${nominated[2]})`;
  return compound;
}

function getCompoundAbbreviation(comp) {
  const c = String(comp).toUpperCase().replace(/\s+/g, '');
  if (c.includes('HYPER')) return 'HS';
  if (c.includes('ULTRA')) return 'US';
  if (c.includes('SUPER')) return 'SS';
  if (c.includes('SOFT')) return 'S';
  if (c.includes('MEDIUM')) return 'M';
  if (c.includes('HARD')) return 'H';
  if (c.includes('WET')) return 'W';
  if (c.includes('INTER')) return 'I';
  return comp;
}

function renderTireNomination() {
  const card = $('#tireCard');
  const root = $('#tireNomination');
  if (!card || !root) return;
  
  if (!nominatedCompounds || !nominatedCompounds.length) {
    card.style.display = 'none';
    return;
  }
  
  card.style.display = 'block';
  
  const labels = ['Hard', 'Medium', 'Soft'];
  const colors = ['#ffffff', '#ffd700', '#ff0055']; // White, Yellow, Red
  
  root.innerHTML = nominatedCompounds.map((comp, i) => {
    const isC = /^C[1-6]$/i.test(comp);
    const label = isC ? (labels[i] || 'Nominated') : comp;
    const displayVal = isC ? comp : getCompoundAbbreviation(comp);
    const color = colors[i] || '#888888';
    
    return `
      <div class="tire-badge">
        <div class="tire-circle" style="--tire-color:${color}">${displayVal}</div>
        <span class="tire-label">${label}</span>
      </div>
    `;
  }).join('');
}

function getCornerMinSpeed(samples, cornerDistance) {
  const windowSize = 100;
  const nearby = samples.filter(pt => Math.abs(pt.Distance - cornerDistance) <= windowSize);
  if (!nearby.length) return null;
  
  const valleys = [];
  for (let i = 1; i < nearby.length - 1; i++) {
    if (nearby[i].Speed < nearby[i-1].Speed && nearby[i].Speed <= nearby[i+1].Speed) {
      valleys.push(nearby[i]);
    }
  }
  
  if (valleys.length) {
    return valleys.reduce((a, b) => Math.abs(a.Distance - cornerDistance) < Math.abs(b.Distance - cornerDistance) ? a : b);
  }
  
  const speedAtApex = interpolate(samples, cornerDistance, 'Speed');
  return { Distance: cornerDistance, Speed: speedAtApex };
}
