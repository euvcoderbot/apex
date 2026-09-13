// Consolidated F1 Telemetry Hub Application Logic
let drivers = [];
let selected = [];
let loaded = [];
let openStint = {};
let realDrivers = new Map();
const telemetryCache = new Map();
const telemetryRequests = new Map();
const lapColorOverrides = new Map();
const customSelectValues = new WeakMap();
let calendar = [];
let corners = [];
let circuitRotation = 0;
let genericCircuitData = null;
let genericCircuitRequest = null;
let sessionEventName = '';
let sessionYear = null;
let openf1SessionKey = null;
let nominatedCompounds = [];
let activeDriverTab = null;
let selectedCornerIndex = 0;
let cornerSort = 'time';
let showCornerNumbers = false;
let enhancedTraceMode = false;
let traceTintEnabled = false;
const hiddenTraceKeys = new Set();
let dominanceMapHitPoints = [];
let dominanceMapGeometryCache = null;
let mapView = 'guide';
const apiCircuitGuides = new Map();
const apiCircuitGuideRequests = new Set();

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
const CLIENT_DATA_SCHEMA = 'direct-telemetry-v4';
const API_ORIGIN = String(window.APEX_API_ORIGIN || '').replace(/\/$/, '');

// Animate user-driven updates, not telemetry redraws. Keep keyboard focus
// on replacement controls without scrolling the page to their new position.
function replaceUI(root, html) {
  const motion = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const oldNodes = [...(root.querySelectorAll?.('[data-motion-key]') || [])];
  const previous = new Map(oldNodes.map(node => [node.dataset.motionKey, {
    rect: node.getBoundingClientRect(), selected: node.classList.contains('selected'),
  }]));
  const focusedKey = document.activeElement?.dataset?.motionKey;
  root.innerHTML = html;
  for (const node of [...(root.querySelectorAll?.('[data-motion-key]') || [])]) {
    if (node.matches('button:not(.remove)')) node.setAttribute('aria-pressed', String(node.classList.contains('selected') || node.classList.contains('reference')));
    if (node.dataset.motionKey === focusedKey) node.focus({ preventScroll: true });
    if (!motion || !node.animate) continue;
    const ancestor = node.parentElement?.closest('[data-motion-key]');
    const old = previous.get(node.dataset.motionKey);
    if (ancestor && root.contains(ancestor)) {
      if (old && old.selected !== node.classList.contains('selected') && node.matches('button')) {
        node.animate([{ transform: 'scale(.98)' }, { transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.22,.68,0,1)' });
      }
      continue;
    }
    const next = node.getBoundingClientRect();
    if (!next.width || !next.height) continue;
    const dx = old ? old.rect.left - next.left : 0;
    const dy = old ? old.rect.top - next.top : 6;
    if (!old || Math.abs(dx) + Math.abs(dy) > 1) {
      node.animate([{ opacity: old ? 1 : 0, transform: `translate(${dx}px, ${dy}px)` },
        { opacity: 1, transform: 'none' }], { duration: 280, easing: 'cubic-bezier(.22,.68,0,1)' });
    }
  }
}

function canvasFont(size = 12, weight = 400) {
  return `${weight} ${size}px -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI Variable", "Segoe UI", Helvetica, Arial, sans-serif`;
}

function installGlassMotion() {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  let frame = 0, target = null, pointer = null;
  document.addEventListener('pointermove', event => {
    if (event.pointerType !== 'mouse') return;
    target = event.target.closest('.session-controls, .trace-zoom-cluster');
    if (!target) return;
    pointer = { x: event.clientX, y: event.clientY };
    if (frame) return;
    frame = window.requestAnimationFrame(() => {
      frame = 0;
      if (!target?.isConnected || !pointer) return;
      const rect = target.getBoundingClientRect();
      target.style.setProperty('--glass-x', `${Math.round((pointer.x - rect.left) / (rect.width || 1) * 100)}%`);
      target.style.setProperty('--glass-y', `${Math.round((pointer.y - rect.top) / (rect.height || 1) * 100)}%`);
    });
  }, { passive: true });
}

function positionCornerIndicator(root, previous) {
  const picker = root.querySelector?.('.corner-picker');
  const active = picker?.querySelector('.corner-pick.selected');
  if (!picker || !active) return;
  picker.scrollLeft = previous?.scroll || 0;
  const left = `${active.offsetLeft}px`, width = `${active.offsetWidth}px`;
  picker.style.setProperty('--selection-left', left);
  picker.style.setProperty('--selection-width', width);
  picker.classList.remove('has-indicator');
}

function apiUrl(path) {
  return `${API_ORIGIN}${path}`;
}

async function fetchSessionData(url, options = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const controller = new AbortController();
    const abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(abort, 25000);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      if (![408, 429, 502, 503, 504].includes(response.status) || attempt === 1) return response;
      await response.text();
    } catch (error) {
      if (options.signal?.aborted) throw error;
      if (attempt === 1) throw new Error(error.name === 'AbortError' ? 'The server took too long. Please retry.' : error.message);
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', abort);
    }
    await new Promise(resolve => setTimeout(resolve, 700 * (attempt + 1)));
  }
}

