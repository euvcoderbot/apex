// Consolidated F1 Telemetry Hub Application Logic
let drivers = [];
let selected = [];
let loaded = [];
let openStint = {};
let realDrivers = new Map();
const telemetryCache = new Map();
const telemetryRequests = new Map();
const driverColorOverrides = new Map();
const customSelectValues = new WeakMap();
let calendar = [];
let corners = [];
let circuitRotation = 0;
let nominatedCompounds = [];
let activeDriverTab = null;
let selectedCornerIndex = 0;
let showCornerNumbers = false;
let enhancedTraceMode = false;
let traceTintEnabled = false;
const hiddenTraceKeys = new Set();
let dominanceMapHitPoints = [];
let dominanceMapGeometryCache = null;

let hoverFraction = null;
let hoveredChartName = null;
let traceZoom = { start: 0, end: 1 };
let zoomDrag = null;
let drawGeneration = 0;
let sessionRequest = null;
let calendarRequest = null;
let calendarGeneration = 0;
let redrawFrame = 0;
let toastTimer = 0;
const MIN_TRACE_ZOOM = .004;
const CLIENT_DATA_SCHEMA = 'lap-context-v2';
const API_ORIGIN = String(window.APEX_API_ORIGIN || '').replace(/\/$/, '');

function apiUrl(path) {
  return `${API_ORIGIN}${path}`;
}

function notify(message, tone = 'error') {
  const toast = $('#appToast');
  if (!toast) return;
  window.clearTimeout(toastTimer);
  toast.textContent = String(message || 'Something went wrong.');
  toast.dataset.tone = tone;
  toast.classList.add('is-visible');
  toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 5200);
}

function scheduleDrawAll() {
  if (redrawFrame) return;
  redrawFrame = window.requestAnimationFrame(() => {
    redrawFrame = 0;
    if (loaded.length) drawAll();
  });
}

const COUNTRY_FLAG_CODES = Object.freeze({
  australia: 'AU',
  austria: 'AT',
  azerbaijan: 'AZ',
  bahrain: 'BH',
  belgium: 'BE',
  brazil: 'BR',
  canada: 'CA',
  china: 'CN',
  france: 'FR',
  germany: 'DE',
  'great britain': 'GB',
  hungary: 'HU',
  india: 'IN',
  italy: 'IT',
  japan: 'JP',
  korea: 'KR',
  malaysia: 'MY',
  mexico: 'MX',
  monaco: 'MC',
  netherlands: 'NL',
  portugal: 'PT',
  qatar: 'QA',
  russia: 'RU',
  'saudi arabia': 'SA',
  singapore: 'SG',
  'south korea': 'KR',
  spain: 'ES',
  turkey: 'TR',
  'united arab emirates': 'AE',
  'united kingdom': 'GB',
  'united states': 'US',
  usa: 'US',
});

const GRAND_PRIX_FLAG_RULES = Object.freeze([
  ['70th anniversary', 'GB'],
  ['abu dhabi', 'AE'],
  ['australian', 'AU'],
  ['austrian', 'AT'],
  ['azerbaijan', 'AZ'],
  ['bahrain', 'BH'],
  ['belgian', 'BE'],
  ['brazilian', 'BR'],
  ['british', 'GB'],
  ['canadian', 'CA'],
  ['chinese', 'CN'],
  ['dutch', 'NL'],
  ['eifel', 'DE'],
  ['emilia romagna', 'IT'],
  ['european', 'AZ'],
  ['french', 'FR'],
  ['german', 'DE'],
  ['hungarian', 'HU'],
  ['indian', 'IN'],
  ['italian', 'IT'],
  ['japanese', 'JP'],
  ['korean', 'KR'],
  ['las vegas', 'US'],
  ['malaysian', 'MY'],
  ['mexico', 'MX'],
  ['miami', 'US'],
  ['monaco', 'MC'],
  ['pacific', 'JP'],
  ['portuguese', 'PT'],
  ['qatar', 'QA'],
  ['russian', 'RU'],
  ['sakhir', 'BH'],
  ['san marino', 'IT'],
  ['saudi arabian', 'SA'],
  ['singapore', 'SG'],
  ['sao paulo', 'BR'],
  ['spanish', 'ES'],
  ['styrian', 'AT'],
  ['turkish', 'TR'],
  ['tuscan', 'IT'],
  ['united states', 'US'],
]);

function normalizedPlaceName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function flagEmoji(code) {
  if (!/^[A-Z]{2}$/.test(code || '')) return '🏁';
  return [...code].map(letter => String.fromCodePoint(127397 + letter.charCodeAt(0))).join('');
}

function grandPrixFlag(event) {
  const country = normalizedPlaceName(event?.country);
  const eventName = normalizedPlaceName(event?.name);
  const code = COUNTRY_FLAG_CODES[country]
    || GRAND_PRIX_FLAG_RULES.find(([name]) => eventName.includes(name))?.[1];
  return flagEmoji(code);
}

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

function lightThemeActive() {
  return document.documentElement.dataset.theme === 'light';
}

function canvasTheme() {
  return lightThemeActive() ? {
    text: 'rgba(20, 25, 32, .56)',
    textStrong: 'rgba(20, 25, 32, .82)',
    grid: 'rgba(20, 25, 32, .09)',
    gridStrong: 'rgba(20, 25, 32, .24)',
    panel: 'rgba(250, 251, 252, .97)',
    outline: 'rgba(20, 25, 32, .22)',
    mapBase: 'rgba(20, 25, 32, .16)',
    labelStroke: 'rgba(250, 251, 252, .96)',
    labelFill: 'rgba(20, 25, 32, .92)',
    crosshair: 'rgba(20, 25, 32, .3)',
  } : {
    text: 'rgba(255, 255, 255, .35)',
    textStrong: 'rgba(255, 255, 255, .72)',
    grid: 'rgba(255, 255, 255, .05)',
    gridStrong: 'rgba(255, 255, 255, .25)',
    panel: 'rgba(12, 14, 18, .94)',
    outline: 'rgba(255, 255, 255, .22)',
    mapBase: 'rgba(255, 255, 255, .12)',
    labelStroke: '#101114',
    labelFill: 'rgba(255,255,255,.92)',
    crosshair: 'rgba(255, 255, 255, .25)',
  };
}

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
  if (driverColorOverrides.has(code)) return driverColorOverrides.get(code);
  const display = drivers.find(item => item[0] === code);
  return display ? display[3] : '#777777';
}