const recentData = new Map();
const pendingApiData = new Map();
let preparedSessionIndex;
let prefetchSessionTimer;
let dataStorePromise;
function dataStore() {
  if (!dataStorePromise) dataStorePromise = new Promise(resolve => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    const request = indexedDB.open('euv2-data-v1', 2);
    request.onupgradeneeded = () => {
      const store = request.result.objectStoreNames.contains('responses')
        ? request.transaction.objectStore('responses')
        : request.result.createObjectStore('responses', { keyPath: 'url' });
      if (!store.indexNames.contains('stored')) store.createIndex('stored', 'stored');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = request.onblocked = () => resolve(null);
  });
  return dataStorePromise;
}
async function storedData(url) {
  const memory = recentData.get(url);
  if (memory && memory.expires > Date.now()) return memory.data;
  const db = await dataStore();
  if (!db) return null;
  return new Promise(resolve => {
    try {
      const request = db.transaction('responses').objectStore('responses').get(url);
      request.onsuccess = () => resolve(request.result?.expires > Date.now() ? request.result.data : null);
      request.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}
async function cacheData(url, data, ttl) {
  const record = { url, data, expires: Date.now() + ttl, stored: Date.now() };
  recentData.delete(url); recentData.set(url, record);
  if (recentData.size > 48) recentData.delete(recentData.keys().next().value);
  const db = await dataStore();
  if (!db) return;
  try {
    const transaction = db.transaction('responses', 'readwrite');
    const store = transaction.objectStore('responses');
    store.put(record);
    let count = 0;
    const cursor = store.index('stored').openKeyCursor(null, 'prev');
    cursor.onsuccess = () => {
      const item = cursor.result;
      if (!item) return;
      if (++count > 80) store.delete(item.primaryKey);
      item.continue();
    };
    transaction.onerror = () => {};
  } catch { /* Storage is optional, including private browsing and full disks. */ }
}
async function preparedData(url) {
  const parsed = new URL(url, window.location?.href || 'http://localhost');
  const year = Number(parsed.searchParams.get('year'));
  if (parsed.pathname === '/api/events' && year >= 2014 && year <= 2026) {
    const response = await fetch(`assets/data/events/${year}.json`);
    if (!response.ok) return null;
    const data = await response.json();
    if (year === new Date().getFullYear()) {
      // Refresh in the background; keep the immediately usable calendar stable.
      void fetchSessionData(url).then(async r => { if (r.ok) await cacheData(url, await r.json(), 120000); }).catch(() => {});
    }
    return data;
  }
  if (parsed.pathname !== '/api/session' || year >= new Date().getFullYear()) return null;
  preparedSessionIndex ||= fetch('assets/data/sessions/index.json').then(r => r.ok ? r.json() : {}).catch(() => ({}));
  const index = await preparedSessionIndex;
  const key = `${year}:${parsed.searchParams.get('gp')}:${parsed.searchParams.get('session')}`;
  if (!index[key]) return null;
  const response = await fetch(`assets/data/sessions/${index[key]}`);
  return response.ok ? response.json() : null;
}
async function requestApiData(url, options = {}) {
  const cached = await storedData(url);
  if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  if (cached) return structuredClone(cached);
  const prepared = await preparedData(url).catch(() => null);
  if (prepared) { void cacheData(url, structuredClone(prepared), 120000); return prepared; }
  const response = await fetchSessionData(url, options);
  const data = await readApiResponse(response);
  if (!response.ok) throw new Error(data.detail || `Data unavailable (${response.status})`);
  if (!/no-store/i.test(response.headers.get('cache-control') || '') && data.position_complete !== false) {
    const year = Number(new URL(url, window.location?.href || 'http://localhost').searchParams.get('year'));
    const historical = year > 0 && year < new Date().getFullYear();
    void cacheData(url, structuredClone(data), historical ? 7 * 86400000 : 120000);
  }
  return data;
}
async function loadApiData(url, options = {}) {
  if (!pendingApiData.has(url)) {
    const pending = requestApiData(url).finally(() => pendingApiData.delete(url));
    pendingApiData.set(url, pending);
  }
  const data = await pendingApiData.get(url);
  if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  return structuredClone(data);
}
function prepareSelectedSession() {
  clearTimeout(prefetchSessionTimer);
  prefetchSessionTimer = setTimeout(() => {
    if (!calendar.length || !selectValue($('#session'))) return;
    void loadApiData(apiUrl(`/api/session?${currentQuery()}`)).catch(() => {});
  }, 350);
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
  return flagEmoji(grandPrixCountryCode(event));
}

function grandPrixCountryCode(event) {
  const country = normalizedPlaceName(event?.country);
  const eventName = normalizedPlaceName(event?.name);
  return COUNTRY_FLAG_CODES[country]
    || GRAND_PRIX_FLAG_RULES.find(([name]) => eventName.includes(name))?.[1];
}

function escapeUI(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
}

function selectOptionContent(option) {
  const country = option?.dataset?.country || '';
  const flag = /^[A-Z]{2}$/.test(country)
    ? `<img class="gp-flag" src="assets/flags/${country.toLowerCase()}.svg" alt="${country}" width="24" height="18">` : '';
  return `${flag}<span class="select-option-text">${escapeUI(option?.textContent || 'Select')}</span>`;
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
  teamName = String(teamName || '');
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
    text: '#67676e',
    textStrong: 'rgba(20, 25, 32, .82)',
    grid: 'rgba(20, 25, 32, .09)',
    gridStrong: 'rgba(20, 25, 32, .24)',
    panel: '#ffffff',
    outline: 'rgba(20, 25, 32, .22)',
    mapBase: 'rgba(20, 25, 32, .16)',
    labelStroke: 'rgba(250, 251, 252, .96)',
    labelFill: 'rgba(20, 25, 32, .92)',
    crosshair: 'rgba(20, 25, 32, .3)',
  } : {
    text: '#a1a1aa',
    textStrong: 'rgba(255, 255, 255, .72)',
    grid: 'rgba(255, 255, 255, .05)',
    gridStrong: 'rgba(255, 255, 255, .25)',
    panel: '#1c1c1e',
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
  const display = drivers.find(item => item[0] === code);
  return display ? display[3] : '#777777';
}

function getLapColor(lap) {
  return lapColorOverrides.get(telemetryKey(lap)) || getDriverColor(lap.code);
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

// Official marks are resolved by the session's team, never by a driver's
// current team: historical sessions must not acquire modern branding.
const officialTeamMarks = {
  'mercedes': 'mercedes.webp', 'ferrari': 'ferrari.webp', 'mclaren': 'mclaren.webp',
  'red bull racing': 'redbullracing.webp', 'red bull': 'redbullracing.webp',
  'racing bulls': 'racingbulls.webp', 'rb': 'racingbulls.webp',
  'alpine': 'alpine.webp', 'alpine f1 team': 'alpine.webp',
  'haas': 'haasf1team.webp', 'haas f1 team': 'haasf1team.webp',
  'audi': 'audi.webp', 'williams': 'williams.webp',
  'aston martin': 'astonmartin.webp', 'cadillac': 'cadillac.webp',
};
const historicalTeamMarks = {
  'sauber': 'sauber.svg', 'kick sauber': 'kick-sauber.png', 'stake f1 team kick sauber': 'kick-sauber.png',
  'alfa romeo': 'alfa-romeo.svg', 'alfa romeo racing': 'alfa-romeo.svg', 'alfa romeo sauber': 'sauber.svg',
  'alphatauri': 'alphatauri.svg', 'alpha tauri': 'alphatauri.svg', 'scuderia alphatauri': 'alphatauri.svg',
  'toro rosso': 'toro-rosso.svg', 'scuderia toro rosso': 'toro-rosso.svg',
  'racing point': 'racing-point.svg', 'force india': 'force-india.png',
  'lotus': 'lotus.png', 'lotus f1 team': 'lotus.png', 'manor': 'manor.png', 'manor racing': 'manor.png',
  'marussia': 'marussia.png', 'manor marussia': 'marussia.png', 'caterham': 'caterham.png',
};
function teamLogoMarkup(teamName) {
  const key = String(teamName || '').trim().toLowerCase();
  if (key === 'renault' || key === 'renault sport f1 team') return '<span class="team-logo team-logo-historical" aria-hidden="true"><img src="assets/teams/historical/renault.png" alt="" width="26" height="26"></span>';
  const historical = historicalTeamMarks[key];
  if (historical) return `<span class="team-logo team-logo-historical" aria-hidden="true"><img src="assets/teams/historical/${historical}" alt="" width="26" height="26"></span>`;
  const asset = officialTeamMarks[key];
  if (!asset) return '<span class="team-logo" aria-hidden="true"><i class="team-logo-fallback"></i></span>';
  return `<span class="team-logo" aria-hidden="true"><img src="assets/teams/official/${asset}" alt="" width="26" height="26"></span>`;
}

function compoundBadgeMarkup(compound) {
  const name = String(compound || '').trim().toLowerCase();
  const spec = ({soft:['S','#ff493e'], medium:['M','#ffd735'], hard:['H','#f5f5f7'], intermediate:['I','#43cf79'], inter:['I','#43cf79'], wet:['W','#3395ff']})[name];
  if (!spec) return `<span class="compound-label">${escapeUI(compound || 'Unknown')}</span>`;
  return `<svg class="compound-badge" viewBox="0 0 32 32" role="img" aria-label="${name}" width="26" height="26"><title>${name}</title><circle cx="16" cy="16" r="15" fill="#202124"/><circle cx="16" cy="16" r="12" fill="none" stroke="${spec[1]}" stroke-width="3" stroke-dasharray="31.7 6" transform="rotate(-76 16 16)"/><text x="16" y="21" text-anchor="middle" fill="#fff" font-size="15" font-weight="700">${spec[0]}</text></svg>`;
}

function tyreImageMarkup(compound) {
  const name = String(compound || '').trim().toLowerCase();
  const asset = ({hard:'hard', medium:'medium', soft:'soft', intermediate:'intermediate', inter:'intermediate', wet:'wet'})[name];
  return asset ? `<img class="tyre-image" src="assets/tyres/official/${asset}.png" alt="" width="32" height="32" loading="lazy">` : '';
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
  trigger.querySelector('span').innerHTML = selectOptionContent(selectedOption);
  trigger.disabled = select.disabled;
  trigger.setAttribute('aria-expanded', String(shell.classList.contains('is-open')));
  menu.innerHTML = options.map((option, optionIndex) => `
    <button type="button" role="option" aria-selected="${option === selectedOption}" data-select-index="${optionIndex}" data-select-value="${encodeURIComponent(option.value)}" onclick="selectCustomOption(this)">
      ${selectOptionContent(option)}
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
  const label = document.querySelector(`label[for="${select.id}"]`);
  if (label) {
    label.id = `${select.id}Label`;
    trigger.setAttribute('aria-labelledby', label.id);
    menu.setAttribute('aria-labelledby', label.id);
  }
  menu.id = `${select.id}Options`;
  trigger.setAttribute('aria-controls', menu.id);
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
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      items[event.key === 'Home' ? 0 : items.length - 1]?.focus();
    } else if (event.key === 'Tab') {
      close();
      trigger.focus({ preventScroll: true });
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
      trigger.focus();
    }
  });
  trigger.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!shell.classList.contains('is-open')) trigger.click();
      else menu.querySelector('[aria-selected="true"]')?.focus({ preventScroll: true });
    } else if (event.key === 'Escape') close();
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
    const payload = await loadApiData(apiUrl(`/api/events?year=${year}`), { signal: calendarRequest.signal });
    if (generation !== calendarGeneration || year !== selectValue($('#year'))) return;
    calendar = payload;
    $('#gp').innerHTML = calendar.map(event => `<option value="${event.round}" data-country="${grandPrixCountryCode(event) || ''}">R${event.round} · ${escapeUI(event.name)}</option>`).join('');
    syncSelectUI($('#gp'));
    selectLatestCompletedEvent();
  } catch (error) {
    if (generation !== calendarGeneration || error.name === 'AbortError') return;
    $('#gp').innerHTML = '<option value="">Calendar unavailable — retry season</option>';
    syncSelectUI($('#gp'));
    notify(`Could not load calendar. ${error.message}`);
    throw error;
  }
}

function parsedSessionTimestamp(value) {
  if (!value) return NaN;
  const text = String(value).trim();
  // FastF1 historically emitted UTC timestamps with a space separator. That
  // shape is not parsed consistently by every browser, so normalize it to ISO.
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:/.test(text)
    ? text.replace(' ', 'T')
    : text;
  return new Date(normalized).getTime();
}

function latestCompletedSelection(events, now = Date.now()) {
  let latest = null;
  (events || []).forEach((event, eventIndex) => {
    (event.sessions || []).forEach((session, sessionIndex) => {
      const timestamp = parsedSessionTimestamp(event.session_dates?.[session]);
      if (!Number.isFinite(timestamp) || timestamp > now) return;
      if (!latest || timestamp > latest.timestamp) {
        latest = { event, session, timestamp, eventIndex, sessionIndex };
      }
    });
  });
  if (latest) return latest;

  // Older calendars can lack session timestamps. Use only weekends whose
  // event date has passed, and keep future seasons on their opening session.
  const completedEvents = (events || []).filter(event => {
    const eventDate = parsedSessionTimestamp(`${event.date || ''}T23:59:59Z`);
    return Number.isFinite(eventDate) && eventDate <= now;
  });
  const event = completedEvents.at(-1) || events?.[0] || null;
  const sessions = event?.sessions || [];
  return event ? {
    event,
    session: completedEvents.length ? sessions.at(-1) : sessions[0],
    timestamp: NaN,
  } : null;
}

function populateSessions(preferredSession = null) {
  const selectedVal = selectValue($('#gp'));
  const event = calendar.find(item => String(item.round) === String(selectedVal) || item.name === selectedVal) || calendar[0];
  const sessions = event?.sessions || [];
  populate($('#session'), sessions);
  if (!sessions.length) return;

  const latestForEvent = latestCompletedSelection([event]);
  const target = sessions.includes(preferredSession)
    ? preferredSession
    : sessions.includes(latestForEvent?.session) ? latestForEvent.session : sessions[0];
  $('#session').value = target;
  syncSelectUI($('#session'));
  prepareSelectedSession();
}

function selectLatestCompletedEvent() {
  // Compare timestamps directly instead of relying on calendar ordering. A
  // weekend in progress therefore selects its latest completed session.
  const latest = latestCompletedSelection(calendar);
  if (latest?.event) {
    customSelectValues.delete($('#gp'));
    $('#gp').value = String(latest.event.round);
  }
  syncSelectUI($('#gp'));
  populateSessions(latest?.session || null);
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
  drivers.splice(0, drivers.length);
  realDrivers.clear();
  selected = [];
  loaded = [];
  openStint = {};
  corners = [];
  circuitRotation = 0;
  sessionEventName = '';
  sessionYear = null;
  openf1SessionKey = null;
  nominatedCompounds = [];
  activeDriverTab = null;
  selectedCornerIndex = 0;
  traceZoom = { start: 0, end: 1 };
  zoomDrag = null;
  hiddenTraceKeys.clear();
  dominanceMapHitPoints = [];
  dominanceMapGeometryCache = null;
  telemetryCache.clear();
  sessionSectorGuide = null;
  telemetryRequests.clear();
  lapColorOverrides.clear();
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
  const request = sessionRequest;
  const requestedQuery = String(currentQuery());
  
  try {
    const payload = await loadApiData(apiUrl(`/api/session?${requestedQuery}`), {
      signal: sessionRequest.signal,
    });
    if (request !== sessionRequest || requestedQuery !== String(currentQuery())) return;
    if (!Array.isArray(payload.drivers) || !payload.drivers.length) throw new Error('No driver data is available for this session yet.');
    
    realDrivers = new Map(payload.drivers.map(driver => [driver.code, driver]));
    drivers.splice(0, drivers.length, ...payload.drivers.map(driver => [
      driver.code, driver.number, driver.name, driver.team_color, driver.team, driver.position
    ]));
    corners = payload.corners || [];
    sessionEventName = payload.event || '';
    sessionYear = Number(new URLSearchParams(requestedQuery).get('year'));
    openf1SessionKey = Number.isInteger(payload.openf1_session_key) ? payload.openf1_session_key : null;
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
    if (request !== sessionRequest) return;
    button.disabled = false;
    button.classList.remove('is-loading');
    button.removeAttribute('aria-busy');
    button.removeAttribute('aria-label');
    button.textContent = 'Load session';
  }
}

async function fetchTelemetry(lap) {
  const key = telemetryKey(lap);
  const sessionAtStart = sessionRequest;
  if (telemetryCache.has(key)) return telemetryCache.get(key);
  if (telemetryRequests.has(key)) return telemetryRequests.get(key);
  const request = (async () => {
    const query = currentQuery();
    query.set('driver', lap.code);
    query.set('lap', lap.lap);
    query.set('alignment', '3');
    const data = await loadApiData(apiUrl(`/api/telemetry?${query}`));
    if (sessionAtStart !== sessionRequest) throw new DOMException('Session changed', 'AbortError');
    const samples = data.samples || [];
    samples.forEach(pt => {
      const d = +pt.DRS;
      pt.DRS = d >= 10 || pt.DRS === true || pt.DRS === 1 || pt.DRS === '1' ? 1 : 0;
      if (pt.Brake === true || pt.Brake === 1 || pt.Brake === '1' || pt.Brake === 'True') pt.Brake = 100;
      else pt.Brake = Number.isFinite(+pt.Brake) && +pt.Brake > 0 ? +pt.Brake : 0;
    });
    telemetryCache.set(key, samples);
    if (!sessionSectorGuide) sessionSectorGuide = makeSectorGuide(lap, samples, data.corners);
    return samples;
  })();
  telemetryRequests.set(key, request);
  try {
    return await request;
  } finally {
    if (telemetryRequests.get(key) === request) telemetryRequests.delete(key);
  }
}

// UI Rendering Functions
function renderDrivers() {
  const root = $('#driverPills');
  if (!drivers.length) {
    root.innerHTML = '<span class="section-empty">Load a session to see its drivers.</span>';
    return;
  }
  
  replaceUI(root, drivers.map((d, index) => {
    const code = d[0];
    const number = d[1];
    const color = d[3];
    const isSelected = selected.includes(code);
    const position = Number.isFinite(+d[5]) && +d[5] > 0 ? +d[5] : index + 1;

    const name = String(d[2] || code);
    return `<button class="driver-pill ${isSelected ? 'selected' : ''}" style="--team:${color}" data-motion-key="driver-${code}" data-code="${code}" aria-label="${escapeUI(`P${position}, ${name}, ${d[4] || ''}, number ${number}`)}" aria-pressed="${isSelected}"><span class="driver-pill-position">${position}</span>${teamLogoMarkup(d[4])}<span class="driver-pill-identity"><strong>${escapeUI(name)}</strong><small>${code} · ${number}</small></span><span class="driver-selection-mark" aria-hidden="true"></span></button>`;
  }).join(''));
  
  root.querySelectorAll('button').forEach(btn => {
    btn.onkeydown = event => {
      const rows = [...root.querySelectorAll('button')];
      const index = rows.indexOf(btn);
      const target = event.key === 'ArrowDown' ? Math.min(rows.length - 1, index + 1)
        : event.key === 'ArrowUp' ? Math.max(0, index - 1)
        : event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : null;
      if (target == null) return;
      event.preventDefault();
      rows[target]?.focus();
    };
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

  const globalCompareHtml = `<button id="compareAllFastest" data-motion-key="compare-fastest" class="compare-all-btn ${isAllFastestLoaded ? 'selected' : ''}"><i aria-hidden="true">⚡</i><span>COMPARE FASTEST LAPS</span></button>`;
  
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
      return `<button class="stint ${id === active ? 'selected' : ''}" style="--team:${display[3]}" data-motion-key="run-${code}-${id}" data-code="${code}" data-stint="${id}">${id}<small><span class="compound-label ${compoundClass}">${compLabel}</span> - ${group.length} ${group.length === 1 ? 'lap' : 'laps'}</small></button>`;
    }
    return `<button class="stint ${id === active ? 'selected' : ''}" style="--team:${display[3]}" data-motion-key="run-${code}-${id}" data-code="${code}" data-stint="${id}">Stint ${id}<small><span class="compound-label ${compoundClass}">${compLabel}</span> · ${group.length} L</small></button>`;
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
    mapView = 'comparison';
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
      <button id="compareAllFastest" data-motion-key="compare-fastest" class="compare-all-btn ${isAllFastestLoaded ? 'selected' : ''}" title="Add the fastest timed lap for every selected driver"><i aria-hidden="true">&#9889;</i><span>Compare fastest</span></button>
    </div>
  `;

  const cards = selected.map(code => {
    const driver = realDrivers.get(code);
    const display = drivers.find(item => item[0] === code);
    if (!driver || !display) return '';
    const teamColor = display[3] || '#777777';
    if (!driver.laps?.length) {
      return `<article class="driver-run-card" data-motion-key="run-card-${code}" style="--team:${teamColor}"><header class="run-card-header"><div class="run-driver">${teamLogoMarkup(display[4])}<div class="run-driver-copy"><h3>${escapeUI(driver.name)}</h3><small>${code}</small></div></div></header><p class="section-empty">No laps in this session.</p></article>`;
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
      const runLabel = hasQualifyingPhases ? id : `Stint ${id}`;
      const count = hasQualifyingPhases ? new Set(laps.map(lap => lap.stint)).size : laps.length;
      const countLabel = hasQualifyingPhases ? (count === 1 ? 'run' : 'runs') : (count === 1 ? 'lap' : 'laps');
      return `<button type="button" class="stint run-segment ${id === active ? 'selected' : ''}" aria-pressed="${id === active}" aria-label="Show ${escapeUI(runLabel)} laps for ${code}" style="--team:${teamColor}" data-motion-key="run-${code}-${id}" data-code="${code}" data-stint="${id}"><strong>${runLabel}</strong><small>${compoundBadgeMarkup(laps[0]?.compound)} ${count} ${countLabel}</small><span class="run-choice-indicator" aria-hidden="true">${id === active ? '✓' : '›'}</span></button>`;
    }).join('');
    const qualifyingRuns = [...new Set(activeLaps.map(lap => lap.stint))];
    const lapButtons = activeLaps.map(lap => {
      const isLoaded = loaded.some(item => item.code === code && item.lap === lap.lap);
      const flag = `L${lap.lap}`;
      const classes = ['lap', 'lap-chip', lap.in_lap || lap.out_lap ? 'in-out' : '', isLoaded ? 'selected' : ''].filter(Boolean).join(' ');
      const displayTime = Number.isFinite(lap.display_time) ? lap.display_time : lap.time;
      const estimated = lap.display_time_estimated === true;
      const duration = Number.isFinite(displayTime) ? `${estimated ? '~' : ''}${time(displayTime)}` : '&mdash;';
      const selectable = Number.isFinite(lap.time) && !lap.in_lap && !lap.out_lap;
      const context = lap.out_lap ? '<small>OUT</small>' : lap.in_lap ? '<small>IN</small>' : '';
      const title = lap.out_lap && estimated ? 'Estimated from pit exit to the timing line' : '';
      const age = Number.isFinite(lap.tyre_life) && lap.tyre_life >= 1 ? Math.round(lap.tyre_life) : null;
      const tyreDetail = hasQualifyingPhases ? `<small class="lap-tyre-age">Run ${qualifyingRuns.indexOf(lap.stint) + 1} · Tyre age ${age === null ? 'unknown' : `${age} ${age === 1 ? 'lap' : 'laps'}`}</small>` : '';
      return `<button class="${classes}" style="--team:${teamColor}" data-motion-key="lap-${code}-${lap.lap}" data-code="${code}" data-lap="${lap.lap}" ${selectable ? '' : 'disabled'} title="${title}"><span class="lap-token">${flag}</span><span class="lap-clock">${duration}${context}</span>${compoundBadgeMarkup(lap.compound)}${tyreDetail}</button>`;
    }).join('');
    const groupLabel = hasQualifyingPhases ? active : `Stint ${active}`;

    return `
      <article class="driver-run-card" data-motion-key="run-card-${code}" style="--team:${teamColor}">
        <header class="run-card-header">
          <div class="run-driver">${teamLogoMarkup(display[4])}<div class="run-driver-copy"><h3>${escapeUI(driver.name)}</h3><small>${code} · ${timedLaps.length} timed laps</small></div></div>
          ${fastest ? `<button class="fastest-lap-pick ${fastestLoaded ? 'selected' : ''}" data-motion-key="fastest-${code}" data-code="${code}" data-lap="${fastest.lap}" title="Add or remove this fastest lap"><span>Fastest</span><strong>${time(fastest.time)}</strong></button>` : ''}
        </header>
        <div class="run-section-label"><span>Runs</span></div>
        <div class="run-segments">${runButtons}</div>
        <div class="lap-group-header"><span>${groupLabel} laps</span><small>${hasQualifyingPhases ? 'Tyre age at lap end' : `${activeLaps.length} available`}</small></div>
        <div class="lap-grid">${lapButtons}</div>
      </article>
    `;
  }).join('');

  replaceUI(root, toolbar + cards);

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
  
  replaceUI(root, loaded.map((item, index) => `
    <div class="loaded-lap-pill ${index === 0 ? 'reference' : ''}" style="--team:${getLapColor(item)}" data-motion-key="comparison-${item.code}-${item.lap}" data-index="${index}">
      <button class="loaded-lap-main ${index === 0 ? 'reference' : ''}" data-motion-key="reference-${item.code}-${item.lap}" aria-pressed="${index === 0}" aria-label="Use ${item.code} lap ${item.lap} as reference"><b>${item.code}</b><span>L${item.lap}</span><strong>${time(item.time)}</strong></button><button class="remove" data-motion-key="remove-${item.code}-${item.lap}" data-remove="${index}" aria-label="Remove ${item.code} lap ${item.lap}">×</button>
    </div>`).join(''));
  
  root.querySelectorAll('.loaded-lap-pill').forEach(p => {
    p.onclick = e => {
      const idx = +p.dataset.index;
      const remove = e.target.closest('[data-remove]');
      if (remove) {
        const removeIdx = +remove.dataset.remove;
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
  replaceUI(root, loaded.map((item, i) => {
    const lap = item.real || {};
    const refLap = ref.real || {};
    const color = getLapColor(item);
    const sectors = sectorFields.map((field, sectorIndex) => ({
      label: `S${sectorIndex + 1}`,
      value: lap[field],
      reference: refLap[field],
      state: sectorState(item.code, sectorIndex, lap[field]),
    }));
    const conditions = lap.conditions || {};
    const direction = windCardinal(conditions.wind_direction);
    const conditionValues = [
      conditionCell('🌤️', 'Air', Number.isFinite(conditions.air_temperature) ? `${conditions.air_temperature.toFixed(1)}°C` : '—'),
      conditionCell('🌡️', 'Track', Number.isFinite(conditions.track_temperature) ? `${conditions.track_temperature.toFixed(1)}°C` : '—'),
      conditionCell('🚩', 'Wind', Number.isFinite(conditions.wind_speed) ? `${conditions.wind_speed.toFixed(1)} m/s${direction ? ` ${direction}` : ''}` : '—'),
      conditionCell('🌧️', 'Rain', conditions.rainfall === null || conditions.rainfall === undefined ? '—' : (conditions.rainfall ? 'Yes' : 'No')),
    ];
    const conditionsHtml = `<div class="summary-conditions">${conditionValues.join('')}</div>`;
    const compound = getCompoundCode(lap.compound || 'UNKNOWN', nominatedCompounds);
    const compoundClass = getCompoundToneClass(lap.compound || 'UNKNOWN');
    const tyreLife = Number.isFinite(lap.tyre_life) ? `${Math.max(1, Math.round(lap.tyre_life))}L` : '';
    return `
      <article class="lap-summary-card has-conditions" data-motion-key="summary-${item.code}-${item.lap}" style="--team:${color}">
        <header>
          <span class="summary-driver"><b>${item.code}</b><small>L${item.lap}</small>${i === 0 ? '<em>REF</em>' : ''}</span>
          <span class="summary-header-actions">
            <span class="summary-tyre ${compoundClass}">${tyreImageMarkup(lap.compound)}<span class="summary-tyre-copy"><b>${compound}</b>${tyreLife ? `<small>${tyreLife} used</small>` : ''}</span></span>
            <span class="summary-lap-time"><small>LAP</small><strong>${Number.isFinite(item.time) ? time(item.time) : '—'}</strong>${i === 0 ? '' : deltaBadge(item.time, ref.time)}</span>
          </span>
        </header>
        <div class="summary-sectors">${sectors.map(({ label, value, reference, state }) => `
          <span class="sector-cell ${state.className}" title="${label} · ${state.label}">
            <span class="sector-cell-value"><small>${label}</small><strong>${Number.isFinite(value) ? `${value.toFixed(3)}s` : '—'}</strong></span>
            <span class="sector-delta-slot">${i === 0 ? '' : deltaBadge(value, reference)}</span>
          </span>`).join('')}
        </div>
        ${conditionsHtml}
      </article>
    `;
  }).join(''));

  root.querySelectorAll('.trace-color-picker').forEach(input => {
    input.addEventListener('change', event => {
      lapColorOverrides.set(event.target.dataset.lapColor, event.target.value);
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
      : 'Full lap';
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
      const local = Math.max(0, Math.min(1, (event.clientX - rect.left - TRACE_PLOT_LEFT) / (rect.width - TRACE_PLOT_LEFT - TRACE_PLOT_RIGHT)));
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
    return `<div class="trace-pill-group" style="--team:${getLapColor(lap)}"><label class="trace-swatch"><input type="color" value="${getLapColor(lap)}" data-lap-color="${key}" aria-label="Change ${lap.code} lap ${lap.lap} trace colour"><span aria-hidden="true">✎</span></label><label class="trace-driver-chip ${visible ? 'is-visible' : ''}" style="--team:${getLapColor(lap)}" title="${visible ? 'Hide' : 'Show'} ${lap.code} lap ${lap.lap}">
      <input type="checkbox" data-trace-key="${key}" ${visible ? 'checked' : ''} ${disableLast ? 'disabled' : ''}>
      <b>${lap.code}</b><small>L${lap.lap}</small>
    </label></div>`;
  }).join('');

  root.querySelectorAll('input[data-lap-color]').forEach(input => {
    input.addEventListener('change', event => {
      lapColorOverrides.set(event.target.dataset.lapColor, event.target.value);
      renderLoaded(); renderSectors(); renderTraceVisibilityControls(); drawAll();
    });
  });
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
      status.textContent = enhancedTraceMode ? 'Interpolated' : 'Accurate';
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
          <span class="trace-zoom-readout">View <b id="traceZoomReadout">Full lap</b></span>
          <div class="trace-tools">
            <button data-zoom="out" title="Zoom out" aria-label="Zoom out">−</button>
            <button data-zoom="in" title="Zoom in" aria-label="Zoom in">+</button>
            <span class="trace-tool-separator" aria-hidden="true"></span>
            <button data-pan="left" title="Move zoom window left" aria-label="Move zoom window left">‹</button>
            <button data-pan="right" title="Move zoom window right" aria-label="Move zoom window right">›</button>
            <button class="trace-reset" data-zoom="reset" title="Reset zoom">Reset</button>
          </div>
        </div>` : ''}</div>
      ${name === 'Speed trace' ? `
        <div class="speed-chart-controls">
          <div class="trace-settings" aria-label="Telemetry display settings">
            <div class="alignment-readout"><i></i><span id="alignmentStatus" data-state="idle">Speed trace controls</span></div>
            <label class="trace-setting"><input type="checkbox" id="cornerToggle" ${showCornerNumbers ? 'checked' : ''}><i aria-hidden="true"></i><span>Corner numbers</span></label>
            <label class="trace-setting trace-mode-toggle" title="Smooth interpolation through trusted samples. Repairs require evidence from neighbouring acceleration, throttle, brake and gear/RPM; full throttle alone does not prove a fault. Uncertain gaps are marked as estimates. Timing delta follows reconstructed speed while official sector and finish deltas stay exact."><input type="checkbox" id="interpolationToggle" ${enhancedTraceMode ? 'checked' : ''}><i aria-hidden="true"></i><span>Enhanced interpolation</span><small id="traceModeStatus" data-mode="${enhancedTraceMode ? 'enhanced' : 'accurate'}">${enhancedTraceMode ? 'Interpolated' : 'Accurate'}</small></label>
            <label class="trace-setting"><input type="checkbox" id="tintToggle" ${traceTintEnabled ? 'checked' : ''}><i aria-hidden="true"></i><span>Trace tint</span></label>
          </div>
          <div class="trace-display-bar">
            <span>Visible traces</span>
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

function connectorSegmentsIntersect(a, b, c, d) {
  const cross = (p,q,r) => (q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x);
  if(Math.max(a.x,b.x)<Math.min(c.x,d.x)-.1 || Math.max(c.x,d.x)<Math.min(a.x,b.x)-.1 || Math.max(a.y,b.y)<Math.min(c.y,d.y)-.1 || Math.max(c.y,d.y)<Math.min(a.y,b.y)-.1) return false;
  return cross(a,b,c)*cross(a,b,d)<=.01 && cross(c,d,a)*cross(c,d,b)<=.01;
}

// Nearby labels need no leader. Displaced labels stop at their text boundary
// and cannot cross an earlier leader or label (nor obscure a later label).
function cornerLabelConnector(point, box, leaders, boxes) {
  if(leaders.some(line=>trackIntersectsLabel(box,[line.a,line.b],2))) return null;
  const end={x:Math.max(box.x,Math.min(box.x+box.width,point.x)),y:Math.max(box.y,Math.min(box.y+box.height,point.y))};
  const distance=Math.hypot(end.x-point.x,end.y-point.y);
  if(distance<=19) return {line:null};
  const start={x:point.x+(end.x-point.x)*5/distance,y:point.y+(end.y-point.y)*5/distance};
  if(leaders.some(line=>connectorSegmentsIntersect(start,end,line.a,line.b)) || boxes.some(b=>trackIntersectsLabel(b,[start,end],2))) return null;
  return {line:{a:start,b:end}};
}

function trackIntersectsLabel(box, points, clearance = 8) {
  const left = box.x - clearance, right = box.x + box.width + clearance;
  const top = box.y - clearance, bottom = box.y + box.height + clearance;
  return points.some((a, index) => {
    const b = points[(index + 1) % points.length];
    if (Math.max(a.x,b.x) < left || Math.min(a.x,b.x) > right || Math.max(a.y,b.y) < top || Math.min(a.y,b.y) > bottom) return false;
    let enter = 0, leave = 1;
    for (const [start, delta, min, max] of [[a.x,b.x-a.x,left,right],[a.y,b.y-a.y,top,bottom]]) {
      if (Math.abs(delta) < 1e-9) { if (start < min || start > max) return false; continue; }
      const t1 = (min-start)/delta, t2 = (max-start)/delta;
      enter = Math.max(enter, Math.min(t1,t2));
      leave = Math.min(leave, Math.max(t1,t2));
      if (enter > leave) return false;
    }
    return true;
  });
}

function cornerLabel(corner) {
  return `T${corner.number}${corner.letter || ''}`;
}

// Approximate apex chainage digitized against the FIA Madrid circuit map,
// version 3 (10 Sep 2026), and the bundled es-2026 centreline. Anchored at
// T7 = S1 + 85m and T16 = S1 + S2 + 40m; circuit length = 5414m.
// These are map-derived annotations, not surveyed telemetry coordinates.
// Full methodology and primary source: assets/circuits/madrid-corners.md.
const MADRID_MAP_CORNERS = Object.freeze([
  ['1',454], ['2',505], ['3',643], ['4',1332], ['5',1545], ['5A',1569],
  ['6',1605], ['7',1924], ['8',1983], ['9',2086], ['10',2271], ['11',2370],
  ['12',2696], ['13',3301], ['14',3492], ['15',3732], ['16',3928],
  ['17',3993], ['18',4237], ['19',4455], ['20',4789], ['20A',4833],
  ['21',4943], ['22',5260],
].map(([label, distance]) => Object.freeze({
  number: label.replace(/[A-Z]/g, ''), letter: label.replace(/[0-9]/g, ''),
  distance, fraction: distance / 5414, source: 'fia_map_estimate', approximate: true,
})));

function markerRowsForCurrentCircuit(rows) {
  rows = Array.isArray(rows) ? rows : [];
  const selectedVal = selectValue($('#gp'));
  const event = calendar.find(item => String(item.round) === String(selectedVal) || item.name === selectedVal) || calendar[0];
  const year = sessionYear || Number(selectValue($('#year')));
  const name = normalizedPlaceName(sessionEventName || event?.name);

  // The 2026 Spanish GP moved to the new 22-turn Madring. Until its circuit
  // metadata is published, the upstream provider returns Barcelona's old
  // 14-corner rows under the shared "Spanish Grand Prix" event name. Never
  // project that visibly wrong circuit over Madrid telemetry. Use the
  // documented map fallback until a complete native Madrid set is available.
  if (year >= 2026 && name.includes('spanish grand prix')) {
    const numericTurns = new Set(rows.map(row => Number(row.number)).filter(Number.isFinite));
    if (!Array.from({length:22}, (_, index) => index + 1).every(turn => numericTurns.has(turn))) {
      return MADRID_MAP_CORNERS.map(marker => ({...marker}));
    }
  }
  return rows;
}

function resolveCornerMarkers(samples, totalDistance, suppliedMarkers = null) {
  if (!samples?.length || !Number.isFinite(totalDistance) || totalDistance <= 0) return [];
  // Telemetry responses carry corner fractions projected against this exact
  // reference lap. Only use the session-level rows as a fallback for older
  // responses, where a client-side X/Y projection remains useful.
  const markerRows = markerRowsForCurrentCircuit(Array.isArray(suppliedMarkers) && suppliedMarkers.length
    ? suppliedMarkers
    : corners);
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
  ctx.font = canvasFont(12);
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
  const calloutWidth = 32;
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
  if (hoverFraction !== null && hoverFraction >= viewStart && hoverFraction <= viewEnd) {
    candidates.push({ x: hoverFraction, y: traceTelemetryValue(series, hoverFraction, field) });
  }
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

const TRACE_PLOT_LEFT = 58;
const TRACE_PLOT_RIGHT = 7;
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
    ctx.font = canvasFont(12);
    ctx.fillText('Select a driver to begin comparison.', 43, 25);
    return;
  }
  
  if (!data.length) {
    ctx.fillStyle = theme.text;
    ctx.font = canvasFont(12);
    ctx.fillText('Loading telemetry data…', 43, 25);
    return;
  }

  if (name === 'DRS' && Number($('#year').value) >= 2026
    && !data.some(series => series.modeAvailable)) {
    ctx.fillStyle = theme.textStrong;
    ctx.font = canvasFont(12);
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
        // Union of both modes keeps the scale stable when toggling enhanced.
        for (const mode of ['accurate', 'enhanced']) {
          const model = cachedDeltaModel(samples, refSamples, mode);
          const resolution = Math.max(360, model?.resolution || 0);
          for (let i = 0; i <= resolution; i++) {
            const fraction = viewStart + viewSpan * i / resolution;
            const v = displayDeltaAt(samples, refSamples, fraction, mode);
            if (Number.isFinite(v)) values.push(v);
          }
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
  const axisLeft = TRACE_PLOT_LEFT;
  const speedCornerMarkers = name === 'Speed trace'
    ? resolveCornerMarkers(refSamples, totalDist, refLap?.cornerMarkers)
    : [];
  const cornerCalloutLayout = layoutSpeedCornerCallouts(speedCornerMarkers, rect.width, axisLeft, 7, viewStart, viewEnd);
  const cornerAxisInset = speedCornerMarkers.length
    ? 8 + cornerCalloutLayout.lanes * 20
    : 0;
  const bounds = {
    left: axisLeft,
    right: TRACE_PLOT_RIGHT,
    top: 8,
    bottom: 21 + (name === 'Speed trace' ? cornerAxisInset : 0),
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
    ctx.font = canvasFont(12);
    ctx.textAlign = tick === 0 ? 'left' : tick === 6 ? 'right' : 'center';
    ctx.fillText(`${Math.round(fraction * totalDist)} M`, x, rect.height - bounds.bottom + 18);
  }
  ctx.textAlign = 'left';
  
  if (name === 'Speed trace' && $('#cornerToggle').checked) {
    const count = speedCornerMarkers.length;
    const projection = refLap?.cornerMarkers?.[0]?.source === 'lap_projection';
    const approximate = speedCornerMarkers.some(marker => marker.approximate);
    $('#cornerStatus').textContent = approximate
      ? 'Madrid: 22 turns + T5A/T20A · approximate positions from the FIA circuit map.'
      : count
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
    ctx.font = canvasFont(12);
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
    
    const teamColor = getLapColor(lap);
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
      const steps = name === 'Timing delta' ? (enhancedInterpolationEnabled() ? 1200 : 360) : 180;
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
      if (name === 'Timing delta' && hoverFraction !== null && fractionInView(hoverFraction)) {
        domainPoints.push({ x: hoverFraction, y: displayDeltaAt(series, refSeries, hoverFraction) });
        domainPoints.sort((a, b) => a.x - b.x);
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
    const rowHeight = 20;
    const calloutHeight = 16;
    cornerCalloutLayout.items.forEach(({ corner, x, lane, width }) => {
      if (!Number.isFinite(corner.fraction)) return;
      const labelY = rect.height - cornerAxisInset + 4 + lane * rowHeight;
      const left = x - width / 2;

      ctx.fillStyle = theme.textMuted || theme.textStrong;
      ctx.font = canvasFont(12);
      ctx.textAlign = 'center';
      ctx.fillText(cornerLabel(corner), x, labelY + 12);
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
        const teamColor = getLapColor(lap);
        
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
      const printableWidth = rect.width - TRACE_PLOT_LEFT - TRACE_PLOT_RIGHT;
      const localFraction = Math.max(0, Math.min(1, (e.clientX - rect.left - TRACE_PLOT_LEFT) / printableWidth));
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
      let hasLowConfidenceValue = false;
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
            if (telemetryEstimateInfo(series, fraction, field)?.confidence === 'low') hasLowConfidenceValue = true;
            const precision = (hoveredChartName === 'Speed trace'
              || hoveredChartName === 'Throttle application')
              ? val.toFixed(1)
              : Math.round(val);
            display = `${reconstructed ? '~' : ''}${precision} ${unit}`;
          }
        }
        return `<span style="color: ${getLapColor(lap)}">●</span> ${lap.code} L${lap.lap} · <b>${display}</b>`;
      });
      
      const reconstructionNote = hasReconstructedValue
        ? `<br><small>~ ${hasLowConfidenceValue ? 'LOW-CONFIDENCE GAP ESTIMATE' : 'ESTIMATED REPAIR'}</small>`
        : '';
      tooltip.innerHTML = `<b>${distanceKM.toFixed(3)} KM</b><br>${lines.join('<br>')}${reconstructionNote}`;
      tooltip.style.display = 'block';
      
      const parentRect = telemetryCard.getBoundingClientRect();
      const zoom = parentRect.width / telemetryCard.offsetWidth || 1;
      const tipRect = tooltip.getBoundingClientRect();
      const right = Math.min(parentRect.right, window.innerWidth) - 12;
      const x = e.clientX + 15 + tipRect.width > right ? e.clientX - tipRect.width - 15 : e.clientX + 15;
      const xPos = Math.max(8, (x - parentRect.left) / zoom);
      const yPos = Math.max(8, (Math.min(e.clientY + 15, window.innerHeight - tipRect.height - 12) - parentRect.top) / zoom);
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
          return `<span style="color: ${getLapColor(lap)}">●</span> ${lap.code} L${lap.lap} · <b>${speedDisplay}</b> · ${timeDisplay}`;
        });

        tooltip.innerHTML = `<b>TRACK MAP · ${distanceKM.toFixed(3)} KM · 25 M SECTION</b><br>${lines.join('<br>')}`;
        tooltip.style.display = 'block';

        const parentRect = telemetryCard.getBoundingClientRect();
        const zoom = parentRect.width / telemetryCard.offsetWidth || 1;
        const tipRect = tooltip.getBoundingClientRect();
        const right = Math.min(parentRect.right, window.innerWidth) - 12;
        const x = e.clientX + 15 + tipRect.width > right ? e.clientX - tipRect.width - 15 : e.clientX + 15;
        const xPos = Math.max(8, (x - parentRect.left) / zoom);
        const yPos = Math.max(8, (Math.min(e.clientY + 15, window.innerHeight - tipRect.height - 12) - parentRect.top) / zoom);
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
  let outstanding = requestedLaps.length;
  const promises = requestedLaps.map(async lap => {
    const alreadyReady=telemetryCache.has(telemetryKey(lap));
    try {
      await fetchTelemetry(lap);
      if (!alreadyReady && outstanding > 1 && generation === drawGeneration && loaded[0] && telemetryCache.has(telemetryKey(loaded[0]))) {
        paintReadyTelemetry();
      }
    } catch (err) {
      console.warn(err);
      failures.push({ lap, error: err });
    } finally {
      outstanding--;
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
  paintReadyTelemetry();
}

function paintReadyTelemetry() {
  if (typeof prepareTelemetryAlignment === 'function') {
    prepareTelemetryAlignment();
  }
  const season = Number($('#year').value);
  const activeDefs = season >= 2026
    ? defs.filter(([name]) => name !== 'DRS')
    : defs;
  activeDefs.forEach(definition => drawRealChart(definition[0]));
  renderCornerAnalysis();
  renderMiniSectorMap();
}

function updateTelemetryVisibility() {
  const card = $('#telemetryCard');
  if (!card) return;
  const empty = loaded.length === 0;
  card.classList.toggle('is-empty', empty);
  card.classList.toggle('has-generic-map', empty && (selected.length > 0 || !!sessionEventName));
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

function rankCornerMetrics(metrics, category) {
  return [...metrics].sort((a, b) => {
    const av = category === 'minimum' ? a.metric.minimumSpeed : a.metric.sectionTime;
    const bv = category === 'minimum' ? b.metric.minimumSpeed : b.metric.sectionTime;
    if (!Number.isFinite(av)) return Number.isFinite(bv) ? 1 : 0;
    if (!Number.isFinite(bv)) return -1;
    return category === 'minimum' ? bv - av : av - bv;
  });
}

function renderCornerAnalysis() {
  const section = $('#cornerAnalysis');
  const root = $('#cornerMetricGrid');
  const pickerRoot = $('#cornerPickerRow');
  if (!section || !root || !pickerRoot) return;
  const oldPicker = pickerRoot.querySelector?.('.corner-picker');
  const oldActive = oldPicker?.querySelector('.corner-pick.selected');
  const pickerState = oldPicker && oldActive ? {
    scroll: oldPicker.scrollLeft,
    left: `${oldActive.offsetLeft}px`, width: `${oldActive.offsetWidth}px`,
    focused: oldPicker.contains(document.activeElement),
  } : null;
  pickerRoot.innerHTML = '';
  const enabled = loaded.length > 0 || selected.length > 0 || !!sessionEventName;
  section.hidden = !enabled;
  if (!enabled) {
    root.innerHTML = '';
    return;
  }

  if (!loaded.length) {
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
    return `<button class="corner-pick ${index === selectedCornerIndex ? 'selected' : ''}" data-corner-index="${index}" aria-pressed="${index === selectedCornerIndex}" title="${cornerLabel(candidate)} · fastest ${winner?.lap.code || 'unavailable'}"><strong>${cornerLabel(candidate)}</strong><small>${winner?.lap.code || '—'}</small></button>`;
  }).join('');
  const rankedMetrics = rankCornerMetrics(metrics, cornerSort);
  const rows = rankedMetrics.map((item) => {
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
      <div class="corner-driver-row ${fastest && loaded.length > 1 ? 'is-fastest' : ''} ${highestMinimum && loaded.length > 1 ? 'is-highest-min' : ''}" style="--driver-color:${getLapColor(item.lap)}">
        <span class="corner-driver"><i></i><b>${item.lap.code}</b><small>L${item.lap.lap}</small>${item.lap === referenceLap ? '<em>REF</em>' : ''}</span>
        <span class="corner-time"><strong>${Number.isFinite(sectionTime) ? `${sectionTime.toFixed(3)}s` : '—'}</strong></span>
        <span class="corner-delta ${deltaClass}"><strong>${Number.isFinite(toReference) ? signedDelta(toReference) : '—'}</strong></span>
        <span class="corner-speed"><strong>${Number.isFinite(item.metric.minimumSpeed) ? item.metric.minimumSpeed.toFixed(1) : '—'}</strong></span>
      </div>`;
  }).join('');

  pickerRoot.innerHTML = `<nav class="corner-picker" aria-label="Select a corner">${picker}</nav>`;
  root.innerHTML = `
    <article class="corner-detail-card">
      <header class="corner-detail-header">
        <div><strong>${cornerLabel(zone)}</strong><small>${escapeUI(String(zone.type).toLowerCase())}${markers.some(marker => marker.approximate) ? ' · Approx. map position' : ''}</small></div>
        <dl><div><dt>Timing sector</dt><dd>${zone.metres} m</dd></div><div><dt>Min-speed window</dt><dd>${zone.apexMetres} m</dd></div></dl>
      </header>
      <div class="corner-table-head"><span>Driver</span>${[['time','Time','s'],['delta','Delta','s'],['minimum','Minimum','km/h']].map(([key,label,unit]) => `<button type="button" data-corner-sort="${key}" aria-pressed="${cornerSort === key}" title="Sort best to worst by ${label}">${label}${cornerSort === key ? ' ↓' : ''}<small>${unit}</small></button>`).join('')}</div>
      <div class="corner-driver-metrics">${rows}</div>
    </article>`;
  positionCornerIndicator(pickerRoot, pickerState);
  root.querySelectorAll('[data-corner-sort]').forEach(button => {
    button.onclick = () => { cornerSort = button.dataset.cornerSort; renderCornerAnalysis(); root.querySelector(`[data-corner-sort="${cornerSort}"]`)?.focus({ preventScroll: true }); };
  });
  if (pickerState?.focused) pickerRoot.querySelector('.corner-pick.selected')?.focus({ preventScroll: true });
  pickerRoot.onclick = event => {
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
        color: getLapColor(lap),
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

let sessionSectorGuide = null;
const GUIDE_SECTOR_COLORS = ['#ff4081', '#e6bc24', '#40a9ed'];

function makeSectorGuide(lap, samples, suppliedCorners) {
  const meta = lap.real || lap;
  const times = [meta.s1, meta.s2, meta.s3];
  const duration = lap.time ?? meta.time;
  if (!times.every(t => Number.isFinite(t) && t > 0) || !Number.isFinite(duration)
      || Math.abs(times.reduce((a,b)=>a+b,0)-duration) > .05) return null;
  const valid = samples.filter(p => [p.X,p.Y,p.ElapsedSeconds].every(v => v != null && Number.isFinite(v)));
  if (valid.length < 50 || valid.length < samples.length * .98
      || valid[0].ElapsedSeconds < 0 || valid[0].ElapsedSeconds > .5
      || Math.abs(valid.at(-1).ElapsedSeconds-duration) > .5) return null;
  // Never bridge missing packets or derive distances from fractions of lap time.
  for (let i=1;i<valid.length;i++) {
    const dt=valid[i].ElapsedSeconds-valid[i-1].ElapsedSeconds;
    if(dt <= 0 || dt > .75) return null;
  }
  const boundaries=[times[0],times[0]+times[1]];
  const points=valid.map(p=>({x:p.X,y:p.Y,t:p.ElapsedSeconds}));
  for(const t of boundaries) {
    const i=points.findIndex(p=>p.t>=t);
    if(i<1)return null;
    if(points[i].t===t)continue;
    const a=points[i-1],b=points[i],f=(t-a.t)/(b.t-a.t);
    points.splice(i,0,{x:a.x+(b.x-a.x)*f,y:a.y+(b.y-a.y)*f,t});
  }
  const distance=valid.at(-1).Distance;
  const markers=Number.isFinite(distance) && distance>0
    ? resolveCornerMarkers(valid,distance,suppliedCorners) : [];
  const mappedCorners=markers.map(c=>{
    const target=c.fraction*distance;
    const p=valid.reduce((best,p)=>Math.abs(p.Distance-target)<Math.abs(best.Distance-target)?p:best,valid[0]);
    return {...c,trackPosition:{x:p.X,y:p.Y}};
  });
  return {x:points.map(p=>p.x),y:points.map(p=>p.y),
    segmentSectors:points.slice(1).map((p,i)=>{
      const middle=(p.t+points[i].t)/2;
      return middle<boundaries[0]?0:middle<boundaries[1]?1:2;
    }),corners:mappedCorners};
}

function drawMadridGuide(ctx, points, rect) {
  // FIA sector anchors; the outline itself is approximate (see madrid-corners.md).
  const cumulative = [0];
  for (let i=1;i<points.length;i++) cumulative.push(cumulative[i-1]+Math.hypot(points[i].x-points[i-1].x,points[i].y-points[i-1].y));
  const factor = 5414/cumulative[cumulative.length-1];
  const offset = 1924-cumulative[37]*factor;
  const old16 = cumulative[85]*factor+offset;
  const geometry = points.map((point,i) => {
    let m = (cumulative[i]*factor+offset+5414)%5414;
    if(m>=1924 && m<=old16) m=1924+(m-1924)*(3928-1924)/(old16-1924);
    else if(m>old16) m=3928+(m-old16)*(5414-3928)/(5414-old16);
    return {...point,m};
  }).sort((a,b)=>a.m-b.m);
  const at = metres => {
    const m=(metres+5414)%5414;
    let i=geometry.findIndex(p=>p.m>=m);
    if(i<0)i=0;
    const b=geometry[i], a=geometry[(i+geometry.length-1)%geometry.length];
    const am=i===0?a.m-5414:a.m, bm=b.m;
    const target=i===0 && m>a.m?m-5414:m;
    const t=(target-am)/(bm-am||1);
    return {x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};
  };
  const palette=['#ff4081','#e6bc24','#40a9ed'];
  ctx.clearRect(0,0,rect.width,rect.height);
  [[0,1839],[1839,3888],[3888,5414]].forEach(([start,end],i)=>{
    ctx.beginPath();
    for(let m=start;m<=end+3;m+=3){const p=at(Math.min(m,end));if(m===start)ctx.moveTo(p.x,p.y);else ctx.lineTo(p.x,p.y);}
    ctx.strokeStyle=palette[i];ctx.lineWidth=5;ctx.stroke();
  });
  const annotations=[
    {m:0,label:'Timing line',color:'#aeb4c0'},
    {m:1839,label:'S1 / S2',color:palette[1]},
    {m:3888,label:'S2 / S3',color:palette[2]},
    ...MADRID_MAP_CORNERS.map(c=>({m:c.distance,label:cornerLabel(c),color:lightThemeActive()?'#242428':'#eeeeef',corner:true}))
  ];
  const occupied=[], leaders=[];
  ctx.font=canvasFont(12);ctx.textAlign='center';ctx.textBaseline='middle';
  annotations.forEach(item=>{
    const p=at(item.m), a=at(item.m-3), b=at(item.m+3);
    const length=Math.hypot(b.x-a.x,b.y-a.y)||1;
    if(!item.corner){
      const nx=-(b.y-a.y)/length*8,ny=(b.x-a.x)/length*8;
      ctx.beginPath();ctx.moveTo(p.x-nx,p.y-ny);ctx.lineTo(p.x+nx,p.y+ny);ctx.strokeStyle=item.color;ctx.lineWidth=2;ctx.stroke();
    }
    const width=ctx.measureText(item.label).width+6;
    let placement;
    for(const radius of [24,40,60,84,110,140,180]){
      for(let j=0;j<24;j++){
        const angle=-Math.PI/2+j*Math.PI/12;
        const x=Math.max(width/2+3,Math.min(rect.width-width/2-3,p.x+Math.cos(angle)*radius));
        const y=Math.max(11,Math.min(rect.height-11,p.y+Math.sin(angle)*radius));
        const box={x:x-width/2,y:y-8,width,height:16};
        if(trackIntersectsLabel(box,geometry,7)||occupied.some(b=>box.x<b.x+b.width+3&&box.x+width+3>b.x&&box.y<b.y+b.height+3&&box.y+16+3>b.y))continue;
        const connector=cornerLabelConnector(p,box,leaders,occupied);
        if(!connector)continue;
        placement={x,y,box,...connector};break;
      }
      if(placement)break;
    }
    if(!placement)return;
    occupied.push(placement.box);
    if(placement.line){
      leaders.push(placement.line);
      ctx.beginPath();ctx.moveTo(placement.line.a.x,placement.line.a.y);ctx.lineTo(placement.line.b.x,placement.line.b.y);ctx.strokeStyle=item.color;ctx.lineWidth=.7;ctx.globalAlpha=.4;ctx.stroke();ctx.globalAlpha=1;
    }
    ctx.fillStyle=item.color;ctx.fillText(item.label,placement.x,placement.y);
  });
  ctx.textAlign='start';ctx.textBaseline='alphabetic';
}

const CIRCUIT_API_KEYS = {'gb-1948':2,'hu-1986':4,'it-1953':6,'be-1925':7,'us-2012':9,'au-1953':10,'br-1940':14,'es-1991':15,'at-1969':19,'mc-1929':22,'ca-1978':23,'fr-1969':28,'de-1932':34,'it-1922':39,'jp-1962':46,'cn-2004':49,'nl-1948':55,'tr-2005':59,'sg-2008':61,'bh-2002':63,'mx-1962':65,'ae-2009':70,'de-1927':72,'ru-2014':79,'az-2016':144,'it-1914':146,'pt-2008':147,'sa-2021':149,'qa-2004':150,'us-2022':151,'us-2023':152};

function drawApiCircuitGuide(ctx, data, rect) {
  const raw = data.x.map((x,i)=>({x:Number(x),y:-Number(data.y[i])})).filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y));
  if(raw.length<3)return false;
  const minX=Math.min(...raw.map(p=>p.x)),maxX=Math.max(...raw.map(p=>p.x));
  const minY=Math.min(...raw.map(p=>p.y)),maxY=Math.max(...raw.map(p=>p.y));
  const scale=Math.min((rect.width-80)/(maxX-minX||1),(rect.height-60)/(maxY-minY||1));
  const project=p=>({x:(p.x-(minX+maxX)/2)*scale+rect.width/2,y:(p.y-(minY+maxY)/2)*scale+rect.height/2});
  const geometry=raw.map(project);
  ctx.clearRect(0,0,rect.width,rect.height);ctx.beginPath();
  geometry.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));
  ctx.strokeStyle=lightThemeActive()?'#666670':'#b3b3bd';ctx.lineWidth=5;ctx.stroke();
  if(data.segmentSectors?.length===geometry.length-1) {
    for(let i=1;i<geometry.length;i++) {
      ctx.beginPath();ctx.moveTo(geometry[i-1].x,geometry[i-1].y);ctx.lineTo(geometry[i].x,geometry[i].y);
      ctx.strokeStyle=GUIDE_SECTOR_COLORS[data.segmentSectors[i-1]];ctx.stroke();
    }
    ctx.strokeStyle=lightThemeActive()?'#666670':'#b3b3bd';
  }
  const occupied=[],leaders=[];ctx.font=canvasFont(12);ctx.textAlign='center';ctx.textBaseline='middle';
  for(const corner of data.corners || []){
    const position=corner.trackPosition;
    if(!position || !Number.isFinite(Number(position.x)) || !Number.isFinite(Number(position.y)))continue;
    const p=project({x:Number(position.x),y:-Number(position.y)}),label=cornerLabel(corner),width=ctx.measureText(label).width+8;
    let placement;
    for(const radius of [24,36,48,64,84,110,140]){
      for(let j=0;j<24;j++){
        const angle=-Math.PI/2+j*Math.PI/12;
        const x=Math.max(width/2+4,Math.min(rect.width-width/2-4,p.x+Math.cos(angle)*radius));
        const y=Math.max(12,Math.min(rect.height-12,p.y+Math.sin(angle)*radius));
        const box={x:x-width/2,y:y-9,width,height:18};
        if(trackIntersectsLabel(box,geometry)||occupied.some(b=>box.x<b.x+b.width+3&&box.x+width+3>b.x&&box.y<b.y+b.height+3&&box.y+18+3>b.y))continue;
        const connector=cornerLabelConnector(p,box,leaders,occupied);if(!connector)continue;
        placement={x,y,box,...connector};break;
      }
      if(placement)break;
    }
    if(!placement)continue;occupied.push(placement.box);
    if(placement.line){leaders.push(placement.line);ctx.beginPath();ctx.moveTo(placement.line.a.x,placement.line.a.y);ctx.lineTo(placement.line.b.x,placement.line.b.y);ctx.globalAlpha=.35;ctx.lineWidth=.7;ctx.stroke();ctx.globalAlpha=1;}
    ctx.fillStyle=lightThemeActive()?'#242428':'#eeeef0';ctx.fillText(label,placement.x,placement.y);
  }
  ctx.textAlign='start';ctx.textBaseline='alphabetic';return true;
}

function renderGenericCircuit(canvas, empty) {
  if (!sessionEventName) { empty.style.display = 'grid'; empty.textContent = 'Load a session to see its circuit guide.'; return; }
  if(sessionSectorGuide) {
    canvas.style.display='block';
    const rect=canvas.getBoundingClientRect();
    if(!rect.width || !rect.height)return;
    const ratio=Math.max(2,window.devicePixelRatio||1);
    canvas.width=Math.round(rect.width*ratio);canvas.height=Math.round(rect.height*ratio);
    const ctx=canvas.getContext('2d');ctx.setTransform(ratio,0,0,ratio,0,0);
    if(drawApiCircuitGuide(ctx,sessionSectorGuide,rect)) {
      empty.style.display='none';
      canvas.setAttribute('aria-label',`${sessionEventName}, timing-derived sector map: sector 1 pink, sector 2 yellow, sector 3 blue`);
      $('#dominanceLegend').innerHTML='<small><span style="color:#ff4081">S1</span> · <span style="color:#e6bc24">S2</span> · <span style="color:#40a9ed">S3</span> · Official sector times matched to position telemetry<br>Boundary placement is limited by position sampling accuracy.</small>';
      return;
    }
  }
  if (!genericCircuitData) {
    empty.style.display = 'grid';
    empty.textContent = 'Loading circuit map…';
    if (!genericCircuitRequest) genericCircuitRequest = fetch('assets/circuits/f1-circuits.geojson')
      .then(response => { if (!response.ok) throw new Error('Map unavailable'); return response.json(); })
      .then(data => { genericCircuitData = data; if (!loaded.length || mapView === 'guide') renderMiniSectorMap(); })
      .catch(() => { if (!loaded.length) empty.textContent = 'Circuit map unavailable.'; })
      .finally(() => { genericCircuitRequest = null; });
    return;
  }
  const name = normalizedPlaceName(sessionEventName);
  const aliases = [['emilia','it-1953'],['tuscan','it-1914'],['70th','gb-1948'],['eifel','de-1927'],['sakhir','bh-2002'],['styrian','at-1969'],['european','az-2016'],['australian','au-1953'],['bahrain','bh-2002'],['chinese','cn-2004'],['barcelona','es-1991'],['spanish', Number($('#year').value) >= 2026 ? 'es-2026' : 'es-1991'],['monaco','mc-1929'],['canadian','ca-1978'],['french','fr-1969'],['austrian','at-1969'],['british','gb-1948'],['german','de-1932'],['hungarian','hu-1986'],['belgian','be-1925'],['italian','it-1922'],['singapore','sg-2008'],['russian','ru-2014'],['japanese','jp-1962'],['miami','us-2022'],['las vegas','us-2023'],['united states','us-2012'],['mexic','mx-1962'],['sao paulo','br-1940'],['brazil','br-1940'],['abu dhabi','ae-2009'],['portuguese','pt-2008'],['malaysian','my-1999'],['turkish','tr-2005'],['dutch','nl-1948'],['saudi','sa-2021'],['qatar','qa-2004'],['azerbaijan','az-2016']];
  const id = aliases.find(([term]) => name.includes(term))?.[1];
  const circuitKey = name.includes('sakhir') && sessionYear === 2020 ? 148 : CIRCUIT_API_KEYS[id];
  const guideKey = `${circuitKey}:${sessionYear}`;
  if(circuitKey && !apiCircuitGuides.has(guideKey) && !apiCircuitGuideRequests.has(guideKey)) {
    apiCircuitGuideRequests.add(guideKey);
    fetch(`/api/circuit-guide?key=${circuitKey}&year=${sessionYear}`)
      .then(r=>{if(!r.ok)throw new Error('Circuit metadata unavailable');return r.json();})
      .then(data=>apiCircuitGuides.set(guideKey,data))
      .catch(()=>apiCircuitGuides.set(guideKey,null))
      .finally(()=>{apiCircuitGuideRequests.delete(guideKey);if(mapView==='guide')renderMiniSectorMap();});
  }
  const feature = genericCircuitData.features.find(item => item.properties.id === id);
  const coords = feature?.geometry?.type === 'LineString' ? feature.geometry.coordinates : null;
  if (!coords?.length) { empty.style.display = 'grid'; empty.textContent = 'Circuit outline unavailable for this event.'; return; }
  canvas.style.display = 'block';
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const ratio = Math.max(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(rect.width * ratio); canvas.height = Math.round(rect.height * ratio);
  const ctx = canvas.getContext('2d'); ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  const latitude = coords[0][1] * Math.PI / 180;
  const points = coords.map(([x,y]) => [x * Math.cos(latitude), -y]);
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  const minX = Math.min(...xs), minY = Math.min(...ys), width = Math.max(...xs)-minX, height = Math.max(...ys)-minY;
  const scale = Math.min((rect.width-40)/width, (rect.height-40)/height);
  ctx.beginPath();
  points.forEach(([x,y], index) => { const px=(x-minX-width/2)*scale+rect.width/2, py=(y-minY-height/2)*scale+rect.height/2; if(index)ctx.lineTo(px,py);else ctx.moveTo(px,py); });
  ctx.strokeStyle = lightThemeActive() ? '#65656e' : '#b3b3bd'; ctx.lineWidth=4; ctx.lineJoin='round'; ctx.lineCap='round'; ctx.stroke();
  canvas.setAttribute('aria-label', `${feature.properties.Name}, generic circuit outline`);
  empty.style.display='none';
  $('#dominanceLegend').innerHTML = '<small>Outline · <a href="https://github.com/bacinger/f1-circuits" target="_blank" rel="noopener">Circuit data</a></small>';
  if (id === 'es-2026' && sessionYear === 2026) {
    drawMadridGuide(ctx, points.map(([x,y]) => ({x:(x-minX-width/2)*scale+rect.width/2, y:(y-minY-height/2)*scale+rect.height/2})), rect);
    $('#dominanceLegend').innerHTML = '<small><span style="color:#ff4081">S1</span> · <span style="color:#e6bc24">S2</span> · <span style="color:#40a9ed">S3</span> · <a href="https://www.fia.com/system/files/decision-document/2026_spanish_grand_prix_-_competition_notes_-_circuit_map_pit_lane_drawing_and_emergency_exits_map.pdf" target="_blank" rel="noopener">FIA sector lengths</a><br>Approximate placement on the circuit outline.</small>';
  } else {
    const guide=apiCircuitGuides.get(guideKey);
    if(guide && Array.isArray(guide.x) && Array.isArray(guide.y) && drawApiCircuitGuide(ctx,guide,rect)) {
      $('#dominanceLegend').innerHTML = `<small><a href="https://multiviewer.app" target="_blank" rel="noopener">MultiViewer circuit data</a> · ${escapeUI(guide.name)} · ${guide.sourceYear}${guide.sourceYear!==sessionYear?' layout (older than selected season)':''}<br>Sector colours require a loaded lap with complete timing and position data.</small>`;
    } else {
      $('#dominanceLegend').innerHTML += `<small>${apiCircuitGuideRequests.has(guideKey)?'Loading circuit annotations…':'Circuit annotations unavailable from the provider.'}</small>`;
    }
  }
}

function renderMiniSectorMap() {
  const canvas = $('#dominanceCanvas');
  const empty = $('#dominanceEmpty');
  const legend = $('#dominanceLegend');
  const title = $('#dominanceTitle');
  if (!canvas || !empty || !legend || !title) return;
  if (!loaded.length) mapView = 'guide';
  document.querySelectorAll('[data-map-view]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.mapView === mapView));
    button.disabled = button.dataset.mapView === 'comparison' && !loaded.length;
  });
  if (mapView === 'guide' || !loaded.length) {
    title.textContent = 'Circuit guide';
    dominanceMapHitPoints = [];
    clearDominanceMapCanvas(canvas);
    renderGenericCircuit(canvas, empty);
    return;
  }

  const mapEntries = visibleTraceLaps().filter(({lap})=>telemetryCache.get(telemetryKey(lap))?.length);
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
    if (selected.length) renderGenericCircuit(canvas, empty);
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
    empty.style.display = 'none';
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
  if (dominanceMapGeometryCache?.key === geometryKey && dominanceMapGeometryCache.reference === reference) {
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
    dominanceMapGeometryCache = { key: geometryKey, reference, geometrySteps, canvasGeometry };
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

  // Mark section boundaries without obscuring the track's dominance colours.
  let highlightedCornerZone = null;
  if (typeof adaptiveCornerZones === 'function') {
    const markerCorners = resolveCornerMarkers(reference, totalDistance, loaded[0]?.cornerMarkers);
    const zones = adaptiveCornerZones(markerCorners);
    const selectedZone = zones[Math.max(0, Math.min(selectedCornerIndex, zones.length - 1))];
    if (selectedZone) {
      highlightedCornerZone = selectedZone;
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
      mapView = 'comparison';
      if (winner < 0) continue;
      wins.add(winner);
      ctx.strokeStyle = getLapColor(mapEntries[winner].lap);
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
    ctx.save();
    for (const fraction of [highlightedCornerZone.start, highlightedCornerZone.end]) {
      const center = pointAt(fraction);
      const before = pointAt(Math.max(0, fraction - 5 / totalDistance));
      const after = pointAt(Math.min(1, fraction + 5 / totalDistance));
      if (!center || !before || !after) continue;
      const dx = after.x - before.x, dy = after.y - before.y;
      const length = Math.hypot(dx, dy);
      if (length < .001) continue;
      const nx = -dy / length * 8, ny = dx / length * 8;
      ctx.beginPath();
      ctx.moveTo(center.x - nx, center.y - ny);
      ctx.lineTo(center.x + nx, center.y + ny);
      ctx.strokeStyle = document.documentElement.dataset.theme === 'light' ? '#1d1d1f' : '#f5f5f7';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.restore();
  }

  // Corner markers rendered ON TOP of mini-sector dominance lines
  if ($('#cornerToggle').checked) {
    const markerCorners = resolveCornerMarkers(reference, totalDistance, loaded[0]?.cornerMarkers);
    ctx.font = canvasFont(12);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const occupiedLabels = [];
    const leaders = [];
    markerCorners.forEach(corner => {
      const point = pointAt(corner.fraction);
      if (!point) return;
      const angle = Number(corner.angle);
      const displayAngle = Number.isFinite(angle) ? angle : NaN;
      const offsetX = Number.isFinite(displayAngle) ? Math.cos(displayAngle * Math.PI / 180) * 11 : 0;
      const offsetY = Number.isFinite(displayAngle) ? -Math.sin(displayAngle * Math.PI / 180) * 11 : -11;
      const label = cornerLabel(corner);
      const labelWidth = ctx.measureText(label).width + 8;
      let placement = null;
      // Search nearby positions, reserving the complete text box. Leader
      // lines preserve the turn location when a crowded label must move.
      for (const radius of [24, 36, 48, 64, 80, 100, 124, 152]) {
        for (let direction = 0; direction < 16; direction++) {
          const theta = Math.atan2(offsetY, offsetX) + direction * Math.PI / 8;
          const x = Math.max(labelWidth / 2 + 4, Math.min(rect.width - labelWidth / 2 - 4, point.x + Math.cos(theta) * radius));
          const y = Math.max(12, Math.min(rect.height - 12, point.y + Math.sin(theta) * radius));
          const box = {x: x - labelWidth / 2, y: y - 9, width: labelWidth, height: 18};
          if (trackIntersectsLabel(box, canvasGeometry)) continue;
          if (occupiedLabels.some(b => box.x < b.x + b.width + 3 && box.x + box.width + 3 > b.x && box.y < b.y + b.height + 3 && box.y + box.height + 3 > b.y)) continue;
          const connector = cornerLabelConnector(point, box, leaders, occupiedLabels);
          if (!connector) continue;
          placement = {x, y, box, ...connector};
          break;
        }
        if (placement) break;
      }
      if (!placement) return; // Never render overlapping text on tiny maps.
      occupiedLabels.push(placement.box);
      if (placement.line) {
      leaders.push(placement.line);
      ctx.beginPath();
      ctx.moveTo(placement.line.a.x, placement.line.a.y);
      ctx.lineTo(placement.line.b.x, placement.line.b.y);
      ctx.strokeStyle = theme.labelFill;
      ctx.globalAlpha = .35;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.globalAlpha = 1;
      }
      ctx.lineWidth = 3;
      ctx.strokeStyle = theme.labelStroke;
      ctx.strokeText(label, placement.x, placement.y);
      ctx.fillStyle = theme.labelFill;
      ctx.fillText(label, placement.x, placement.y);
    });
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
  }

  // Ball Tracker indicator when hovering (telemetry charts or track map)
  if (hoverFraction !== null) {
    const hPoint = pointAt(hoverFraction);
    if (hPoint) {
      const refColor = getLapColor(mapEntries[0].lap);
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
  const referenceConditions = loaded[0]?.real?.conditions || {};
  const windDegrees = referenceConditions.wind_direction == null ? NaN : Number(referenceConditions.wind_direction);
  const windSpeed = referenceConditions.wind_speed == null ? NaN : Number(referenceConditions.wind_speed);
  let windText = '';
  if (Number.isFinite(windDegrees)) {
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const windLabel = directions[Math.round((((windDegrees % 360) + 360) % 360) / 45) % directions.length];
    windText = `<span class="map-wind">Wind from ${windLabel}${Number.isFinite(windSpeed) ? ` · ${windSpeed.toFixed(1)} m/s` : ''}</span>`;
  }

  empty.style.display = 'none';
  const legendIndexes = comparative ? [...wins] : [0];
  legend.innerHTML = `<span class="map-north" aria-label="North is up"><svg viewBox="0 0 16 20" width="12" height="16" aria-hidden="true"><path d="M8 1 14 18 8 14 2 18Z" fill="currentColor"/></svg>N</span>${windText}` + legendIndexes.map(index => {
    const lap = mapEntries[index]?.lap;
    if (!lap) return '';
    return `<span class="legend-item"><i class="legend-color" style="--team:${getLapColor(lap)}"></i>${lap.code} L${lap.lap}</span>`;
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
  else if (selected.length) renderMiniSectorMap();
}

// Initial Setup on Document Load
document.addEventListener('DOMContentLoaded', () => {
  installGlassMotion();
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
  $('#session').addEventListener('change', prepareSelectedSession);
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
      $('#cornerWorkspace').inert = collapsed;
      cornerAnalysisToggle.setAttribute('aria-expanded', String(!collapsed));
      const label = cornerAnalysisToggle.querySelector('span');
      if (label) label.textContent = collapsed ? 'Expand' : 'Collapse';
    });
    cornerAnalysis.addEventListener('transitionend', event => {
      if (event.propertyName === 'grid-template-rows' && !cornerAnalysis.classList.contains('is-collapsed')) renderMiniSectorMap();
    });
  }
  
  const toggleBtn = $('#sidebarToggle');
  const mainEl = $('main');
  if (toggleBtn && mainEl) {
    toggleBtn.onclick = () => {
      const isCollapsed = mainEl.classList.toggle('sidebar-collapsed');
      toggleBtn.querySelector('span').textContent = isCollapsed ? 'Show drivers' : 'Hide drivers';
      toggleBtn.setAttribute('aria-expanded', String(!isCollapsed));
      $('#driverSidebar').inert = isCollapsed;
      if (loaded.length) scheduleDrawAll();
    };
    mainEl.addEventListener('transitionend', event => {
      if (event.target === mainEl && event.propertyName === 'grid-template-columns') scheduleDrawAll();
    });
  }
  
  window.addEventListener('resize', scheduleDrawAll, { passive: true });
  if (typeof ResizeObserver !== 'undefined') {
    let mapSize = '';
    new ResizeObserver(entries => {
      const rect = entries[0]?.contentRect;
      const size = rect ? `${Math.round(rect.width)}:${Math.round(rect.height)}` : '';
      if (rect?.width && rect?.height && size !== mapSize) {
        mapSize = size;
        requestAnimationFrame(() => { if (loaded.length || selected.length) renderMiniSectorMap(); });
      }
    }).observe($('#dominanceCanvas'));
  }
  
  clearBeforeSessionLoad();
  renderCharts();
  bindTrackMapHover();
  document.querySelectorAll('[data-map-view]').forEach(button => button.addEventListener('click', () => {
    mapView = button.dataset.mapView;
    $('#realTooltip').style.display = 'none';
    renderMiniSectorMap();
  }));
  
  loadCalendar()
    .catch(error => {
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
    const isC = /^C[0-6]$/i.test(comp);
    const label = isC ? (labels[i] || 'Nominated') : comp;
    const displayVal = isC ? comp : getCompoundAbbreviation(comp);
    const color = colors[i] || '#888888';
    
    return `
      <div class="tire-option tire-${String(label).toLowerCase()}" style="--tire-color:${color}">
        ${tyreImageMarkup(label)}
        <span class="tire-copy"><strong>${escapeUI(label)}${isC ? ` · ${escapeUI(displayVal)}` : ''}</strong>${isC ? '' : `<small>${escapeUI(displayVal)}</small>`}</span>
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