function currentQuery() {
  const selectedVal = selectValue($('#gp'));
  const event = calendar.find(item => String(item.round) === String(selectedVal) || item.name === selectedVal) || calendar[0];
  const params = new URLSearchParams();
  params.set('year', selectValue($('#year')));
  if (event) {
    params.set('gp', event.name);
    params.set('round', event.round);
  } else if (selectedVal) {
    params.set('gp', selectedVal);
  }
  params.set('session', selectValue($('#session')));
  // Keep the URL identity in step with lap-boundary and lap-context changes.
  // The API ignores this field, while browsers cannot reuse an older payload.
  params.set('data_schema', CLIENT_DATA_SCHEMA);
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

function traceLapIsVisible(lap) {
  return !hiddenTraceKeys.has(telemetryKey(lap));
}

function visibleTraceLaps() {
  return loaded.map((lap, index) => ({ lap, index })).filter(({ lap }) => traceLapIsVisible(lap));
}

// Populate select utilities
function selectValue(select) {
  return select && customSelectValues.has(select) ? customSelectValues.get(select) : (select?.value || '');
}

function selectCustomOption(optionButton) {
  const shell = optionButton.closest('.select-shell');
  const select = shell?.querySelector('select');
  const trigger = shell?.querySelector('.select-trigger');
  const optionIndex = Number(optionButton.getAttribute('data-select-index'));
  if (!select || !Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= select.options.length) return;
  customSelectValues.set(select, select.options[optionIndex].value);
  select.selectedIndex = optionIndex;
  shell.classList.remove('is-open');
  trigger?.setAttribute('aria-expanded', 'false');
  syncSelectUI(select);
  if (select.id !== 'session') select.dispatchEvent(new Event('change', { bubbles: true }));
  trigger?.focus();
}

function populate(select, values, valueFor = x => x, labelFor = x => x) {
  customSelectValues.delete(select);
  select.innerHTML = values.map(val => `<option value="${valueFor(val)}">${labelFor(val)}</option>`).join('');
  syncSelectUI(select);
}

function syncSelectUI(select) {
  const shell = select?.closest('.select-shell');
  const trigger = shell?.querySelector('.select-trigger');
  const menu = shell?.querySelector('.select-menu');
  if (!trigger || !menu) return;
  const options = [...select.options];
  const selectedOption = options.find(option => option.value === selectValue(select)) || options[0];
  trigger.querySelector('span').textContent = selectedOption?.textContent || 'Select';
  trigger.disabled = select.disabled;
  trigger.setAttribute('aria-expanded', String(shell.classList.contains('is-open')));
  menu.innerHTML = options.map((option, optionIndex) => `
    <button type="button" role="option" aria-selected="${option === selectedOption}" data-select-index="${optionIndex}" data-select-value="${encodeURIComponent(option.value)}" onclick="selectCustomOption(this)">
      ${option.textContent}
    </button>`).join('');
}

function enhanceSelect(select) {
  const shell = select.closest('.select-shell');
  if (!shell || shell.dataset.enhanced === 'true') return;
  shell.dataset.enhanced = 'true';
  select.classList.add('native-select-proxy');
  select.tabIndex = -1;
  select.setAttribute('aria-hidden', 'true');
  shell.insertAdjacentHTML('beforeend', `
    <button class="select-trigger" type="button" role="combobox" aria-haspopup="listbox" aria-expanded="false"><span>Select</span><i aria-hidden="true"></i></button>
    <div class="select-menu" role="listbox"></div>`);
  const trigger = shell.querySelector('.select-trigger');
  const menu = shell.querySelector('.select-menu');
  const close = () => {
    shell.classList.remove('is-open');
    trigger.setAttribute('aria-expanded', 'false');
  };
  trigger.addEventListener('click', event => {
    event.stopPropagation();
    document.querySelectorAll('.select-shell.is-open').forEach(openShell => {
      if (openShell !== shell) {
        openShell.classList.remove('is-open');
        openShell.querySelector('.select-trigger')?.setAttribute('aria-expanded', 'false');
      }
    });
    const open = shell.classList.toggle('is-open');
    trigger.setAttribute('aria-expanded', String(open));
    if (open) menu.querySelector('[aria-selected="true"]')?.focus({ preventScroll: true });
  });
  menu.addEventListener('keydown', event => {
    const items = [...menu.querySelectorAll('[data-select-value]')];
    const index = items.indexOf(document.activeElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      items[(index + direction + items.length) % items.length]?.focus();
    } else if (event.key === 'Escape') {
      close();
      trigger.focus();
    }
  });
  syncSelectUI(select);
}

// Calendar API Loader
async function loadCalendar() {
  const generation = ++calendarGeneration;
  if (calendarRequest) calendarRequest.abort();
  calendarRequest = new AbortController();
  const year = selectValue($('#year'));
  queueMicrotask(() => syncSelectUI($('#gp')));
  customSelectValues.delete($('#gp'));
  $('#gp').innerHTML = '<option>Loading calendar…</option>';
  try {
    const response = await fetch(apiUrl(`/api/events?year=${year}`), { signal: calendarRequest.signal });
    const payload = await readApiResponse(response);
    if (!response.ok) throw new Error(payload.detail || 'Calendar unavailable');
    if (generation !== calendarGeneration || year !== selectValue($('#year'))) return;
    calendar = payload;
    $('#gp').innerHTML = calendar.map(event => `<option value="${event.round}">R${event.round} - ${grandPrixFlag(event)} ${event.name}</option>`).join('');
    syncSelectUI($('#gp'));
    selectLatestCompletedEvent();
  } catch (error) {
    if (error.name === 'AbortError') return;
    notify(`Could not load calendar. ${error.message}`);
    throw error;
  }
}

function populateSessions() {
  const selectedVal = selectValue($('#gp'));
  const event = calendar.find(item => String(item.round) === String(selectedVal) || item.name === selectedVal) || calendar[0];
  const sessions = event?.sessions || [];
  populate($('#session'), sessions);
  if (!sessions.length) return;

  const now = Date.now();
  const completed = sessions.filter(name => {
    const value = event?.session_dates?.[name];
    const sessionDate = value ? new Date(value).getTime() : NaN;
    return Number.isFinite(sessionDate) && sessionDate <= now;
  });
  if (completed.length) {
    $('#session').value = completed[completed.length - 1];
  } else {
    // For historical calendars without per-session timestamps, select the
    // final listed session. No session data is fetched until Load session.
    $('#session').value = sessions[sessions.length - 1];
  }
  syncSelectUI($('#session'));
}

function selectLatestCompletedEvent() {
  const now = Date.now();
  // A weekend may be in progress: choose the event containing the newest
  // completed session (e.g. Hungary FP1), not the previous Sunday's race.
  const completed = calendar.filter(event => Object.values(event.session_dates || {})
    .some(value => Number.isFinite(new Date(value).getTime()) && new Date(value).getTime() <= now));
  const latest = completed.length ? completed[completed.length - 1] : calendar[0];
  if (latest) {
    customSelectValues.delete($('#gp'));
    $('#gp').value = String(latest.round);
  }
  syncSelectUI($('#gp'));
  populateSessions();
}

function lapText(lap) {
  const displayTime = Number.isFinite(lap.display_time) ? lap.display_time : lap.time;
  const prefix = lap.display_time_estimated ? '~' : '';
  if (lap.out_lap) return `OUT L${lap.lap} · ${Number.isFinite(displayTime) ? `${prefix}${time(displayTime)}` : '—'}`;
  if (lap.in_lap) return `IN L${lap.lap} · ${lap.time == null ? '—' : `${time(lap.time)}`}`;
  return `L${lap.lap} · ${lap.time == null ? '—' : `${time(lap.time)}`}`;
}

// UI State Resets
function clearBeforeSessionLoad() {
  selected = [];
  loaded = [];
  openStint = {};
  corners = [];
  circuitRotation = 0;
  nominatedCompounds = [];
  activeDriverTab = null;
  selectedCornerIndex = 0;
  traceZoom = { start: 0, end: 1 };
  zoomDrag = null;
  hiddenTraceKeys.clear();
  dominanceMapHitPoints = [];
  dominanceMapGeometryCache = null;
  telemetryCache.clear();
  telemetryRequests.clear();
  driverColorOverrides.clear();
  $('#driverPills').innerHTML = '<span class="section-empty">Load a session to see its drivers.</span>';
  $('#stintPanels').innerHTML = '<span class="section-empty">Select a driver to inspect their runs and laps.</span>';
  $('#sectorRows').innerHTML = '';
  const apexSpeeds = $('#apexSpeeds');
  if (apexSpeeds) apexSpeeds.innerHTML = '';
  
  const tireCard = $('#tireCard');
  if (tireCard) tireCard.style.display = 'none';
  updateTelemetryVisibility();
}

// Main Session API Loader
async function loadRealSession() {
  const button = $('#loadSession');
  button.disabled = true;
  button.classList.add('is-loading');
  button.setAttribute('aria-busy', 'true');
  // Keep the progress label compact enough for split-screen and mobile cards.
  // The full action remains available to assistive technology.
  button.textContent = 'Loading…';
  button.setAttribute('aria-label', 'Loading session');
  clearBeforeSessionLoad();
  renderCharts();
  if (sessionRequest) sessionRequest.abort();
  sessionRequest = new AbortController();
  
  try {
    const response = await fetch(apiUrl(`/api/session?${currentQuery()}`), {
      cache: 'no-store',
      signal: sessionRequest.signal,
    });
    const payload = await readApiResponse(response);
    if (!response.ok) throw new Error(payload.detail || 'Session unavailable');
    
    realDrivers = new Map(payload.drivers.map(driver => [driver.code, driver]));
    drivers.splice(0, drivers.length, ...payload.drivers.map(driver => [
      driver.code, driver.number, driver.name, driver.team_color, driver.team, driver.position
    ]));
    corners = payload.corners || [];
    circuitRotation = Number.isFinite(Number(payload.circuit_rotation))
      ? Number(payload.circuit_rotation) : 0;
    nominatedCompounds = payload.compounds || [];
    
    renderDrivers();
    renderTireNomination();
    renderStints();
    renderAll();
  } catch (error) {
    if (error.name !== 'AbortError') notify(`Could not load this session. ${error.message}`);
  } finally {
    button.disabled = false;
    button.classList.remove('is-loading');
    button.removeAttribute('aria-busy');
    button.removeAttribute('aria-label');
    button.textContent = 'Load session';
  }
}

async function fetchTelemetry(lap) {
  const key = telemetryKey(lap);
  if (telemetryCache.has(key)) return telemetryCache.get(key);
  if (telemetryRequests.has(key)) return telemetryRequests.get(key);
  const request = (async () => {
    const query = currentQuery();
    query.set('driver', lap.code);
    query.set('lap', lap.lap);
    query.set('alignment', '3');
    const response = await fetch(apiUrl(`/api/telemetry?${query}`), { cache: 'no-store' });
    if (!response.ok) {
      const payload = await readApiResponse(response);
      throw new Error(payload.detail || 'Telemetry unavailable for this lap');
    }
    const data = await readApiResponse(response);
    const samples = data.samples || [];
    samples.forEach(pt => {
      const d = +pt.DRS;
      pt.DRS = d >= 10 || pt.DRS === true || pt.DRS === 1 || pt.DRS === '1' ? 1 : 0;
      if (pt.Brake === true || pt.Brake === 1 || pt.Brake === '1' || pt.Brake === 'True') pt.Brake = 100;
      else pt.Brake = Number.isFinite(+pt.Brake) && +pt.Brake > 0 ? +pt.Brake : 0;
    });
    telemetryCache.set(key, samples);
    return samples;
  })();
  telemetryRequests.set(key, request);
  try {
    return await request;
  } finally {
    telemetryRequests.delete(key);
  }
}

// UI Rendering Functions
function renderDrivers() {
  const root = $('#driverPills');
  if (!drivers.length) {
    root.innerHTML = '<span class="section-empty">Load a session to see its drivers.</span>';
    return;
  }
  
  root.innerHTML = drivers.map((d, index) => {
    const code = d[0];
    const number = d[1];
    const color = d[3];
    const isSelected = selected.includes(code);
    const position = Number.isFinite(+d[5]) && +d[5] > 0 ? +d[5] : index + 1;

    return `<button class="pill driver-pill ${isSelected ? 'selected' : ''}" style="--team:${color}" data-code="${code}"><span class="driver-pill-position">P${position}</span><span class="driver-pill-identity"><span class="driver-pill-number">#${number}</span><strong>${code}</strong></span></button>`;
  }).join('');
  
  root.querySelectorAll('button').forEach(btn => {
    btn.onclick = () => {
      const code = btn.dataset.code;
      if (selected.includes(code)) {
        selected = selected.filter(x => x !== code);
        loaded = loaded.filter(x => x.code !== code);
        if (activeDriverTab === code) {
          activeDriverTab = selected[0] || null;
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

function renderStintsLegacy() {
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

  const globalCompareHtml = `<button id="compareAllFastest" class="compare-all-btn ${isAllFastestLoaded ? 'selected' : ''}"><i aria-hidden="true">⚡</i><span>COMPARE FASTEST LAPS</span></button>`;
  
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
    const compoundClass = getCompoundToneClass(compound);
    if (hasQualifyingPhases) {
      return `<button class="stint ${id === active ? 'selected' : ''}" style="--team:${display[3]}" data-code="${code}" data-stint="${id}">${id}<small><span class="compound-label ${compoundClass}">${compLabel}</span> - ${group.length} ${group.length === 1 ? 'LAP' : 'LAPS'}</small></button>`;
    }
    return `<button class="stint ${id === active ? 'selected' : ''}" style="--team:${display[3]}" data-code="${code}" data-stint="${id}">Stint ${id}<small><span class="compound-label ${compoundClass}">${compLabel}</span> · ${group.length} L</small></button>`;
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
            const validLaps = d.laps.filter(l => Number.isFinite(l.time) && l.time > 0 && !l.in_lap && !l.out_lap);
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

function fastestTimedLap(driver) {
  const timed = driver?.laps?.filter(lap => Number.isFinite(lap.time) && lap.time > 0 && !lap.in_lap && !lap.out_lap) || [];
  return timed.length ? timed.reduce((fastest, lap) => lap.time < fastest.time ? lap : fastest) : null;
}

function toggleLoadedLap(code, lapNum) {
  const lapObj = realDrivers.get(code)?.laps?.find(item => item.lap === lapNum);
  if (!lapObj || !Number.isFinite(lapObj.time) || lapObj.time <= 0) return;
  const index = loaded.findIndex(item => item.code === code && item.lap === lapNum);
  if (index === -1) {
    loaded.push({ code, lap: lapNum, time: lapObj.time, real: lapObj });
  } else {
    loaded.splice(index, 1);
  }
  renderAll();
  renderStints();
}

function renderStints() {
  const root = $('#stintPanels');
  if (!selected.length) {
    root.innerHTML = '<span class="section-empty">Select a driver to inspect their runs and laps.</span>';
    return;
  }

  const isAllFastestLoaded = selected.every(code => {
    const fastest = fastestTimedLap(realDrivers.get(code));
    return fastest && loaded.some(item => item.code === code && item.lap === fastest.lap);
  });

  const toolbar = `
    <div class="run-toolbar">
      <span><b>${selected.length}</b> ${selected.length === 1 ? 'driver' : 'drivers'} selected</span>
      <button id="compareAllFastest" class="compare-all-btn ${isAllFastestLoaded ? 'selected' : ''}" title="Add the fastest timed lap for every selected driver"><i aria-hidden="true">&#9889;</i><span>COMPARE FASTEST</span></button>
    </div>
  `;

  const cards = selected.map(code => {
    const driver = realDrivers.get(code);
    const display = drivers.find(item => item[0] === code);
    if (!driver || !display) return '';
    const teamColor = display[3] || '#777777';
    if (!driver.laps?.length) {
      return `<article class="driver-run-card" style="--team:${teamColor}"><header class="run-card-header"><div class="run-driver"><b>${code}</b><h3>${driver.name}</h3></div></header><p class="section-empty">No laps in this session.</p></article>`;
    }

    const timedLaps = driver.laps.filter(lap => Number.isFinite(lap.time) && lap.time > 0 && !lap.in_lap && !lap.out_lap);
    const fastest = fastestTimedLap(driver);
    const fastestLoaded = fastest && loaded.some(item => item.code === code && item.lap === fastest.lap);
    const hasQualifyingPhases = driver.laps.some(lap => /^Q[1-3]$/.test(lap.phase || ''));
    const groupIds = hasQualifyingPhases
      ? ['Q1', 'Q2', 'Q3'].filter(phase => driver.laps.some(lap => lap.phase === phase))
      : [...new Set(driver.laps.map(lap => String(lap.stint)))];
    const active = String(openStint[code] ?? groupIds[0]);
    const lapsForGroup = id => hasQualifyingPhases
      ? driver.laps.filter(lap => lap.phase === id)
      : driver.laps.filter(lap => String(lap.stint) === id);
    const activeLaps = lapsForGroup(active);
    const runButtons = groupIds.map(id => {
      const laps = lapsForGroup(id);
      const rawCompound = laps[0]?.compound || 'UNKNOWN';
      const compound = getCompoundCode(rawCompound, nominatedCompounds);
      const compoundClass = getCompoundToneClass(rawCompound);
      const runLabel = hasQualifyingPhases ? id : `STINT ${id}`;
      return `<button class="stint run-segment ${id === active ? 'selected' : ''}" style="--team:${teamColor}" data-code="${code}" data-stint="${id}"><strong>${runLabel}</strong><small><span class="compound-label ${compoundClass}">${compound}</span> &middot; ${laps.length} ${laps.length === 1 ? 'LAP' : 'LAPS'}</small></button>`;
    }).join('');
    const lapButtons = activeLaps.map(lap => {
      const isLoaded = loaded.some(item => item.code === code && item.lap === lap.lap);
      const flag = lap.in_lap ? 'IN' : lap.out_lap ? 'OUT' : `L${lap.lap}`;
      const classes = ['lap', 'lap-chip', lap.in_lap || lap.out_lap ? 'in-out' : '', isLoaded ? 'selected' : ''].filter(Boolean).join(' ');
      const displayTime = Number.isFinite(lap.display_time) ? lap.display_time : lap.time;
      const estimated = lap.display_time_estimated === true;
      const duration = Number.isFinite(displayTime) ? `${estimated ? '~' : ''}${time(displayTime)}` : '&mdash;';
      const selectable = Number.isFinite(lap.time) && !lap.in_lap && !lap.out_lap;
      const context = lap.out_lap && Number.isFinite(displayTime)
        ? '<small>PIT → LINE</small>'
        : lap.in_lap ? '<small>IN LAP</small>' : '';
      const title = lap.out_lap && estimated ? 'Estimated from pit exit to the timing line' : '';
      return `<button class="${classes}" style="--team:${teamColor}" data-code="${code}" data-lap="${lap.lap}" ${selectable ? '' : 'disabled'} title="${title}"><span class="lap-token">${flag}</span><span class="lap-clock">${duration}${context}</span></button>`;
    }).join('');
    const groupLabel = hasQualifyingPhases ? active : `STINT ${active}`;

    return `
      <article class="driver-run-card" style="--team:${teamColor}">
        <header class="run-card-header">
          <div class="run-driver"><b>${code}</b><h3>${driver.name}</h3><small>${timedLaps.length} TIMED LAPS</small></div>
          ${fastest ? `<button class="fastest-lap-pick ${fastestLoaded ? 'selected' : ''}" data-code="${code}" data-lap="${fastest.lap}" title="Add or remove this fastest lap"><span>FASTEST</span><strong>${time(fastest.time)}</strong></button>` : ''}
        </header>
        <div class="run-section-label"><span>RUNS</span></div>
        <div class="run-segments">${runButtons}</div>
        <div class="lap-group-header"><span>${groupLabel} LAPS</span><small>${activeLaps.length} AVAILABLE</small></div>
        <div class="lap-grid">${lapButtons}</div>
      </article>
    `;
  }).join('');

  root.innerHTML = toolbar + cards;

  $('#compareAllFastest').onclick = () => {
    const fastestLaps = selected.map(code => ({ code, lap: fastestTimedLap(realDrivers.get(code)) })).filter(item => item.lap);
    if (isAllFastestLoaded) {
      loaded = loaded.filter(item => !fastestLaps.some(target => target.code === item.code && target.lap.lap === item.lap));
    } else {
      fastestLaps.forEach(target => {
        if (!loaded.some(item => item.code === target.code && item.lap === target.lap.lap)) {
          loaded.push({ code: target.code, lap: target.lap.lap, time: target.lap.time, real: target.lap });
        }
      });
    }
    renderAll();
    renderStints();
  };

  root.querySelectorAll('.stint').forEach(button => {
    button.onclick = () => {
      openStint[button.dataset.code] = button.dataset.stint;
      renderStints();
    };
  });
  root.querySelectorAll('.lap:not(:disabled), .fastest-lap-pick').forEach(button => {
    button.onclick = () => toggleLoadedLap(button.dataset.code, +button.dataset.lap);
  });
}

function renderLoaded() {
  const root = $('#loadedLaps');
  if (!loaded.length) {
    root.innerHTML = '<span class="section-empty">No laps loaded. Click laps in the panel to compare.</span>';
    return;
  }
  
  root.innerHTML = loaded.map((item, index) => `
    <button class="pill loaded-lap-pill ${index === 0 ? 'reference' : ''}" style="--team:${getDriverColor(item.code)}" data-index="${index}">
      <b>${item.code}</b><span>L${item.lap}</span><strong>${time(item.time)}</strong><i class="remove" data-remove="${index}" aria-label="Remove ${item.code} lap ${item.lap}">×</i>
    </button>`).join('');
  
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
  const sectorFields = ['s1', 's2', 's3'];
  const finiteMinimum = values => {
    const finite = values.filter(value => Number.isFinite(value) && value > 0);
    return finite.length ? Math.min(...finite) : null;
  };
  const personalBests = new Map([...realDrivers.entries()].map(([code, driver]) => [
    code,
    sectorFields.map(field => finiteMinimum((driver.laps || []).map(lap => lap[field]))),
  ]));
  const sessionBests = sectorFields.map((field, sectorIndex) => finiteMinimum(
    [...personalBests.values()].map(best => best[sectorIndex])
  ));
  const sectorState = (code, sectorIndex, value) => {
    if (!Number.isFinite(value)) return { className: 'is-unset', label: 'No sector time' };
    const tolerance = .0005;
    if (Number.isFinite(sessionBests[sectorIndex]) && Math.abs(value - sessionBests[sectorIndex]) <= tolerance) {
      return { className: 'is-session-best', label: 'Session best' };
    }
    const personal = personalBests.get(code)?.[sectorIndex];
    if (Number.isFinite(personal) && Math.abs(value - personal) <= tolerance) {
      return { className: 'is-personal-best', label: 'Personal best' };
    }
    return { className: 'is-complete', label: 'Completed sector' };
  };
  
  const deltaBadge = (value, reference) => {
    if (!Number.isFinite(value) || !Number.isFinite(reference)) return '';
    const delta = value - reference;
    const className = delta >= 0 ? 'is-slower' : 'is-faster';
    return `<em class="summary-delta ${className}">${delta >= 0 ? '+' : '−'}${Math.abs(delta).toFixed(3)}s</em>`;
  };

  const windCardinal = degrees => {
    if (!Number.isFinite(degrees)) return '';
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    return directions[Math.round(((degrees % 360) + 360) % 360 / 45) % directions.length];
  };
  const conditionCell = (icon, label, value) => `
    <span class="summary-condition"><i aria-hidden="true">${icon}</i><span><small>${label}</small><strong>${value}</strong></span></span>`;
  
  const root = $('#sectorRows');
  root.innerHTML = loaded.map((item, i) => {
    const lap = item.real || {};
    const refLap = ref.real || {};
    const color = getDriverColor(item.code);
    const sectors = sectorFields.map((field, sectorIndex) => ({
      label: `S${sectorIndex + 1}`,
      value: lap[field],
      reference: refLap[field],
      state: sectorState(item.code, sectorIndex, lap[field]),
    }));
    const conditions = lap.conditions || {};
    const direction = windCardinal(conditions.wind_direction);
    const conditionValues = [
      conditionCell('🌤️', 'AIR', Number.isFinite(conditions.air_temperature) ? `${conditions.air_temperature.toFixed(1)}°C` : '—'),
      conditionCell('🌡️', 'TRACK', Number.isFinite(conditions.track_temperature) ? `${conditions.track_temperature.toFixed(1)}°C` : '—'),
      conditionCell('🚩', 'WIND', Number.isFinite(conditions.wind_speed) ? `${conditions.wind_speed.toFixed(1)} m/s${direction ? ` ${direction}` : ''}` : '—'),
      conditionCell('🌧️', 'RAIN', conditions.rainfall === null || conditions.rainfall === undefined ? '—' : (conditions.rainfall ? 'YES' : 'NO')),
    ];
    const conditionsHtml = `<div class="summary-conditions">${conditionValues.join('')}</div>`;
    const compound = getCompoundCode(lap.compound || 'UNKNOWN', nominatedCompounds);
    const compoundClass = getCompoundToneClass(lap.compound || 'UNKNOWN');
    const tyreLife = Number.isFinite(lap.tyre_life) ? `${Math.max(1, Math.round(lap.tyre_life))}L` : '';
    return `
      <article class="lap-summary-card has-conditions" style="--team:${color}">
        <header>
          <span class="summary-driver"><b>${item.code}</b><small>L${item.lap}</small>${i === 0 ? '<em>REF</em>' : ''}</span>
          <span class="summary-header-actions">
            <input class="trace-color-picker" type="color" value="${color}" style="--trace-color:${color}" data-driver-color="${item.code}" aria-label="Trace color for ${item.code}" title="Change ${item.code} trace color">
            <span class="summary-tyre ${compoundClass}"><b>${compound}</b>${tyreLife ? `<small>${tyreLife}</small>` : ''}</span>
            <span class="summary-lap-time"><small>LAP</small><strong>${Number.isFinite(item.time) ? time(item.time) : '—'}</strong>${i === 0 ? '' : deltaBadge(item.time, ref.time)}</span>
          </span>
        </header>
        <div class="summary-sectors">${sectors.map(({ label, value, reference, state }) => `
          <span class="sector-cell ${state.className}" title="${label} · ${state.label}">
            <span class="sector-cell-value"><small>${label}</small><strong>${Number.isFinite(value) ? `${value.toFixed(3)}s` : '—'}</strong></span>
            ${i === 0 ? '' : deltaBadge(value, reference)}
          </span>`).join('')}
        </div>
        ${conditionsHtml}
      </article>
    `;
  }).join('');

  root.querySelectorAll('.trace-color-picker').forEach(input => {
    input.addEventListener('change', event => {
      driverColorOverrides.set(event.target.dataset.driverColor, event.target.value);
      renderLoaded();
      renderSectors();
      renderTraceVisibilityControls();
      drawAll();
    });
  });
}

// Chart Constants and Configuration
const defs = [
  ['Speed trace', 'KM/H', false],
  ['Timing delta', 'SECONDS VS REFERENCE', false],
  ['Throttle application', '%', true],
  ['Brake application', 'ON / OFF', true],
  ['Gear', '0–8', false],
  ['DRS', 'OPEN / CLOSED', true]
];

const chartField = {
  'Speed trace': 'Speed',
  'Throttle application': 'Throttle',
  'Brake application': 'Brake',
  'Engine speed': 'RPM',
  'Gear': 'nGear',
  'DRS': 'DRS'
};

function setTraceZoom(start, end) {
  let nextStart = Math.max(0, Math.min(1, start));
  let nextEnd = Math.max(0, Math.min(1, end));
  if (nextEnd < nextStart) [nextStart, nextEnd] = [nextEnd, nextStart];
  if (nextEnd - nextStart < MIN_TRACE_ZOOM) return false;
  traceZoom = { start: nextStart, end: nextEnd };
  hoverFraction = null;
  updateZoomReadout();
  drawAll();
  return true;
}

function updateZoomReadout() {
  const readout = $('#traceZoomReadout');
  const reset = $('[data-zoom="reset"]');
  const zoomOut = $('[data-zoom="out"]');
  const panLeft = $('[data-pan="left"]');
  const panRight = $('[data-pan="right"]');
  const reference = loaded[0] && telemetryCache.get(telemetryKey(loaded[0]));
  const distance = reference?.length ? reference[reference.length - 1].Distance : 0;
  const fullLap = traceZoom.start <= 1e-6 && traceZoom.end >= 1 - 1e-6;
  if (readout) {
    readout.textContent = distance
      ? `${(traceZoom.start * distance / 1000).toFixed(2)}–${(traceZoom.end * distance / 1000).toFixed(2)} KM`
      : 'FULL LAP';
  }
  if (reset) reset.disabled = fullLap;
  if (zoomOut) zoomOut.disabled = fullLap;
  if (panLeft) panLeft.disabled = fullLap || traceZoom.start <= 1e-6;
  if (panRight) panRight.disabled = fullLap || traceZoom.end >= 1 - 1e-6;
}

function zoomTraceBy(factor) {
  const span = traceZoom.end - traceZoom.start;
  const nextSpan = Math.max(MIN_TRACE_ZOOM, Math.min(1, span * factor));
  const centre = (traceZoom.start + traceZoom.end) / 2;
  let start = centre - nextSpan / 2;
  let end = centre + nextSpan / 2;
  if (start < 0) { end -= start; start = 0; }
  if (end > 1) { start -= end - 1; end = 1; }
  setTraceZoom(start, end);
}

function panTrace(direction) {
  const span = traceZoom.end - traceZoom.start;
  const shift = span * .35 * direction;
  let start = traceZoom.start + shift;
  let end = traceZoom.end + shift;
  if (start < 0) { end -= start; start = 0; }
  if (end > 1) { start -= end - 1; end = 1; }
  setTraceZoom(start, end);
}

function bindChartZoom() {
  $('[data-zoom="in"]')?.addEventListener('click', () => zoomTraceBy(.55));
  $('[data-zoom="out"]')?.addEventListener('click', () => zoomTraceBy(1.8));
  $('[data-zoom="reset"]')?.addEventListener('click', () => setTraceZoom(0, 1));
  $('[data-pan="left"]')?.addEventListener('click', () => panTrace(-1));
  $('[data-pan="right"]')?.addEventListener('click', () => panTrace(1));
  const speedCanvas = document.querySelector('[data-chart="Speed trace"]');
  if (speedCanvas) {
    speedCanvas.addEventListener('mousedown', event => {
      if (event.button !== 0 || !loaded.length) return;
      const rect = speedCanvas.getBoundingClientRect();
      const local = Math.max(0, Math.min(1, (event.clientX - rect.left - 43) / (rect.width - 50)));
      const fraction = traceZoom.start + local * (traceZoom.end - traceZoom.start);
      zoomDrag = { anchor: fraction, current: fraction };
      hoverFraction = null;
      event.preventDefault();
      drawRealChart('Speed trace');
    });
    speedCanvas.addEventListener('dblclick', () => setTraceZoom(0, 1));
  }
  updateZoomReadout();
}

function finishZoomDrag() {
  if (!zoomDrag) return;
  const { anchor, current } = zoomDrag;
  zoomDrag = null;
  if (Math.abs(current - anchor) < MIN_TRACE_ZOOM || !setTraceZoom(anchor, current)) {
    drawAll();
  }
}

function renderTraceVisibilityControls() {
  const root = $('#traceDriverToggles');
  if (!root) return;
  const activeKeys = new Set(loaded.map(telemetryKey));
  [...hiddenTraceKeys].forEach(key => {
    if (!activeKeys.has(key)) hiddenTraceKeys.delete(key);
  });
  if (!loaded.length) {
    root.innerHTML = '<span class="trace-filter-empty">Load laps to choose traces</span>';
    return;
  }

  const visibleCount = visibleTraceLaps().length;
  root.innerHTML = loaded.map((lap, index) => {
    const key = telemetryKey(lap);
    const visible = !hiddenTraceKeys.has(key);
    const disableLast = visible && visibleCount === 1;
    return `<label class="trace-driver-chip ${visible ? 'is-visible' : ''}" style="--team:${getDriverColor(lap.code)}" title="${visible ? 'Hide' : 'Show'} ${lap.code} lap ${lap.lap}">
      <input type="checkbox" data-trace-key="${key}" ${visible ? 'checked' : ''} ${disableLast ? 'disabled' : ''}>
      <i aria-hidden="true"></i><b>${lap.code}</b><small>L${lap.lap}${index === 0 ? ' · REF' : ''}</small>
    </label>`;
  }).join('');

  root.querySelectorAll('input[data-trace-key]').forEach(input => {
    input.addEventListener('change', event => {
      const key = event.target.dataset.traceKey;
      if (event.target.checked) hiddenTraceKeys.delete(key);
      else if (visibleTraceLaps().length > 1) hiddenTraceKeys.add(key);
      syncTraceVisibilityControls();
      drawAll();
    });
  });
}

function syncTraceVisibilityControls() {
  const root = $('#traceDriverToggles');
  if (!root) return;
  const visibleCount = visibleTraceLaps().length;
  root.querySelectorAll('input[data-trace-key]').forEach(input => {
    const visible = !hiddenTraceKeys.has(input.dataset.traceKey);
    const chip = input.closest('.trace-driver-chip');
    input.checked = visible;
    input.disabled = visible && visibleCount === 1;
    chip?.classList.toggle('is-visible', visible);
    if (chip) chip.title = `${visible ? 'Hide' : 'Show'} ${chip.querySelector('b')?.textContent || ''} trace`;
  });
}

function bindSpeedChartControls() {
  $('#cornerToggle')?.addEventListener('change', event => {
    showCornerNumbers = event.target.checked;
    const status = $('#cornerStatus');
    if (status) status.textContent = showCornerNumbers
      ? 'Corner labels and adaptive analysis active.'
      : 'Corner labels hidden.';
    if (loaded.length) drawAll();
  });

  $('#interpolationToggle')?.addEventListener('change', event => {
    enhancedTraceMode = event.target.checked;
    const status = $('#traceModeStatus');
    if (status) {
      status.textContent = enhancedTraceMode ? 'INTERPOLATED' : 'ACCURATE';
      status.dataset.mode = enhancedTraceMode ? 'enhanced' : 'accurate';
    }
    if (loaded.length) drawAll();
  });

  $('#tintToggle')?.addEventListener('change', event => {
    traceTintEnabled = event.target.checked;
    if (loaded.length) drawAll();
  });
}

function renderCharts() {
  const root = $('#charts');
  const season = Number($('#year').value);
  const activeDefs = season >= 2026
    ? defs.filter(([name]) => name !== 'DRS')
    : defs;
  root.innerHTML = activeDefs.map(([name, unit, compact]) => {
    return `
    <section class="chart ${compact ? 'compact' : ''} ${name === 'Speed trace' ? 'speed-chart' : ''}">
      <div class="chart-heading"><h2>${name} <small>${unit}</small></h2>${name === 'Speed trace' ? `
        <div class="trace-zoom-cluster" aria-label="Trace zoom controls">
          <span class="trace-zoom-readout">VIEW <b id="traceZoomReadout">FULL LAP</b></span>
          <div class="trace-tools">
            <button data-zoom="out" title="Zoom out" aria-label="Zoom out">−</button>
            <button data-zoom="in" title="Zoom in" aria-label="Zoom in">+</button>
            <span class="trace-tool-separator" aria-hidden="true"></span>
            <button data-pan="left" title="Move zoom window left" aria-label="Move zoom window left">‹</button>
            <button data-pan="right" title="Move zoom window right" aria-label="Move zoom window right">›</button>
            <button class="trace-reset" data-zoom="reset" title="Reset zoom">RESET</button>
          </div>
        </div>` : ''}</div>
      ${name === 'Speed trace' ? `
        <div class="speed-chart-controls">
          <div class="trace-settings" aria-label="Telemetry display settings">
            <div class="alignment-readout"><i></i><span id="alignmentStatus" data-state="idle">Speed trace controls</span></div>
            <label class="trace-setting"><input type="checkbox" id="cornerToggle" ${showCornerNumbers ? 'checked' : ''}><i aria-hidden="true"></i><span>Corner numbers</span></label>
            <label class="trace-setting trace-mode-toggle" title="Enhanced interpolates between adjacent samples. Only repeated values under uninterrupted full throttle or full braking use the nearest distinct anchors. Timing delta follows the same curve while official sector and finish deltas remain exact."><input type="checkbox" id="interpolationToggle" ${enhancedTraceMode ? 'checked' : ''}><i aria-hidden="true"></i><span>Enhanced interpolation</span><small id="traceModeStatus" data-mode="${enhancedTraceMode ? 'enhanced' : 'accurate'}">${enhancedTraceMode ? 'INTERPOLATED' : 'ACCURATE'}</small></label>
            <label class="trace-setting"><input type="checkbox" id="tintToggle" ${traceTintEnabled ? 'checked' : ''}><i aria-hidden="true"></i><span>Trace tint</span></label>
          </div>
          <div class="trace-display-bar">
            <span>VISIBLE TRACES</span>
            <div class="trace-driver-toggles" id="traceDriverToggles"></div>
          </div>
          <span class="visually-hidden" id="cornerStatus" aria-live="polite">Corner labels hidden.</span>
        </div>` : ''}
      <canvas data-chart="${name}" aria-label="${name}${name === 'Speed trace' ? '. Drag horizontally to zoom every telemetry chart.' : ''}"></canvas>
    </section>
  `;
  }).join('');
  bindAllChartHover();
  bindChartZoom();
  bindSpeedChartControls();
  renderTraceVisibilityControls();
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
  if (field === 'nGear' || field === 'DRS' || field === 'Brake') {
    return ratio < .5 ? a[field] : b[field];
  }
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

  const meta = lap.real || lap;
  const lapTime = lap.time ?? meta.time;
  const s1Time = meta.s1;
  const s2Time = meta.s2;
  
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
    const targetTicks = span >= 2 ? 6 : 5;
    const magnitude = 10 ** Math.floor(Math.log10(span / targetTicks));
    const normalized = (span / targetTicks) / magnitude;
    const multiplier = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
    const step = multiplier * magnitude;
    min = rawMin >= 0 ? 0 : Math.floor(rawMin / step) * step;
    max = rawMax <= 0 ? 0 : Math.ceil(rawMax / step) * step;
    if (max - min < step * 2) {
      if (rawMax > 0) max = min + step * 2;
      else min = max - step * 2;
    }
    tickStep = step;
  } else if (name === 'Brake application') {
    min = 0;
    max = 100;
  } else if (name === 'Throttle application') {
    min = 0;
    max = 100;
  } else if (name === 'Gear') {
    min = 0;
    max = 8;
    tickStep = 1;
  } else if (name === 'DRS') {
    min = 0;
    max = 1;
  }
  
  return { min, max, tickStep };
}

function cornerFraction(corner, samples, totalDistance, suppliedMarkers = null) {
  return resolveCornerMarkers(samples, totalDistance, suppliedMarkers)
    .find(marker => marker.key === `${corner.number}:${corner.letter || ''}`)?.fraction ?? null;
}

function cornerLabel(corner) {
  return `T${corner.number}${corner.letter || ''}`;
}

function resolveCornerMarkers(samples, totalDistance, suppliedMarkers = null) {
  if (!samples?.length || !Number.isFinite(totalDistance) || totalDistance <= 0) return [];
  // Telemetry responses carry corner fractions projected against this exact
  // reference lap. Only use the session-level rows as a fallback for older
  // responses, where a client-side X/Y projection remains useful.
  const markerRows = Array.isArray(suppliedMarkers) && suppliedMarkers.length
    ? suppliedMarkers
    : corners;
  const positionSamples = samples.filter(point => point.X != null && point.Y != null && Number.isFinite(+point.X) && Number.isFinite(+point.Y));
  const xs = positionSamples.map(point => +point.X);
  const ys = positionSamples.map(point => +point.Y);
  const diagonal = positionSamples.length > 1
    ? Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
    : 0;

  const resolved = markerRows.map(corner => {
    const suppliedFraction = corner.fraction;
    let fraction = suppliedFraction == null || suppliedFraction === ''
      ? NaN
      : Number(suppliedFraction);
    let source = corner.source || 'distance';
    if (!Number.isFinite(fraction)) {
      const distance = corner.distance == null || corner.distance === ''
        ? NaN
        : Number(corner.distance);
      fraction = Number.isFinite(distance) ? distance / totalDistance : NaN;
    }

    // CircuitInfo's Distance is only present when FastF1 could load a car
    // stream. Otherwise project the official corner X/Y onto this actual lap.
    if (!Number.isFinite(fraction) || fraction <= 0 || fraction > 1.02) {
      const x = Number(corner.x), y = Number(corner.y);
      let nearest = null;
      let nearestDistance = Infinity;
      if (Number.isFinite(x) && Number.isFinite(y)) {
        positionSamples.forEach(point => {
          const distance = Math.hypot(+point.X - x, +point.Y - y);
          if (distance < nearestDistance) {
            nearestDistance = distance;
            nearest = point;
          }
        });
      }
      // Reject mismatched coordinate systems rather than putting labels on
      // arbitrary parts of the graph.
      if (nearest && diagonal > 0 && nearestDistance / diagonal <= 0.12) {
        fraction = (+nearest.Distance || 0) / totalDistance;
        source = 'position';
      } else {
        fraction = NaN;
      }
    }

    return {
      ...corner,
      key: `${corner.number}:${corner.letter || ''}`,
      fraction,
      source,
    };
  }).filter(marker => Number.isFinite(marker.fraction) && marker.fraction > 0 && marker.fraction <= 1);

  // MultiViewer occasionally has duplicate labels. Keep only one marker per
  // turn, sorted into lap order so every chart shares the same geometry.
  return [...new Map(resolved.map(marker => [marker.key, marker])).values()]
    .sort((a, b) => a.fraction - b.fraction);
}

// Draw chart grid axes
function drawGridAxes(ctx, width, height, bounds, unit) {
  const { left, right, top, bottom, min, max, tickStep } = bounds;
  const theme = canvasTheme();
  ctx.font = '11px monospace';
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
    if (unit.includes('SECONDS') && Math.abs(value) < 1e-5) {
      ctx.strokeStyle = theme.gridStrong;
      ctx.lineWidth = 1.2;
    } else {
      ctx.strokeStyle = theme.grid;
      ctx.lineWidth = 1;
    }
    ctx.stroke();
    let displayVal = Math.round(value);
    if (unit.includes('SECONDS')) {
      const decimals = Number.isFinite(tickStep) && tickStep > 0
        ? Math.max(1, Math.min(3, Math.ceil(-Math.log10(tickStep)) + 1))
        : (Math.abs(max - min) <= 0.4 ? 2 : 1);
      displayVal = Math.abs(value) < 1e-8
        ? '0'
        : `${value > 0 ? '+' : ''}${value.toFixed(decimals)}`;
    }
    if (unit === 'OPEN / CLOSED' || unit === 'ON / OFF') {
      if (tick === 0) displayVal = 'OPEN';
      else if (tick === 4) displayVal = 'CLOSED';
      else return;
      if (unit === 'ON / OFF') displayVal = tick === 0 ? 'ON' : 'OFF';
    }
    ctx.fillStyle = unit.includes('SECONDS') && Math.abs(value) < 1e-5
      ? theme.textStrong
      : theme.text;
    ctx.textAlign = 'right';
    ctx.fillText(displayVal, left - 8, y + 3);
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

function layoutSpeedCornerCallouts(markers, width, left = 43, right = 7, viewStart = 0, viewEnd = 1) {
  const calloutWidth = 26;
  const gap = 3;
  const plotWidth = width - left - right;
  const laneEnds = [];
  // Source corner rows are normally delivered in lap order, but sorting here
  // guarantees lane allocation still works if a provider returns them shuffled.
  const items = [...markers]
    .filter(corner => Number.isFinite(corner.fraction) && corner.fraction >= viewStart && corner.fraction <= viewEnd)
    .sort((a, b) => a.fraction - b.fraction)
    .map(corner => {
      const x = left + ((corner.fraction - viewStart) / (viewEnd - viewStart || 1)) * plotWidth;
      let lane = laneEnds.findIndex(end => x - calloutWidth / 2 >= end + gap);
      if (lane < 0) {
        lane = laneEnds.length;
        laneEnds.push(-Infinity);
      }
      laneEnds[lane] = x + calloutWidth / 2;
      return { corner, x, lane, width: calloutWidth };
    });
  return { items, lanes: laneEnds.length };
}

function traceSampleFraction(series, point) {
  return Number.isFinite(point?.AlignedFraction)
    ? point.AlignedFraction
    : (+point?.Distance || 0) / (+series?.[series.length - 1]?.Distance || 1);
}

function appendTracePoint(points, x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  const last = points[points.length - 1];
  if (last && Math.abs(last.x - x) < 1e-8) {
    last.y = y;
    return;
  }
  points.push({ x, y });
}

function measuredContinuousTrace(series, field, viewStart, viewEnd) {
  const points = [];
  appendTracePoint(points, viewStart, alignedValue(series, viewStart, field));
  series.forEach(point => {
    if (point[field] === null || point[field] === undefined || !Number.isFinite(+point[field])) return;
    const fraction = traceSampleFraction(series, point);
    if (fraction > viewStart && fraction < viewEnd) appendTracePoint(points, fraction, +point[field]);
  });
  appendTracePoint(points, viewEnd, alignedValue(series, viewEnd, field));
  return points;
}

function discreteTraceState(field, value) {
  if (!Number.isFinite(+value)) return null;
  if (field === 'Brake') return +value >= 50 ? 100 : 0;
  if (field === 'DRS') return +value >= .5 ? 1 : 0;
  if (field === 'nGear') return Math.round(+value);
  return +value;
}

// alignedValue switches discrete channels at the midpoint between published
// packets. Build the visible step path at those exact same midpoints so the
// line, hover ball and tooltip cannot disagree.
function measuredDiscreteTrace(series, field, viewStart, viewEnd) {
  const samples = series
    .filter(point => point[field] !== null && point[field] !== undefined && Number.isFinite(+point[field]))
    .map(point => ({ x: traceSampleFraction(series, point), y: discreteTraceState(field, point[field]) }))
    .sort((a, b) => a.x - b.x);
  if (!samples.length) return [];
  const points = [];
  appendTracePoint(points, viewStart, discreteTraceState(field, alignedValue(series, viewStart, field)));
  for (let index = 1; index < samples.length; index++) {
    const before = samples[index - 1];
    const after = samples[index];
    if (before.y === after.y || !(after.x > before.x)) continue;
    const transition = (before.x + after.x) / 2;
    if (transition > viewStart && transition < viewEnd) appendTracePoint(points, transition, after.y);
  }
  appendTracePoint(points, viewEnd, discreteTraceState(field, alignedValue(series, viewEnd, field)));
  return points;
}

function sampledEnhancedTrace(series, field, viewStart, viewEnd, steps) {
  // Build the model once, then include every model knot as well as the display
  // grid. This guarantees measured extrema/gear landmarks are drawn even when
  // they fall between two uniform canvas samples.
  traceTelemetryValue(series, viewStart, field);
  const model = field === 'Speed' ? series.speedModel : series.throttleModel;
  const candidates = [];
  for (let step = 0; step <= steps; step++) {
    const fraction = viewStart + (viewEnd - viewStart) * step / steps;
    candidates.push({ x: fraction, y: traceTelemetryValue(series, fraction, field) });
  }
  model?.points?.forEach(point => {
    if (point.x > viewStart && point.x < viewEnd) candidates.push({ x: point.x, y: point.y });
  });
  candidates.sort((a, b) => a.x - b.x);
  const points = [];
  candidates.forEach(point => appendTracePoint(points, point.x, point.y));
  return points;
}

function renderedTraceValue(points, fraction, stepped = false) {
  if (!points?.length) return null;
  if (fraction <= points[0].x) return points[0].y;
  if (fraction >= points[points.length - 1].x) return points[points.length - 1].y;
  let low = 1;
  let high = points.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (points[middle].x < fraction) low = middle + 1;
    else high = middle;
  }
  const after = points[low];
  const before = points[low - 1];
  if (stepped) return Math.abs(after.x - fraction) < 1e-9 ? after.y : before.y;
  const ratio = (fraction - before.x) / (after.x - before.x || 1);
  return before.y + (after.y - before.y) * ratio;
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
  const theme = canvasTheme();
  
  const unit = defs.find(def => def[0] === name)?.[1] || '';
  const field = chartField[name];
  const visibleEntries = visibleTraceLaps();
  const data = visibleEntries.map(({ lap }) => telemetryCache.get(telemetryKey(lap))).filter(Boolean);
  const viewStart = traceZoom.start;
  const viewEnd = traceZoom.end;
  const viewSpan = viewEnd - viewStart || 1;
  
  if (!loaded.length) {
    ctx.fillStyle = theme.text;
    ctx.font = '11px monospace';
    ctx.fillText('Select a driver to begin comparison.', 43, 25);
    return;
  }
  
  if (!data.length) {
    ctx.fillStyle = theme.text;
    ctx.font = '11px monospace';
    ctx.fillText('Loading telemetry data…', 43, 25);
    return;
  }

  if (name === 'DRS' && Number($('#year').value) >= 2026
    && !data.some(series => series.modeAvailable)) {
    ctx.fillStyle = theme.textStrong;
    ctx.font = '11px monospace';
    ctx.fillText('Straight-line mode is not published for this lap.', 43, 25);
    return;
  }
  
  let values = [];
  if (name === 'Timing delta') {
    const refSamples = telemetryCache.get(telemetryKey(loaded[0]));
    if (refSamples && refSamples.length) {
      const refDistance = refSamples[refSamples.length - 1].Distance || 5891;
      visibleEntries.filter(({ index }) => index !== 0).forEach(({ lap }) => {
        const samples = telemetryCache.get(telemetryKey(lap));
        if (!samples?.length) return;
        // Sample every delta-model interval when setting the axis. The old
        // 100-point scan could miss a narrow minimum that the 180-point path
        // still drew, letting the trace escape below the chart boundary.
        const resolution = Math.max(360, samples.deltaModel?.resolution || 0);
        for (let i = 0; i <= resolution; i++) {
          const fraction = viewStart + viewSpan * i / resolution;
          const v = typeof displayDeltaAt === 'function'
            ? displayDeltaAt(samples, refSamples, fraction)
            : deltaAt(samples, refSamples, refDistance * fraction);
          if (Number.isFinite(v)) values.push(v);
        }
      });
    }
    values.push(0);
  } else {
    data.forEach(series => series.forEach(pt => {
      const fraction = Number.isFinite(pt.AlignedFraction)
        ? pt.AlignedFraction
        : (+pt.Distance || 0) / (+series[series.length - 1].Distance || 1);
      if (fraction >= viewStart && fraction <= viewEnd && Number.isFinite(pt[field])) values.push(pt[field]);
    }));
  }
  
  values = values.filter(Number.isFinite);
  if (!values.length) return;
  
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  
  const niceBounds = getNiceBounds(name, rawMin, rawMax);
  const min = niceBounds.min;
  const max = niceBounds.max;
  const refLap = loaded[0];
  const refSamples = telemetryCache.get(telemetryKey(refLap));
  const totalDist = refSamples && refSamples.length ? refSamples[refSamples.length - 1].Distance : 5891;
  const axisLeft = name === 'Timing delta' ? 58 : 50;
  const speedCornerMarkers = name === 'Speed trace' && $('#cornerToggle').checked
    ? resolveCornerMarkers(refSamples, totalDist, refLap?.cornerMarkers)
    : [];
  const cornerCalloutLayout = layoutSpeedCornerCallouts(speedCornerMarkers, rect.width, axisLeft, 7, viewStart, viewEnd);
  const cornerTopInset = speedCornerMarkers.length
    ? 10 + cornerCalloutLayout.lanes * 16
    : 8;
  const bounds = {
    left: axisLeft,
    right: 7,
    top: name === 'Speed trace' ? cornerTopInset : 8,
    bottom: 15,
    min,
    max,
    tickStep: niceBounds.tickStep
  };
  canvas.setAttribute('data-axis-min', String(bounds.min));
  canvas.setAttribute('data-axis-max', String(bounds.max));
  canvas.setAttribute('data-value-min', String(rawMin));
  canvas.setAttribute('data-value-max', String(rawMax));
  const plotWidth = rect.width - bounds.left - bounds.right;
  const xForFraction = fraction => bounds.left + ((fraction - viewStart) / viewSpan) * plotWidth;
  const fractionInView = fraction => fraction >= viewStart && fraction <= viewEnd;
  
  // Render grid axes
  drawGridAxes(ctx, rect.width, rect.height, bounds, unit);

  // Shared distance axis. Every telemetry chart uses the same visible range.
  for (let tick = 0; tick <= 6; tick++) {
    const fraction = viewStart + viewSpan * tick / 6;
    const x = xForFraction(fraction);
    ctx.beginPath();
    ctx.moveTo(x, bounds.top);
    ctx.lineTo(x, rect.height - bounds.bottom);
    ctx.strokeStyle = theme.grid;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = theme.text;
    ctx.font = '9px monospace';
    ctx.textAlign = tick === 0 ? 'left' : tick === 6 ? 'right' : 'center';
    ctx.fillText(`${Math.round(fraction * totalDist)} M`, x, rect.height - 3);
  }
  ctx.textAlign = 'left';
  
  if (name === 'Speed trace' && $('#cornerToggle').checked) {
    const count = speedCornerMarkers.length;
    const projection = refLap?.cornerMarkers?.[0]?.source === 'lap_projection';
    $('#cornerStatus').textContent = count
      ? `${count} official corner markers aligned to this lap${projection ? ' (lap projection).' : '.'}`
      : 'Corner coordinates are unavailable for this telemetry source.';
  }
  
  // Draw vertical sector lines in background
  const fallbackSectorDistances = getSectorDistances(refLap);
  const sectorBoundaries = typeof alignedSectorFractions === 'function'
    ? alignedSectorFractions(refSamples, refLap)
    : typeof sectorFractions === 'function'
      ? sectorFractions(refSamples, refLap)
    : [fallbackSectorDistances.s1 / totalDist, fallbackSectorDistances.s2 / totalDist].filter(Number.isFinite);
  sectorBoundaries.forEach(fraction => {
    if (!fractionInView(fraction)) return;
    const x = xForFraction(fraction);
    ctx.strokeStyle = theme.gridStrong;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, bounds.top);
    ctx.lineTo(x, rect.height - bounds.bottom);
    ctx.stroke();
  });

  if (name === 'Speed trace' && sectorBoundaries.length === 2) {
    const ranges = [[0, sectorBoundaries[0], 'SECTOR 1'], [sectorBoundaries[0], sectorBoundaries[1], 'SECTOR 2'], [sectorBoundaries[1], 1, 'SECTOR 3']];
    ctx.fillStyle = theme.text;
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ranges.forEach(([start, end, label]) => {
      const visibleStart = Math.max(viewStart, start);
      const visibleEnd = Math.min(viewEnd, end);
      if (visibleEnd > visibleStart && (visibleEnd - visibleStart) / viewSpan > .08) {
        ctx.fillText(label, xForFraction((visibleStart + visibleEnd) / 2), bounds.top + 12);
      }
    });
    ctx.textAlign = 'left';
  }
  
  // Draw Corner dotted lines
  if ($('#cornerToggle').checked) {
    const markerCorners = resolveCornerMarkers(refSamples, totalDist, refLap?.cornerMarkers);
    markerCorners.forEach(corner => {
      const fraction = corner.fraction;
      if (Number.isFinite(fraction) && fractionInView(fraction)) {
        const x = xForFraction(fraction);
        
        ctx.strokeStyle = theme.gridStrong;
        ctx.lineWidth = 0.8;
        ctx.setLineDash([2, 3]);
        
        ctx.beginPath();
        ctx.moveTo(x, bounds.top);
        ctx.lineTo(x, rect.height - bounds.bottom);
        ctx.stroke();
        ctx.setLineDash([]);
        
      }
    });
  }
  
  // Build every path first so fills and keylines never cover a coloured trace.
  const traceEntries = [];
  visibleEntries.forEach(({ lap, index }) => {
    const series = telemetryCache.get(telemetryKey(lap));
    if (!series) return;
    
    const teamColor = getDriverColor(lap.code);
    const refSeries = telemetryCache.get(telemetryKey(loaded[0]));
    
    // Accurate mode uses every supplied speed/throttle sample. Enhanced mode
    // samples the bounded reconstruction. Discrete channels are built at the
    // exact same midpoint transitions used by alignedValue.
    let domainPoints = [];
    if (name === 'Speed trace' || name === 'Throttle application') {
      domainPoints = enhancedInterpolationEnabled()
        ? sampledEnhancedTrace(series, field, viewStart, viewEnd, name === 'Speed trace' ? 640 : 420)
        : measuredContinuousTrace(series, field, viewStart, viewEnd);
    } else if (name === 'Brake application' || name === 'Gear' || name === 'DRS') {
      domainPoints = measuredDiscreteTrace(series, field, viewStart, viewEnd);
    } else {
      const steps = name === 'Timing delta' ? 360 : 180;
      for (let step = 0; step <= steps; step++) {
        const fraction = viewStart + viewSpan * step / steps;
        const targetDist = totalDist * fraction;
        const value = name === 'Timing delta'
          ? (index === 0 ? 0 : (typeof displayDeltaAt === 'function'
              ? displayDeltaAt(series, refSeries, fraction)
              : deltaAt(series, refSeries, targetDist)))
          : interpolate(series, targetDist, field);
        appendTracePoint(domainPoints, fraction, value);
      }
    }
    const points = domainPoints.map(point => ({
      x: xForFraction(point.x),
      y: bounds.top + (bounds.max - point.y) / (bounds.max - bounds.min || 1)
        * (rect.height - bounds.top - bounds.bottom),
    }));
    if (points.length) traceEntries.push({ points, domainPoints, teamColor, index });
  });

  const tracePath = points => {
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    points.slice(1).forEach((point, pointIndex) => {
      if (name === 'Gear' || name === 'DRS' || name === 'Brake application') {
        ctx.lineTo(point.x, points[pointIndex].y);
      }
      ctx.lineTo(point.x, point.y);
    });
  };

  // Give every visible loaded lap its own restrained tint. Tinting follows the
  // rendered trace entries, so hidden trace toggles also hide their tint and
  // each colour remains identifiable when several laps overlap.
  const shadedFields = ['Speed trace', 'Throttle application', 'Brake application', 'Engine speed'];
  if (traceTintEnabled && traceEntries.length && shadedFields.includes(name)) {
    const bottomY = rect.height - bounds.bottom;
    const baseAlpha = name === 'Speed trace' ? .16 : .11;
    const tintAlpha = Math.min(baseAlpha, baseAlpha / Math.sqrt(Math.max(1, traceEntries.length)) * 1.45);
    traceEntries.forEach(({ points, teamColor }) => {
      if (!points.length) return;
      tracePath(points);
      ctx.lineTo(points[points.length - 1].x, bottomY);
      ctx.lineTo(points[0].x, bottomY);
      ctx.closePath();
      const gradient = ctx.createLinearGradient(0, bounds.top, 0, bottomY);
      gradient.addColorStop(0, hexToRgba(teamColor, tintAlpha));
      gradient.addColorStop(1, hexToRgba(teamColor, 0));
      ctx.fillStyle = gradient;
      ctx.fill();
    });
  }

  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  traceEntries.forEach(({ points, teamColor, index }) => {
    ctx.strokeStyle = teamColor;
    const speedWidthMultiplier = name === 'Speed trace' ? 1.15 : 1;
    ctx.lineWidth = (index === 0 ? 1.44 : 1.12) * speedWidthMultiplier;
    ctx.shadowColor = teamColor;
    ctx.shadowBlur = 0;
    tracePath(points);
    ctx.stroke();
  });
  ctx.shadowBlur = 0;
  
  // Draw collision-free corner labels in a reserved header band. Corner
  // speeds live in the dedicated analysis panel below the track map.
  if (name === 'Speed trace' && $('#cornerToggle').checked) {
    const rowHeight = 16;
    const calloutHeight = 11;
    cornerCalloutLayout.items.forEach(({ corner, x, lane, width }) => {
      if (!Number.isFinite(corner.fraction)) return;
      const labelY = 4 + lane * rowHeight;
      const left = x - width / 2;

      ctx.fillStyle = theme.panel;
      ctx.fillRect(left, labelY, width, calloutHeight);
      ctx.strokeStyle = theme.outline;
      ctx.lineWidth = 1;
      ctx.strokeRect(left + .5, labelY + .5, width - 1, calloutHeight - 1);
      ctx.fillStyle = theme.textStrong;
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(cornerLabel(corner), x, labelY + 8);
      ctx.textAlign = 'left';
    });
  }
  
  // Render hover crosshair and marker circle
  if (hoverFraction !== null && fractionInView(hoverFraction)) {
    const crosshairX = xForFraction(hoverFraction);
    
    // Draw vertical crosshair line
    ctx.strokeStyle = theme.crosshair;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(crosshairX, bounds.top);
    ctx.lineTo(crosshairX, rect.height - bounds.bottom);
    ctx.stroke();
    
    // Draw intersection highlighted circle on each line
    visibleEntries.forEach(({ lap, index }) => {
      const series = telemetryCache.get(telemetryKey(lap));
      if (!series) return;
      const entry = traceEntries.find(item => item.index === index);
      const stepped = name === 'Brake application' || name === 'Gear' || name === 'DRS';
      const val = entry ? renderedTraceValue(entry.domainPoints, hoverFraction, stepped) : null;
      
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

  // Selection band while dragging on the speed trace. Releasing the mouse
  // applies this same distance window to every telemetry chart.
  if (name === 'Speed trace' && zoomDrag) {
    const start = Math.max(viewStart, Math.min(zoomDrag.anchor, zoomDrag.current));
    const end = Math.min(viewEnd, Math.max(zoomDrag.anchor, zoomDrag.current));
    const x = xForFraction(start);
    const width = Math.max(1, xForFraction(end) - x);
    ctx.fillStyle = 'rgba(89, 158, 220, .24)';
    ctx.fillRect(x, bounds.top, width, rect.height - bounds.top - bounds.bottom);
    ctx.strokeStyle = 'rgba(126, 193, 255, .88)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + .5, bounds.top + .5, Math.max(0, width - 1), rect.height - bounds.top - bounds.bottom - 1);
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
      const localFraction = Math.max(0, Math.min(1, (e.clientX - rect.left - 43) / printableWidth));
      const fraction = traceZoom.start + localFraction * (traceZoom.end - traceZoom.start);

      if (zoomDrag && canvas.dataset.chart === 'Speed trace') {
        zoomDrag.current = fraction;
        tooltip.style.display = 'none';
        drawRealChart('Speed trace');
        return;
      }
      
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
      
      let hasReconstructedValue = false;
      const lines = visibleTraceLaps().map(({ lap, index }) => {
        const series = telemetryCache.get(telemetryKey(lap));
        let val = null;
        const targetDist = fraction * maxDistance;
        if (hoveredChartName === 'Timing delta') {
          val = index === 0 ? 0 : (typeof displayDeltaAt === 'function'
            ? displayDeltaAt(series, refSamples, fraction)
            : deltaAt(series, refSamples, targetDist));
        } else if ((hoveredChartName === 'Speed trace' || hoveredChartName === 'Throttle application')
            && typeof smoothedTelemetryValue === 'function') {
          val = typeof traceTelemetryValue === 'function'
            ? traceTelemetryValue(series, fraction, field)
            : smoothedTelemetryValue(series, fraction, field);
        } else {
          val = interpolate(series, targetDist, field);
        }
        
        let display = '—';
        if (Number.isFinite(val)) {
          if (hoveredChartName === 'Timing delta') {
            display = `${val >= 0 ? '+' : ''}${val.toFixed(3)}s`;
          } else if (field === 'DRS') {
            display = val >= 0.5 ? 'OPEN' : 'CLOSED';
          } else if (hoveredChartName === 'Brake application') {
            display = val >= 50 ? 'ON' : 'OFF';
          } else {
            const reconstructed = typeof isReconstructedTelemetry === 'function'
              && isReconstructedTelemetry(series, fraction, field);
            if (reconstructed) hasReconstructedValue = true;
            const precision = (hoveredChartName === 'Speed trace'
              || hoveredChartName === 'Throttle application')
              ? val.toFixed(1)
              : Math.round(val);
            display = `${reconstructed ? '~' : ''}${precision} ${unit}`;
          }
        }
        return `<span style="color: ${getDriverColor(lap.code)}">●</span> ${lap.code} L${lap.lap} · <b>${display}</b>`;
      });
      
      const reconstructionNote = hasReconstructedValue
        ? '<br><small>~ RECONSTRUCTED ACROSS SOURCE GAP</small>'
        : '';
      tooltip.innerHTML = `<b>${distanceKM.toFixed(3)} KM</b><br>${lines.join('<br>')}${reconstructionNote}`;
      tooltip.style.display = 'block';
      
      const parentRect = telemetryCard.getBoundingClientRect();
      const xPos = e.clientX - parentRect.left + 15;
      const yPos = e.clientY - parentRect.top + 15;
      tooltip.style.left = `${xPos}px`;
      tooltip.style.top = `${yPos}px`;
    });
    
    canvas.addEventListener('mouseleave', () => {
      if (zoomDrag && canvas.dataset.chart === 'Speed trace') return;
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
    const hoverEntries = visibleTraceLaps();
    if (!hoverEntries.length || !dominanceMapHitPoints.length) return;
    const spatial = typeof spatialReferenceTelemetry === 'function'
      ? spatialReferenceTelemetry()
      : null;
    const reference = spatial?.samples || telemetryCache.get(telemetryKey(loaded[0]));
    if (!reference?.length) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    let minDistanceSq = Infinity;
    let bestFraction = null;
    const totalDistance = referenceDistance();

    dominanceMapHitPoints.forEach(point => {
      const dSq = (point.x - mouseX) ** 2 + (point.y - mouseY) ** 2;
      if (dSq < minDistanceSq) {
        minDistanceSq = dSq;
        bestFraction = point.fraction;
      }
    });

    if (bestFraction !== null && minDistanceSq < 4000) {
      hoverFraction = bestFraction;
      hoveredChartName = 'Track map';

      defs.forEach(def => drawRealChart(def[0]));
      renderMiniSectorMap();

      if (tooltip && telemetryCard) {
        const distanceKM = (bestFraction * totalDistance) / 1000;
        const segments = Math.ceil(totalDistance / 25);
        const segmentIndex = Math.min(segments - 1, Math.floor(bestFraction * segments));
        const segmentStart = segmentIndex / segments;
        const segmentEnd = (segmentIndex + 1) / segments;
        const segmentRows = hoverEntries.map(({ lap }) => {
          const series = telemetryCache.get(telemetryKey(lap));
          const speed = typeof smoothedTelemetryValue === 'function'
            ? (typeof traceTelemetryValue === 'function'
                ? traceTelemetryValue(series, bestFraction, 'Speed')
                : smoothedTelemetryValue(series, bestFraction, 'Speed'))
            : interpolate(series, bestFraction * totalDistance, 'Speed');
          const sectionTime = typeof performanceSectionDuration === 'function'
            ? performanceSectionDuration(series, segmentStart, segmentEnd)
            : null;
          return { lap, speed, sectionTime };
        });
        const finiteSegmentTimes = segmentRows.map(row => row.sectionTime).filter(Number.isFinite);
        const bestTime = finiteSegmentTimes.length ? Math.min(...finiteSegmentTimes) : null;
        const lines = segmentRows.map(({ lap, speed, sectionTime }) => {
          const speedDisplay = Number.isFinite(speed) ? `${speed.toFixed(1)} KM/H` : '—';
          const timeDisplay = Number.isFinite(sectionTime) && Number.isFinite(bestTime)
            ? `${sectionTime.toFixed(3)}s${Math.abs(sectionTime - bestTime) < .0005 ? ' FASTEST' : ` +${(sectionTime - bestTime).toFixed(3)}s`}`
            : 'NO SECTION TIME';
          return `<span style="color: ${getDriverColor(lap.code)}">●</span> ${lap.code} L${lap.lap} · <b>${speedDisplay}</b> · ${timeDisplay}`;
        });

        tooltip.innerHTML = `<b>TRACK MAP · ${distanceKM.toFixed(3)} KM · 25 M SECTION</b><br>${lines.join('<br>')}`;
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
  const generation = ++drawGeneration;
  const requestedLaps = [...loaded];
  const failures = [];
  const promises = requestedLaps.map(async lap => {
    try {
      await fetchTelemetry(lap);
    } catch (err) {
      console.warn(err);
      failures.push({ lap, error: err });
    }
  });
  await Promise.all(promises);
  if (generation !== drawGeneration) return;
  if (failures.length) {
    loaded = loaded.filter(item => !failures.some(({ lap }) => item.code === lap.code && item.lap === lap.lap));
    const failed = failures.map(({ lap }) => `${lap.code} L${lap.lap}`).join(', ');
    notify(`Telemetry is unavailable for ${failed}.`);
    renderLoaded();
    renderSectors();
    renderTraceVisibilityControls();
    renderStints();
  }
  if (typeof prepareTelemetryAlignment === 'function') {
    prepareTelemetryAlignment();
  }
  const season = Number($('#year').value);
  const activeDefs = season >= 2026
    ? defs.filter(([name]) => name !== 'DRS')
    : defs;
  activeDefs.forEach(definition => drawRealChart(definition[0]));
  renderMiniSectorMap();
  renderCornerAnalysis();
}

function updateTelemetryVisibility() {
  const card = $('#telemetryCard');
  if (!card) return;
  const empty = loaded.length === 0;
  card.classList.toggle('is-empty', empty);
  const emptyState = $('#telemetryEmpty');
  if (emptyState) emptyState.hidden = !empty;
}

function renderAll() {
  updateTelemetryVisibility();
  renderLoaded();
  renderSectors();
  renderTraceVisibilityControls();
  drawAll();
}

function renderCornerAnalysis() {
  const section = $('#cornerAnalysis');
  const root = $('#cornerMetricGrid');
  if (!section || !root) return;
  const enabled = loaded.length > 0;
  section.hidden = !enabled;
  if (!enabled) {
    root.innerHTML = '';
    return;
  }

  const referenceLap = loaded[0];
  const reference = telemetryCache.get(telemetryKey(referenceLap));
  if (!reference?.length || typeof adaptiveCornerZones !== 'function' || typeof cornerPerformance !== 'function') {
    root.innerHTML = '<span class="section-empty">Corner analysis is waiting for aligned position data.</span>';
    return;
  }
  const totalDistance = reference[reference.length - 1].Distance || 1;
  const markers = resolveCornerMarkers(reference, totalDistance, referenceLap?.cornerMarkers);
  const zones = adaptiveCornerZones(markers);
  if (!zones.length) {
    root.innerHTML = '<span class="section-empty">Official corner positions are unavailable for this lap.</span>';
    return;
  }

  selectedCornerIndex = Math.max(0, Math.min(selectedCornerIndex, zones.length - 1));
  const allMetrics = zones.map(zone => loaded.map(lap => {
    const samples = telemetryCache.get(telemetryKey(lap));
    const metric = cornerPerformance(samples, zone);
    return metric ? { lap, metric } : null;
  }).filter(Boolean));
  const zone = zones[selectedCornerIndex];
  const metrics = allMetrics[selectedCornerIndex];
  if (!metrics.length) {
    root.innerHTML = '<span class="section-empty">This corner has insufficient speed data.</span>';
    return;
  }
  const finiteTimes = metrics.map(item => item.metric.sectionTime).filter(Number.isFinite);
  const fastestSection = finiteTimes.length ? Math.min(...finiteTimes) : null;
  const finiteMinimumSpeeds = metrics.map(item => item.metric.minimumSpeed).filter(Number.isFinite);
  const highestMinimumSpeed = finiteMinimumSpeeds.length ? Math.max(...finiteMinimumSpeeds) : null;
  const referenceSection = metrics[0]?.metric.sectionTime;
  const signedDelta = value => `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(3)}s`;
  const picker = zones.map((candidate, index) => {
    const candidateMetrics = allMetrics[index];
    const winner = candidateMetrics.reduce((best, item) => !Number.isFinite(item.metric.sectionTime)
      ? best : !best || item.metric.sectionTime < best.metric.sectionTime ? item : best, null);
    return `<button class="corner-pick ${index === selectedCornerIndex ? 'selected' : ''}" data-corner-index="${index}" title="Inspect ${cornerLabel(candidate)}"><strong>${cornerLabel(candidate)}</strong><small>${winner?.lap.code || '—'}</small></button>`;
  }).join('');
  const rows = metrics.map((item, index) => {
    const sectionTime = item.metric.sectionTime;
    const toReference = Number.isFinite(sectionTime) && Number.isFinite(referenceSection)
      ? sectionTime - referenceSection : null;
    const deltaClass = !Number.isFinite(toReference) || Math.abs(toReference) < .0005
      ? 'is-reference' : toReference < 0 ? 'is-faster' : 'is-slower';
    const fastest = Number.isFinite(sectionTime) && Number.isFinite(fastestSection)
      && Math.abs(sectionTime - fastestSection) < .0005;
    const highestMinimum = Number.isFinite(item.metric.minimumSpeed) && Number.isFinite(highestMinimumSpeed)
      && Math.abs(item.metric.minimumSpeed - highestMinimumSpeed) < .05;
    return `
      <div class="corner-driver-row ${fastest && loaded.length > 1 ? 'is-fastest' : ''} ${highestMinimum && loaded.length > 1 ? 'is-highest-min' : ''}" style="--driver-color:${getDriverColor(item.lap.code)}">
        <span class="corner-driver"><i></i><b>${item.lap.code}</b><small>L${item.lap.lap}</small>${index === 0 ? '<em>REF</em>' : ''}</span>
        <span class="corner-time"><strong>${Number.isFinite(sectionTime) ? `${sectionTime.toFixed(3)}s` : '—'}</strong><small>SECTION</small></span>
        <span class="corner-delta ${deltaClass}"><strong>${Number.isFinite(toReference) ? signedDelta(toReference) : '—'}</strong><small>VS REF</small></span>
        <span class="corner-speed"><strong>${Number.isFinite(item.metric.minimumSpeed) ? item.metric.minimumSpeed.toFixed(1) : '—'}</strong><small>KM/H MIN</small></span>
      </div>`;
  }).join('');

  root.innerHTML = `
    <nav class="corner-picker" aria-label="Select a corner">${picker}</nav>
    <article class="corner-detail-card">
      <header class="corner-detail-header">
        <div><span>SELECTED CORNER</span><strong>${cornerLabel(zone)}</strong><small>${zone.type}</small></div>
        <dl><div><dt>Timing sector</dt><dd>${zone.metres} m</dd></div><div><dt>Min-speed window</dt><dd>${zone.apexMetres} m</dd></div></dl>
      </header>
      <div class="corner-table-head"><span>Driver</span><span>Time</span><span>Delta</span><span>Minimum</span></div>
      <div class="corner-driver-metrics">${rows}</div>
    </article>`;
  root.onclick = event => {
    const button = event.target.closest('[data-corner-index]');
    if (!button) return;
    selectedCornerIndex = Number(button.dataset.cornerIndex) || 0;
    renderCornerAnalysis();
    renderMiniSectorMap();
  };
}

function renderApexSpeeds() {
  const root = $('#apexSpeeds');
  if (!root) return;
  
  if (!loaded.length || !$('#cornerToggle').checked) {
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
  
  const markerCorners = resolveCornerMarkers(refSamples, totalDist, refLap?.cornerMarkers);
  root.innerHTML = markerCorners.map(corner => {
    const driverSpeeds = loaded.map(lap => {
      const samples = telemetryCache.get(telemetryKey(lap));
      if (!samples || !samples.length) return null;
      
      const apexPt = getCornerMinSpeed(samples, corner);
      if (!apexPt || !Number.isFinite(apexPt.cornerSpeed)) return null;
      
      return {
        code: lap.code,
        color: getDriverColor(lap.code),
        speed: apexPt.cornerSpeed.toFixed(1)
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
        <strong>${cornerLabel(corner)}</strong>
        ${valsHtml}
      </div>
    `;
  }).join('');
}

function clearDominanceMapCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const dpr = Math.min(4, Math.max(2, window.devicePixelRatio || 1));
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);
}

function renderMiniSectorMap() {
  const canvas = $('#dominanceCanvas');
  const empty = $('#dominanceEmpty');
  const legend = $('#dominanceLegend');
  const title = $('#dominanceTitle');
  if (!canvas || !empty || !legend || !title) return;

  const mapEntries = visibleTraceLaps();
  const comparative = mapEntries.length >= 2;
  canvas.setAttribute('aria-label', comparative
    ? 'Track map showing the fastest loaded lap in each mini-sector'
    : 'Circuit map for the visible telemetry trace');
  title.innerHTML = !mapEntries.length
    ? 'Track map'
    : comparative
      ? 'Mini-sector dominance <small>25 M SEGMENTS</small>'
      : 'Track map <small>SINGLE TRACE</small>';
  if (!mapEntries.length) {
    clearDominanceMapCanvas(canvas);
    canvas.style.display = 'block';
    empty.style.display = 'grid';
    empty.textContent = 'Load a lap to generate the track map.';
    legend.innerHTML = '';
    dominanceMapHitPoints = [];
    return;
  }

  const spatial = typeof spatialReferenceTelemetry === 'function'
    ? spatialReferenceTelemetry()
    : null;
  const reference = spatial?.samples || telemetryCache.get(telemetryKey(loaded[0]));
  const allSeries = mapEntries.map(({ lap }) => telemetryCache.get(telemetryKey(lap)));
  const trackSamples = reference?.filter(point => point.X != null && point.Y != null && Number.isFinite(+point.X) && Number.isFinite(+point.Y)) || [];
  if (!reference?.length || !allSeries.every(series => series?.length) || trackSamples.length < 2) {
    clearDominanceMapCanvas(canvas);
    canvas.style.display = 'block';
    empty.style.display = 'grid';
    empty.textContent = 'Track-position telemetry is unavailable for this comparison.';
    legend.innerHTML = '';
    dominanceMapHitPoints = [];
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
  // Render the vector map above display density so it stays sharp at Windows
  // fractional scaling, browser zoom and high-density mobile screens.
  const dpr = Math.min(4, Math.max(3, (window.devicePixelRatio || 1) * 1.5));
  const backingWidth = Math.round(rect.width * dpr);
  const backingHeight = Math.round(rect.height * dpr);
  if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
    canvas.width = backingWidth;
    canvas.height = backingHeight;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.lineJoin = 'round';
  ctx.clearRect(0, 0, rect.width, rect.height);
  const theme = canvasTheme();

  // OpenF1/FastF1 position axes are used north-up here. CircuitInfo.rotation is
  // a presentation rotation, not a compass bearing, so applying it made the
  // old compass rotate with the artwork. Build one gently regularised geometry
  // for the map, corner markers and hover hit-testing instead.
  const totalDistance = referenceDistance();
  const geometryKey = `${telemetryKey(loaded[0])}:${reference.length}:${rect.width.toFixed(2)}:${rect.height.toFixed(2)}:${totalDistance.toFixed(1)}`;
  let geometrySteps;
  let canvasGeometry;
  if (dominanceMapGeometryCache?.key === geometryKey) {
    ({ geometrySteps, canvasGeometry } = dominanceMapGeometryCache);
  } else {
    geometrySteps = Math.max(1600, Math.min(4200, Math.ceil(totalDistance / 1.8)));
    const sourceDistance = +reference[reference.length - 1]?.Distance || totalDistance;
    const spatialControls = trackSamples.map(point => ({
      fraction: Math.max(0, Math.min(1, Number.isFinite(point.AlignedFraction)
        ? point.AlignedFraction
        : (+point.Distance || 0) / sourceDistance)),
      x: +point.X,
      y: +point.Y,
    }))
      .sort((a, b) => a.fraction - b.fraction)
      // OpenF1 may hold one location packet across many faster car-channel
      // samples. Treat the repeated coordinates as one geometry control;
      // otherwise the map becomes a staircase of long flats and sharp jumps.
      .filter((point, index, array) => index === 0 || (
        point.fraction - array[index - 1].fraction > 1e-6
        && Math.hypot(point.x - array[index - 1].x, point.y - array[index - 1].y) > 1
      ));
    const controlCount = spatialControls.length;
    const cyclicControl = index => {
      const wrapped = ((index % controlCount) + controlCount) % controlCount;
      const cycle = Math.floor(index / controlCount);
      return { ...spatialControls[wrapped], fraction: spatialControls[wrapped].fraction + cycle };
    };
    const hermiteCoordinate = (p0, p1, p2, p3, ratio, key) => {
      if (controlCount < 4) return p1[key] + (p2[key] - p1[key]) * ratio;
      const width = Math.max(1e-7, p2.fraction - p1.fraction);
      const tangent1 = (p2[key] - p0[key]) * width / Math.max(1e-7, p2.fraction - p0.fraction);
      const tangent2 = (p3[key] - p1[key]) * width / Math.max(1e-7, p3.fraction - p1.fraction);
      const t2 = ratio * ratio;
      const t3 = t2 * ratio;
      return (2 * t3 - 3 * t2 + 1) * p1[key]
        + (t3 - 2 * t2 + ratio) * tangent1
        + (-2 * t3 + 3 * t2) * p2[key]
        + (t3 - t2) * tangent2;
    };
    let spatialCursor = 0;
    const mapGeometry = Array.from({ length: geometrySteps }, (_, index) => {
      const fraction = index / geometrySteps;
      while (spatialCursor < controlCount && spatialControls[spatialCursor].fraction < fraction) {
        spatialCursor++;
      }
      const p0 = cyclicControl(spatialCursor - 2);
      const before = cyclicControl(spatialCursor - 1);
      const after = cyclicControl(spatialCursor);
      const p3 = cyclicControl(spatialCursor + 1);
      const ratio = Math.max(0, Math.min(1,
        (fraction - before.fraction) / (after.fraction - before.fraction || 1)
      ));
      return {
        fraction,
        x: hermiteCoordinate(p0, before, after, p3, ratio, 'x'),
        y: hermiteCoordinate(p0, before, after, p3, ratio, 'y'),
      };
    });

    const minX = Math.min(...mapGeometry.map(point => point.x));
    const maxX = Math.max(...mapGeometry.map(point => point.x));
    const minY = Math.min(...mapGeometry.map(point => point.y));
    const maxY = Math.max(...mapGeometry.map(point => point.y));
    const padding = 34;
    const scale = Math.min((rect.width - padding * 2) / (maxX - minX || 1), (rect.height - padding * 2) / (maxY - minY || 1));
    const offsetX = (rect.width - (maxX - minX) * scale) / 2;
    const offsetY = (rect.height - (maxY - minY) * scale) / 2;
    const toCanvas = (x, y) => ({
      x: offsetX + (x - minX) * scale,
      y: rect.height - offsetY - (y - minY) * scale,
    });
    canvasGeometry = mapGeometry.map(point => ({ ...point, ...toCanvas(point.x, point.y) }));
    dominanceMapGeometryCache = { key: geometryKey, geometrySteps, canvasGeometry };
  }
  const segmentLength = 25;
  const segments = Math.ceil(totalDistance / segmentLength);

  const pointAt = fraction => {
    const wrapped = Math.max(0, Math.min(1, fraction)) * canvasGeometry.length;
    const beforeIndex = Math.floor(wrapped) % canvasGeometry.length;
    const afterIndex = (beforeIndex + 1) % canvasGeometry.length;
    const ratio = wrapped - Math.floor(wrapped);
    const before = canvasGeometry[beforeIndex];
    const after = canvasGeometry[afterIndex];
    return {
      x: before.x + (after.x - before.x) * ratio,
      y: before.y + (after.y - before.y) * ratio,
    };
  };
  dominanceMapHitPoints = canvasGeometry
    .filter((_, index) => index % 2 === 0)
    .map(point => ({ x: point.x, y: point.y, fraction: point.fraction }));

  // Re-sample the circuit by distance instead of drawing the sparse raw X/Y
  // packets.  This keeps long-radius corners smooth without raster scaling.
  ctx.strokeStyle = theme.mapBase;
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.beginPath();
  let geometryStarted = false;
  for (let index = 0; index <= geometrySteps; index++) {
    const pos = pointAt(index / geometrySteps);
    if (!pos) continue;
    if (!geometryStarted) {
      ctx.moveTo(pos.x, pos.y);
      geometryStarted = true;
    } else ctx.lineTo(pos.x, pos.y);
  }
  ctx.stroke();

  // Highlight the timing sector selected in the compact corner panel. The
  // dominance colour remains visible on top of this wider neon underlay.
  let highlightedCornerZone = null;
  if (typeof adaptiveCornerZones === 'function') {
    const markerCorners = resolveCornerMarkers(reference, totalDistance, loaded[0]?.cornerMarkers);
    const zones = adaptiveCornerZones(markerCorners);
    const selectedZone = zones[Math.max(0, Math.min(selectedCornerIndex, zones.length - 1))];
    if (selectedZone) {
      highlightedCornerZone = selectedZone;
      const steps = Math.max(4, Math.ceil((selectedZone.end - selectedZone.start) * totalDistance / 20));
      const drawHighlightPath = (color, width) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.beginPath();
        for (let step = 0; step <= steps; step++) {
          const point = pointAt(selectedZone.start + (selectedZone.end - selectedZone.start) * step / steps);
          if (!point) continue;
          if (step === 0) ctx.moveTo(point.x, point.y);
          else ctx.lineTo(point.x, point.y);
        }
        ctx.stroke();
      };
      drawHighlightPath('rgba(2, 3, 5, .96)', 13);
      drawHighlightPath('rgba(234, 255, 24, .86)', 11);
    }
  }

  const wins = new Set();
  if (comparative) {
    for (let index = 0; index < segments; index++) {
      const start = index / segments;
      const end = Math.min(1, (index + 1) / segments);
      const from = pointAt(start);
      const to = pointAt(end);
      if (!from || !to) continue;
      let winner = -1;
      let bestTime = Infinity;
      allSeries.forEach((series, lapIndex) => {
        const duration = typeof performanceSectionDuration === 'function'
          ? performanceSectionDuration(series, start, end)
          : calibratedElapsed(series, end) - calibratedElapsed(series, start);
        if (Number.isFinite(duration) && duration < bestTime) {
          bestTime = duration;
          winner = lapIndex;
        }
      });
      if (winner < 0) continue;
      wins.add(winner);
      ctx.strokeStyle = getDriverColor(mapEntries[winner].lap.code);
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      const segmentSteps = Math.max(2, Math.ceil((end - start) * totalDistance / 5));
      for (let step = 1; step <= segmentSteps; step++) {
        const point = pointAt(start + (end - start) * step / segmentSteps);
        if (point) ctx.lineTo(point.x, point.y);
      }
      ctx.stroke();
    }
  }

  if (highlightedCornerZone) {
    const apex = pointAt(highlightedCornerZone.apex);
    if (apex) {
      ctx.beginPath();
      ctx.moveTo(apex.x, apex.y - 6);
      ctx.lineTo(apex.x + 5, apex.y);
      ctx.lineTo(apex.x, apex.y + 6);
      ctx.lineTo(apex.x - 5, apex.y);
      ctx.closePath();
      ctx.fillStyle = '#eaff18';
      ctx.fill();
      ctx.strokeStyle = '#050608';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  // Corner markers rendered ON TOP of mini-sector dominance lines
  if ($('#cornerToggle').checked) {
    const markerCorners = resolveCornerMarkers(reference, totalDistance, loaded[0]?.cornerMarkers);
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    markerCorners.forEach(corner => {
      const point = pointAt(corner.fraction);
      if (!point) return;
      const angle = Number(corner.angle);
      const displayAngle = Number.isFinite(angle) ? angle : NaN;
      const offsetX = Number.isFinite(displayAngle) ? Math.cos(displayAngle * Math.PI / 180) * 11 : 0;
      const offsetY = Number.isFinite(displayAngle) ? -Math.sin(displayAngle * Math.PI / 180) * 11 : -11;
      ctx.lineWidth = 3;
      ctx.strokeStyle = theme.labelStroke;
      ctx.strokeText(cornerLabel(corner), point.x + offsetX, point.y + offsetY);
      ctx.fillStyle = theme.labelFill;
      ctx.fillText(cornerLabel(corner), point.x + offsetX, point.y + offsetY);
    });
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
  }

  // Ball Tracker indicator when hovering (telemetry charts or track map)
  if (hoverFraction !== null) {
    const hPoint = pointAt(hoverFraction);
    if (hPoint) {
      const refColor = getDriverColor(mapEntries[0].lap.code);
      ctx.fillStyle = hexToRgba(refColor, 0.35);
      ctx.beginPath();
      ctx.arc(hPoint.x, hPoint.y, 10, 0, 2 * Math.PI);
      ctx.fill();
      
      ctx.fillStyle = lightThemeActive() ? '#161b22' : '#ffffff';
      ctx.beginPath();
      ctx.arc(hPoint.x, hPoint.y, 4.5, 0, 2 * Math.PI);
      ctx.fill();
      ctx.strokeStyle = refColor;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  // The compass is fixed in the conventional screen orientation and the map
  // remains north-up: N top, E right, S bottom, W left. WindDirection is
  // meteorological, so its arrow travels from the reported bearing.
  const compassCentre = { x: 38, y: 38 };
  const compassRadius = 16;
  const cardinalVectors = {
    N: { x: 0, y: -1 }, E: { x: 1, y: 0 }, S: { x: 0, y: 1 }, W: { x: -1, y: 0 },
  };
  ctx.save();
  ctx.font = '9px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.strokeStyle = theme.outline;
  ctx.fillStyle = theme.panel;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(compassCentre.x, compassCentre.y, 24, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  Object.entries(cardinalVectors).forEach(([label, vector]) => {
    const dx = vector.x * compassRadius;
    const dy = vector.y * compassRadius;
    ctx.beginPath();
    ctx.moveTo(compassCentre.x, compassCentre.y);
    ctx.lineTo(compassCentre.x + dx, compassCentre.y + dy);
    ctx.strokeStyle = label === 'N' ? '#eaff18' : theme.outline;
    ctx.stroke();
    ctx.fillStyle = label === 'N' ? '#91a500' : theme.textStrong;
    ctx.fillText(label, compassCentre.x + dx * 1.28, compassCentre.y + dy * 1.28);
  });
  const referenceConditions = loaded[0]?.real?.conditions || {};
  const windDegrees = Number(referenceConditions.wind_direction);
  const windSpeed = Number(referenceConditions.wind_speed);
  if (Number.isFinite(windDegrees)) {
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const windLabel = directions[Math.round((((windDegrees % 360) + 360) % 360) / 45) % directions.length];
    const radians = (((windDegrees % 360) + 360) % 360) * Math.PI / 180;
    const fromVector = { x: Math.sin(radians), y: -Math.cos(radians) };
    const start = { x: compassCentre.x + fromVector.x * 12, y: compassCentre.y + fromVector.y * 12 };
    const end = { x: compassCentre.x - fromVector.x * 8, y: compassCentre.y - fromVector.y * 8 };
    const direction = { x: end.x - start.x, y: end.y - start.y };
    const length = Math.hypot(direction.x, direction.y) || 1;
    const ux = direction.x / length, uy = direction.y / length;
    ctx.strokeStyle = '#eaff18';
    ctx.fillStyle = '#eaff18';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(end.x, end.y);
    ctx.lineTo(end.x - ux * 5 + uy * 3, end.y - uy * 5 - ux * 3);
    ctx.lineTo(end.x - ux * 5 - uy * 3, end.y - uy * 5 + ux * 3);
    ctx.closePath();
    ctx.fill();
    ctx.textAlign = 'left';
    ctx.fillStyle = theme.textStrong;
    ctx.font = '9px monospace';
    ctx.fillText(`WIND FROM ${windLabel}${Number.isFinite(windSpeed) ? ` · ${windSpeed.toFixed(1)} M/S` : ''}`, 9, rect.height - 9);
  }
  ctx.restore();

  empty.style.display = 'none';
  const legendIndexes = comparative ? [...wins] : [0];
  legend.innerHTML = legendIndexes.map(index => {
    const lap = mapEntries[index]?.lap;
    if (!lap) return '';
    return `<span class="legend-item"><i class="legend-color" style="--team:${getDriverColor(lap.code)}"></i>${lap.code} L${lap.lap}</span>`;
  }).join('');
}

function applyTheme(theme, persist = true) {
  const nextTheme = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = nextTheme;
  const button = $('#themeToggle');
  if (button) {
    const light = nextTheme === 'light';
    button.setAttribute('aria-pressed', String(light));
    button.setAttribute('aria-label', light ? 'Switch to dark mode' : 'Switch to light mode');
    const label = button.querySelector('span');
    if (label) label.textContent = light ? 'Dark mode' : 'Light mode';
  }
  if (persist) {
    try { localStorage.setItem('apex-theme', nextTheme); } catch (_) { /* storage can be disabled */ }
  }
  if (loaded.length) drawAll();
}

// Initial Setup on Document Load
document.addEventListener('DOMContentLoaded', () => {
  window.addEventListener('mouseup', finishZoomDrag);
  applyTheme(document.documentElement.dataset.theme, false);
  document.querySelectorAll('.select-shell select').forEach(enhanceSelect);
  document.addEventListener('click', event => {
    if (event.target.closest('.select-shell')) return;
    document.querySelectorAll('.select-shell.is-open').forEach(shell => {
      shell.classList.remove('is-open');
      shell.querySelector('.select-trigger')?.setAttribute('aria-expanded', 'false');
    });
  });
  const yearSelect = $('#year');
  const currentYear = new Date().getFullYear();
  const years = [];
  for (let y = currentYear; y >= 2014; y--) {
    years.push(y);
  }
  populate(yearSelect, years);
  yearSelect.value = String(years[0]); // default to latest available season
  syncSelectUI(yearSelect);
  
  yearSelect.addEventListener('change', () => loadCalendar().catch(() => {}));
  $('#gp').addEventListener('change', populateSessions);
  $('#loadSession').onclick = loadRealSession;
  
  const themeToggle = $('#themeToggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      applyTheme(lightThemeActive() ? 'dark' : 'light');
    });
  }

  const cornerAnalysisToggle = $('#cornerAnalysisToggle');
  const cornerAnalysis = $('#cornerAnalysis');
  if (cornerAnalysisToggle && cornerAnalysis) {
    cornerAnalysisToggle.addEventListener('click', () => {
      const collapsed = cornerAnalysis.classList.toggle('is-collapsed');
      cornerAnalysisToggle.setAttribute('aria-expanded', String(!collapsed));
      const label = cornerAnalysisToggle.querySelector('span');
      if (label) label.textContent = collapsed ? 'Expand' : 'Collapse';
    });
  }
  
  const toggleBtn = $('#sidebarToggle');
  const mainEl = $('main');
  if (toggleBtn && mainEl) {
    toggleBtn.onclick = () => {
      const isCollapsed = mainEl.classList.toggle('sidebar-collapsed');
      toggleBtn.textContent = isCollapsed ? '▶ Expand Controls' : '◀ Toggle Controls';
      toggleBtn.setAttribute('aria-expanded', String(!isCollapsed));
      if (loaded.length) scheduleDrawAll();
    };
  }
  
  window.addEventListener('resize', scheduleDrawAll, { passive: true });
  
  clearBeforeSessionLoad();
  renderCharts();
  bindTrackMapHover();
  
  loadCalendar()
    .catch(error => {
      $('#gp').innerHTML = '<option>Calendar unavailable</option>';
      syncSelectUI($('#gp'));
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

function getCompoundToneClass(compound) {
  const value = String(compound || '').toUpperCase().replace(/\s+/g, '');
  if (value.includes('INTER')) return 'compound-intermediate';
  if (value.includes('WET')) return 'compound-wet';
  if (value.includes('MEDIUM')) return 'compound-medium';
  if (value.includes('HARD')) return 'compound-hard';
  if (value.includes('SOFT')) return 'compound-soft';
  return 'compound-unknown';
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
      <div class="tire-option tire-${String(label).toLowerCase()}" style="--tire-color:${color}">
        <span class="tire-code">${displayVal}</span>
        <span class="tire-copy"><strong>${label}</strong></span>
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
