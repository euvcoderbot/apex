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
const cornerPickerMarkup = new WeakMap();
let calendar = [];
let corners = [];
let genericCircuitData = null;
let genericCircuitRequest = null;
let sessionEventName = '';
let sessionYear = null;
let sessionCircuitKey = null;
let sessionLocation = '';
let loadedSessionName = '';
let raceResultView = 'points';
let openf1SessionKey = null;
let nominatedCompounds = [];
let selectedCornerIndices = new Set();
let automaticStraightIndices = new Set();
let cornerSort = 'time';
let showCornerNumbers = window.ApexAnalysis?.preference('corner-numbers',false)===true;
let showSpeedAnnotations = window.ApexAnalysis?.preference('speed-annotations',false)===true;
let speedAnnotationCache = null;
const traceTintEnabled = false;
const hiddenTraceKeys = new Set();
let dominanceMapHitPoints = [];
let dominanceMapGeometryCache = null;
let mapView = 'guide';
const apiCircuitGuides = new Map();
const apiCircuitGuideRequests = new Set();

let hoverFraction = null;
let hoveredChartName = null;
let traceZoom = { start: 0, end: 1 };
let timingDeltaZoom = 1;
let zoomDrag = null;
let drawGeneration = 0;
let sessionRequest = null;
let raceResultRefreshTimer = null;
let raceResultRefreshAttempts = 0;
let calendarRequest = null;
let calendarGeneration = 0;
let redrawFrame = 0;
let hoverFrame = 0;
const chartStaticLayers = new WeakMap();
let mapStaticLayer = null;
let toastTimer = 0;
const MIN_TRACE_ZOOM = .004;
const MIN_TIMING_DELTA_ZOOM = .25;
const MAX_TIMING_DELTA_ZOOM = 4;
const TIMING_DELTA_ZOOM_STEP = .25;
const CLIENT_DATA_SCHEMA = 'direct-telemetry-v5';
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
    // Rects include the page zoom; transforms are applied in layout px.
    const page = document.documentElement;
    const pageZoom = page?.offsetWidth ? page.getBoundingClientRect().width / page.offsetWidth || 1 : 1;
    const dx = old ? (old.rect.left - next.left) / pageZoom : 0;
    const dy = old ? (old.rect.top - next.top) / pageZoom : 6;
    if (!old || Math.abs(dx) + Math.abs(dy) > 1) {
      node.animate([{ opacity: old ? 1 : 0, transform: `translate(${dx}px, ${dy}px)` },
        { opacity: 1, transform: 'none' }], { duration: 280, easing: 'cubic-bezier(.22,.68,0,1)' });
    }
  }
}

function canvasFont(size = 12, weight = 400) {
  // Canvas labels use the same font as the surrounding interface.
  const family = typeof getComputedStyle === 'function' ? getComputedStyle(document.body).fontFamily : '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro", Inter, "Segoe UI", system-ui, sans-serif';
  return `${weight} ${size + 1}px ${family}`;
}

function updateCornerPicker(root, markup, selection, automatic) {
  // Keep the actual buttons in place for selection-only updates. Replacing a
  // focused, wrapped picker made focus and browser scroll anchoring jump.
  if (cornerPickerMarkup.get(root) !== markup) {
    const focusedIndex = root.contains(document.activeElement)
      ? document.activeElement?.dataset?.cornerIndex : null;
    root.innerHTML = markup;
    cornerPickerMarkup.set(root, markup);
    if (focusedIndex != null) root.querySelector(`[data-corner-index="${focusedIndex}"]`)?.focus({preventScroll:true});
  }
  for (const button of root.querySelectorAll('[data-corner-index]')) {
    const index = Number(button.dataset.cornerIndex), pressed = selection.has(index);
    button.classList.toggle('selected', pressed);
    button.setAttribute('aria-pressed', String(pressed));
    button.title = button.title.replace(/ · automatically included link$/, '')
      + (automatic.has(index) ? ' · automatically included link' : '');
  }
}

function apiUrl(path) {
  return `${API_ORIGIN}${path}`;
}

function sharedDataURL(url) {
  const parsed=new URL(url,window.location?.href||'http://localhost');
  if(parsed.origin!==new URL(API_ORIGIN||window.location?.href||'http://localhost').origin)return url;
  if(!['/api/events','/api/session','/api/telemetry','/api/performance','/api/performance/trace-batch','/api/performance/pits'].includes(parsed.pathname))return url;
  const fresh=parsed.searchParams.get('fresh')==='true';parsed.searchParams.delete('fresh');
  return '/api/data?'+new URLSearchParams({path:parsed.pathname+'?'+parsed.searchParams,...(fresh?{refresh:'1'}:{})});
}

// A 5xx whose body is not JSON comes from the hosting platform, not our API
// (which always answers JSON): typically its request time limit while the
// data Worker is still computing a cold session. The Worker keeps going and
// caches the result, so waiting and asking again usually succeeds.
function platformErrorResponse(response) {
  return response.status >= 500 && !/json/i.test(response.headers?.get?.('content-type') || '');
}
const PLATFORM_RETRY_DELAYS_MS = [5000, 15000];

async function fetchSessionData(url, options = {}) {
  const attempts = window.APEX_LOCAL_MODE ? 2 : 1 + PLATFORM_RETRY_DELAYS_MS.length;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const controller = new AbortController();
    const abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(abort, window.APEX_LOCAL_MODE?180000:/\/api\/(performance|race-corners|qualifying-corners)/.test(url)?60000:30000);
    try {
      const shared=sharedDataURL(url),longQuery=shared.startsWith('/api/data?')&&shared.length>12000;
      const query=longQuery?new URLSearchParams(shared.slice(shared.indexOf('?')+1)):null;
      const response = await fetch(longQuery?'/api/data':shared, { ...options, signal: controller.signal,
        ...(longQuery?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:query.get('path'),refresh:query.get('refresh')==='1'})}:{}) });
      const retryable = [408, 429, 502, 503, 504].includes(response.status) || platformErrorResponse(response);
      if (!retryable || attempt === attempts - 1) return response;
      await response.text();
    } catch (error) {
      if (options.signal?.aborted) throw error;
      if (attempt === attempts - 1) throw new Error(error.name === 'AbortError' ? 'The server took too long. Please retry.' : error.message);
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', abort);
    }
    const delay = window.APEX_LOCAL_MODE ? 700 * (attempt + 1) : PLATFORM_RETRY_DELAYS_MS[attempt];
    await new Promise((resolve, reject) => {
      const stop = () => { clearTimeout(timer); reject(options.signal.reason || new DOMException('Aborted', 'AbortError')); };
      const timer = setTimeout(() => { options.signal?.removeEventListener('abort', stop); resolve(); }, delay);
      options.signal?.addEventListener('abort', stop, { once: true });
    });
  }
}

const recentData = new Map();
const pendingApiData = new Map();
let preparedSessionIndex;
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
    // The current calendar carries live OpenF1 completion/cancellation state.
    // Do not let a build-time snapshot hide a red flag, restart or correction.
    if (year === new Date().getFullYear()) return null;
    const response = await fetch(`assets/data/events/${year}.json`);
    if (!response.ok) return null;
    return response.json();
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
  const parsed = new URL(url, window.location?.href || 'http://localhost');
  const refreshing=parsed.searchParams.get('fresh')==='true'||parsed.searchParams.get('refresh')==='1';
  const identity=new URL(parsed);identity.searchParams.delete('fresh');identity.searchParams.delete('refresh');identity.searchParams.sort();
  const family=/^\/api\/(events|session|telemetry)$/.test(parsed.pathname)?window.APEX_SOURCE_VERSION:/^\/api\/(race|qualifying)-corners$/.test(parsed.pathname)?window.APEX_MEASUREMENT_VERSION:window.APEX_BACKEND_VERSION;
  const cacheKey='source-'+(family||window.APEX_DATA_VERSION||'20261007-load-v1')+':'+identity.href;
  const liveCalendar = parsed.pathname === '/api/events'
    && Number(parsed.searchParams.get('year')) >= new Date().getFullYear();
  const cached = liveCalendar||refreshing ? null : await storedData(cacheKey);
  if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  if (cached) return cached; // loadApiData clones once per consumer.
  const prepared = refreshing?null:await preparedData(url).catch(() => null);
  if (prepared) { void cacheData(cacheKey, structuredClone(prepared), 120000); return prepared; }
  const response = await fetchSessionData(url, options);
  const data = await readApiResponse(response);
  if (!response.ok) throw new Error(data.detail || `Data unavailable (${response.status})`);
  if (!liveCalendar && !/no-store/i.test(response.headers.get('cache-control') || '') && data.position_complete !== false) {
    const year = Number(new URL(url, window.location?.href || 'http://localhost').searchParams.get('year'));
    const historical = year > 0 && year < new Date().getFullYear();
    const suppliedTTL=Number(response.headers.get('x-data-ttl'));
    const ttl=Number.isFinite(suppliedTTL)&&suppliedTTL>0?Math.min(suppliedTTL,30*86400)*1000:historical?30*86400000:120000;
    void cacheData(cacheKey, structuredClone(data), ttl);
  }
  return data;
}
async function loadApiData(url, options = {}) {
  if (!pendingApiData.has(url)) {
    const pending = requestApiData(url).finally(() => pendingApiData.delete(url));
    pendingApiData.set(url, pending);
  }
  const pending=pendingApiData.get(url);
  const data = options.signal?await new Promise((resolve,reject)=>{
    const abort=()=>reject(new DOMException('Aborted','AbortError'));
    options.signal.addEventListener('abort',abort,{once:true});
    if(options.signal.aborted)abort();
    pending.then(resolve,reject).finally(()=>options.signal.removeEventListener('abort',abort));
  }):await pending;
  if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  return structuredClone(data);
}
window.apexDataRequest=(path,signal)=>loadApiData(apiUrl(path),{signal});
window.apexMeasurementRequest=(path,signal)=>loadApiData(new URL(path,window.location.href).href,{signal});

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
    // Never show a raw HTML error page as the message.
    const error = platformErrorResponse(response)
      ? new Error(`The hosted server stopped before this session finished computing (HTTP ${response.status}). It usually finishes in the background: retry in a minute.`)
      : new Error(`Server returned ${response.status}: ${/^\s*</.test(body) ? 'an HTML error page' : body.replace(/\s+/g, ' ').trim().slice(0, 140) || 'empty response'}`);
    error.status = response.status;
    throw error;
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
  // Official 2026 marks (96 px): colour plus the white version; the stylesheet
  // shows white only where a colour mark is too dark for the dark appearance.
  const base = asset.replace(/\.webp$/, '');
  return `<span class="team-logo team-logo-official" data-team-mark="${base}" aria-hidden="true"><img class="team-logo-color" src="assets/teams/official/${base}-color.webp" alt="" width="26" height="26"><img class="team-logo-mono" src="assets/teams/official/${asset}" alt="" width="26" height="26"></span>`;
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
  if (select.disabled || select.options[optionIndex].disabled) return;
  customSelectValues.set(select, select.options[optionIndex].value);
  select.selectedIndex = optionIndex;
  closeSelectMenu(shell);
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
    <button type="button" role="option" tabindex="-1" aria-selected="${option === selectedOption}" ${option.disabled ? 'disabled aria-disabled="true"' : ''} data-select-index="${optionIndex}" data-select-value="${encodeURIComponent(option.value)}" onclick="selectCustomOption(this)">
      ${selectOptionContent(option)}
    </button>`).join('');
}

function closeSelectMenu(shell) {
  const menu = shell?.querySelector('.select-menu');
  if (typeof menu?.hidePopover === 'function' && menu.matches(':popover-open')) menu.hidePopover();
  shell?.classList.remove('is-open');
  shell?.querySelector('.select-trigger')?.setAttribute('aria-expanded', 'false');
}

function positionSelectMenu(shell) {
  const menu = shell.querySelector('.select-menu'), trigger = shell.querySelector('.select-trigger');
  if (!menu?.hasAttribute('popover')) return;
  const anchor = trigger.getBoundingClientRect(), gutter = 8;
  if (anchor.bottom < gutter || anchor.top > innerHeight - gutter) { closeSelectMenu(shell); return; }
  // Measurements include the page zoom; inline styles are applied in layout px.
  const page = document.documentElement;
  const zoom = page?.offsetWidth ? page.getBoundingClientRect().width / page.offsetWidth || 1 : 1;
  menu.style.minWidth = Math.min(anchor.width, innerWidth - gutter * 2) / zoom + 'px';
  menu.style.maxHeight = Math.max(80, innerHeight - gutter * 2) / zoom + 'px';
  const box = menu.getBoundingClientRect(), width = box.width, height = box.height;
  const below = innerHeight - anchor.bottom - gutter - 4;
  const top = height <= below ? anchor.bottom + 4 : height + gutter + 4 <= anchor.top ? anchor.top - height - 4 : Math.max(gutter, innerHeight - height - gutter);
  menu.style.left = Math.max(gutter, Math.min(anchor.left, innerWidth - width - gutter)) / zoom + 'px';
  menu.style.top = top / zoom + 'px';
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
  // The top layer lets all four rounded corners escape the sidebar's clipping.
  if (typeof menu.showPopover === 'function') menu.setAttribute('popover', 'manual');
  const label = document.querySelector(`label[for="${select.id}"]`);
  if (label) {
    label.id = `${select.id}Label`;
    trigger.setAttribute('aria-labelledby', label.id);
    menu.setAttribute('aria-labelledby', label.id);
  }
  menu.id = `${select.id}Options`;
  trigger.setAttribute('aria-controls', menu.id);
  const close = () => closeSelectMenu(shell);
  trigger.addEventListener('click', event => {
    event.stopPropagation();
    document.querySelectorAll('.select-shell.is-open').forEach(openShell => {
      if (openShell !== shell) {
        closeSelectMenu(openShell);
      }
    });
    const open = shell.classList.toggle('is-open');
    trigger.setAttribute('aria-expanded', String(open));
    if (open) {
      if (typeof menu.showPopover === 'function') menu.showPopover();
      positionSelectMenu(shell);
      const selected = menu.querySelector('[aria-selected="true"]');
      selected?.focus({ preventScroll: true });
      if (selected) menu.scrollTop = selected.offsetTop - (menu.clientHeight - selected.offsetHeight) / 2;
    } else close();
  });
  let searchPrefix = '', lastSearchAt = 0;
  menu.addEventListener('keydown', event => {
    const items = [...menu.querySelectorAll('[data-select-value]:not(:disabled)')];
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
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && event.key !== ' ') {
      event.preventDefault();
      const now = Date.now();
      searchPrefix = now - lastSearchAt < 700 ? searchPrefix + event.key : event.key;
      lastSearchAt = now;
      const labels = items.map(item => item.textContent.trim().toLocaleLowerCase());
      // Search in display order after the focused option, cycling repeated keys.
      const order = items.map((_, offset) => (index + 1 + offset) % items.length);
      let match = order.find(i => labels[i].startsWith(searchPrefix.toLocaleLowerCase()));
      if (match === undefined && searchPrefix.length > 1) {
        searchPrefix = event.key;
        match = order.find(i => labels[i].startsWith(searchPrefix.toLocaleLowerCase()));
      }
      if (match !== undefined) items[match].focus();
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

window.enhanceSelect = enhanceSelect;
window.syncSelectUI = syncSelectUI;
window.selectCustomOption = selectCustomOption;

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
    const payload = await loadApiData(apiUrl(`/api/events?year=${year}&status=result-v3`), { signal: calendarRequest.signal });
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
      const status = String(event.session_statuses?.[session] || '').toLowerCase();
      if (['cancelled', 'live', 'upcoming', 'interrupted', 'aborted', 'suspended'].includes(status)) return;
      const timestamp = parsedSessionTimestamp(
        event.session_end_dates?.[session] || event.session_dates?.[session]
      );
      // A missing finish flag can leave a published weekend marked unknown.
      // After 36 hours, it is safe to offer the session as the default; this
      // only changes the selection and never fetches its data automatically.
      if (status === 'unknown' && timestamp > now - 36 * 3600000) return;
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
    return Number.isFinite(eventDate) && eventDate <= now
      && !Object.keys(event.session_dates || {}).length
      && !Object.keys(event.session_end_dates || {}).length;
  });
  const event = completedEvents.at(-1) || events?.find(candidate =>
    candidate.sessions?.some(session => !['cancelled', 'interrupted', 'aborted', 'suspended'].includes(
      String(candidate.session_statuses?.[session] || '').toLowerCase()
    ))) || events?.[0] || null;
  const sessions = (event?.sessions || []).filter(session =>
    !['cancelled', 'interrupted', 'aborted', 'suspended'].includes(
      String(event.session_statuses?.[session] || '').toLowerCase()
    ));
  return event ? {
    event,
    session: completedEvents.length ? sessions.at(-1) : sessions[0],
    timestamp: NaN,
  } : null;
}

function verifiedTireNominations(year, eventName, reported) {
  if (year !== 2026) return reported;
  const name = String(eventName || '').toLowerCase();
  // Pirelli's confirmed 2026 allocations override older venue heuristics in
  // the separately deployed telemetry API.
  if (['barcelona', 'catalunya', 'dutch', 'netherlands', 'zandvoort',
    'spanish', 'madrid', 'bahrain', 'sepang'].some(venue => name.includes(venue))) {
    return ['C2', 'C3', 'C4'];
  }
  return reported;
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

// UI State Resets
function clearBeforeSessionLoad() {
  clearTimeout(raceResultRefreshTimer);
  raceResultRefreshAttempts=0;
  drawGeneration++;
  drivers.splice(0, drivers.length);
  realDrivers.clear();
  selected = [];
  loaded = [];
  openStint = {};
  corners = [];
  sessionEventName = '';
  sessionYear = null;
  sessionCircuitKey = null;
  sessionLocation = '';
  openf1SessionKey = null;
  nominatedCompounds = [];
  selectedCornerIndices = new Set();
  automaticStraightIndices = new Set();
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
  
  const tireCard = $('#tireCard');
  if (tireCard) tireCard.style.display = 'none';
  updateTelemetryVisibility();
}

// Main Session API Loader
async function loadRealSession() {
  const button = $('#loadSession');
  if(button.classList.contains('is-loading')) {
    sessionRequest?.abort();button.disabled=true;button.textContent='Stopping…';return;
  }
  button.disabled = false;
  button.classList.add('is-loading');
  button.setAttribute('aria-busy', 'true');
  // Keep the progress label compact enough for split-screen and mobile cards.
  // The full action remains available to assistive technology.
  button.textContent = 'Stop loading';
  button.setAttribute('aria-label', 'Stop loading session');
  setSessionLoading(true);
  if (sessionRequest) sessionRequest.abort();
  sessionRequest = new AbortController();
  const request = sessionRequest;
  const requestedQuery = String(currentQuery());
  
  try {
    const payload = await loadApiData(apiUrl(`/api/session?${requestedQuery}`), {signal:request.signal});
    if (request !== sessionRequest || requestedQuery !== String(currentQuery())) return;
    if (!Array.isArray(payload.drivers) || !payload.drivers.length) throw new Error('No driver data is available for this session yet.');
    clearBeforeSessionLoad();
    renderCharts();
    
    realDrivers = new Map(payload.drivers.map(driver => [driver.code, driver]));
    drivers.splice(0, drivers.length, ...payload.drivers.map(driver => [
      driver.code, driver.number, driver.name, driver.team_color, driver.team, driver.position
    ]));
    corners = payload.corners || [];
    sessionEventName = payload.event || '';
    loadedSessionName = payload.session || '';
    sessionYear = Number(new URLSearchParams(requestedQuery).get('year'));
    sessionCircuitKey = Number.isInteger(payload.circuit_key) ? payload.circuit_key : null;
    sessionLocation = payload.location || '';
    openf1SessionKey = Number.isInteger(payload.openf1_session_key) ? payload.openf1_session_key : null;
    nominatedCompounds = verifiedTireNominations(sessionYear, sessionEventName, payload.compounds || []);
    
    renderDrivers();
    renderTireNomination();
    renderStints();
    renderAll();
    void refreshRaceResults(request,requestedQuery);
  } catch (error) {
    if (error.name !== 'AbortError') notify(`Could not load this session. ${error.message}`);
  } finally {
    if (request !== sessionRequest) return;
    setSessionLoading(false);
    button.disabled = false;
    button.classList.remove('is-loading');
    button.removeAttribute('aria-busy');
    button.removeAttribute('aria-label');
    button.textContent = 'Load session';
  }
}

function setSessionLoading(value) {
  const analysis=$('.analysis-column'),sidebar=$('#driverSidebar');
  if(analysis){analysis.inert=value;analysis.setAttribute('aria-busy',String(value));}
  if(sidebar)sidebar.inert=value||$('main')?.classList.contains('sidebar-collapsed');
}

function setLapSelectionExpanded(expanded, focus = false) {
  const body = $('#lapSelectionBody'), toggle = $('#lapWorkspaceToggle');
  if (!body || !toggle) return;
  body.hidden = !expanded;
  body.inert = !expanded;
  toggle.setAttribute('aria-expanded', String(expanded));
  toggle.querySelector('span').textContent = expanded ? 'Choose laps' : 'Edit laps';
  if (focus) toggle.focus({preventScroll: true});
}


// UI Rendering Functions
function mergeRaceClassification(classification) {
  for(const item of classification) {
    const driver=[...realDrivers.values()].find(d=>String(d.number)===String(item.driver_number));
    if(!driver)continue;
    const result={...driver.result};
    if(typeof item.points==='number' && Number.isFinite(item.points))result.points=item.points;
    if(item.gap_to_leader!=null && !Array.isArray(item.gap_to_leader))result.gap=item.gap_to_leader;
    if(item.dsq)result.status='DSQ';else if(item.dns)result.status='DNS';else if(item.dnf)result.status='DNF';
    else if(item.position>0 && !/^\+\d+ laps?$/i.test(result.status||''))result.status='Finished';
    driver.result=result;
    if(item.position>0){driver.position=item.position;const row=drivers.find(d=>d[0]===driver.code);if(row)row[5]=item.position;}
  }
}

async function refreshRaceResults(request,query) {
  if(request!==sessionRequest || !/^(Race|Sprint)$/i.test(loadedSessionName) || !openf1SessionKey)return;
  const key=openf1SessionKey;
  let classificationSeen=false;
  try {
    const response=await fetchSessionData(`https://api.openf1.org/v1/session_result?session_key=${key}`,{cache:'no-store',signal:request.signal});
    if(!response.ok)throw new Error('Classification not available yet');
    const rows=await response.json();
    if(request!==sessionRequest || query!==String(currentQuery()))return;
    if(Array.isArray(rows)){classificationSeen=rows.some(r=>r.position>0);mergeRaceClassification(rows);renderDrivers();}
  } catch(error) { if(error.name==='AbortError')return; }
  const pending=[...realDrivers.values()].some(d=>!Number.isFinite(d.result?.points)||d.result?.gap==null && !/DNF|DNS|DSQ/i.test(d.result?.status||''));
  if((pending||!classificationSeen&&sessionYear===new Date().getFullYear()) && raceResultRefreshAttempts++<10 && request===sessionRequest)
    raceResultRefreshTimer=setTimeout(()=>refreshRaceResults(request,query),60000);
}

function raceResultMarkup(driver) {
  const result = driver?.result || {};
  const status = String(result.status || '').trim();
  const retired = status && !/^(finished|\+\d+ laps?)$/i.test(status);
  const badge = /^(dns|did not start|withdrawn|did not qualify|did not prequalify)$/i.test(status) ? 'DNS'
    : /disqualified|dsq/i.test(status) ? 'DSQ' : retired ? 'DNF' : '';
  let value = '—';
  if (raceResultView === 'points') {
    if (Number.isFinite(result.points)) value = `${result.points} pts`;
  } else if (badge) value = badge;
  else if (/^\+\d+ laps?$/i.test(status)) value = status.toLowerCase();
  else if (typeof result.gap === 'string' && /^\+?\d+\s*laps?$/i.test(result.gap.trim())) value = result.gap.toLowerCase();
  else if (Number.isFinite(result.gap)) value = result.gap === 0 ? 'Winner' : `+${result.gap.toFixed(3)}s`;
  else if (typeof result.gap === 'string' && /^\+?\d+(?:\.\d+)?s?$/i.test(result.gap.trim())) {
    const gap = Number.parseFloat(result.gap);
    value = gap === 0 ? 'Winner' : `+${gap.toFixed(3)}s`;
  }
  return `<span class="driver-result" title="${escapeUI(status || 'Result unavailable')}"><b>${escapeUI(value)}</b>${badge && raceResultView === 'points' ? `<small>${badge}</small>` : ''}</span>`;
}

function renderDrivers() {
  const root = $('#driverPills');
  const isRace = drivers.length > 0 && /^(Race|Sprint)$/i.test(loadedSessionName);
  const controls = $('#raceResultControls');
  if (controls) {
    controls.hidden = !isRace;
    controls.querySelectorAll('button').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.resultView === raceResultView));
      button.onclick = () => { raceResultView = button.dataset.resultView; renderDrivers(); };
    });
  }
  root.classList.toggle('has-race-results', isRace);
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
    return `<button class="driver-pill ${isSelected ? 'selected' : ''}" style="--team:${color}" data-motion-key="driver-${code}" data-code="${code}" aria-label="${escapeUI(`P${position}, ${name}, ${d[4] || ''}, number ${number}`)}" aria-pressed="${isSelected}"><span class="driver-pill-position">${position}</span>${teamLogoMarkup(d[4])}<span class="driver-pill-identity"><strong>${escapeUI(name)}</strong><small>${code} · ${number}</small></span>${isRace ? raceResultMarkup(realDrivers.get(code)) : ''}</button>`;
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
      } else {
        selected.push(code);
      }
      renderDrivers();
      renderStints();
      renderAll();
    };
  });
}


function fastestTimedLap(driver) {
  const timed = driver?.laps?.filter(lap => Number.isFinite(lap.time) && lap.time > 0 && !lap.in_lap && !lap.out_lap) || [];
  return timed.length ? timed.reduce((fastest, lap) => lap.time < fastest.time ? lap : fastest) : null;
}

function toggleLoadedLap(code, lapNum) {
  const lapObj = realDrivers.get(code)?.laps?.find(item => item.lap === lapNum);
  if (!lapObj || (!Number.isFinite(lapObj.time) && !lapObj.in_lap && !lapObj.out_lap)) return;
  const index = loaded.findIndex(item => item.code === code && item.lap === lapNum);
  if (index === -1) {
    loaded.push({ code, lap: lapNum, time: lapObj.out_lap ? null : lapObj.time, real: lapObj });
    mapView = 'comparison';
  } else {
    loaded.splice(index, 1);
  }
  renderAll();
  renderStints();
}

function renderStints() {
  const root = $('#stintPanels');
  const actions = $('#lapWorkspaceActions');
  if (!selected.length) {
    setLapSelectionExpanded(true);
    actions.replaceChildren();
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
      <button type="button" id="compareAllFastest" data-motion-key="compare-fastest" class="compare-all-btn ${isAllFastestLoaded ? 'selected' : ''}" aria-pressed="${isAllFastestLoaded}" title="Add the fastest timed lap for every selected driver"><span>Compare fastest</span></button>
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
      const compounds = [...new Set(laps.map(lap => String(lap.compound || '').toUpperCase()).filter(Boolean))];
      const compoundBadges = compounds.map(compoundBadgeMarkup).join('');
      const runLabel = hasQualifyingPhases ? id : `Stint ${id}`;
      const count = hasQualifyingPhases ? new Set(laps.map(lap => lap.stint)).size : laps.length;
      const countLabel = hasQualifyingPhases ? (count === 1 ? 'run' : 'runs') : (count === 1 ? 'lap' : 'laps');
      return `<button type="button" class="stint run-segment ${id === active ? 'selected' : ''}" aria-pressed="${id === active}" aria-label="Show ${escapeUI(runLabel)} laps for ${code}" style="--team:${teamColor}" data-motion-key="run-${code}-${id}" data-code="${code}" data-stint="${id}"><strong>${runLabel}</strong><small><span class="run-compounds">${compoundBadges}</span>${count} ${countLabel}</small><span class="run-choice-indicator" aria-hidden="true">${id === active ? '✓' : '›'}</span></button>`;
    }).join('');
    const qualifyingRuns = [...new Set(activeLaps.map(lap => lap.stint))];
    const lapButtons = activeLaps.map(lap => {
      const isLoaded = loaded.some(item => item.code === code && item.lap === lap.lap);
      const flag = `L${lap.lap}`;
      const classes = ['lap', 'lap-chip', lap.in_lap || lap.out_lap ? 'in-out' : '', isLoaded ? 'selected' : ''].filter(Boolean).join(' ');
      const displayTime = Number.isFinite(lap.display_time) ? lap.display_time : lap.time;
      const estimated = lap.display_time_estimated === true;
      const duration = Number.isFinite(displayTime) ? `${estimated ? '~' : ''}${time(displayTime)}` : '&mdash;';
      const selectable = Number.isFinite(lap.time) || lap.in_lap || lap.out_lap;
      const context = lap.in_lap && lap.out_lap ? 'IN/OUT' : lap.out_lap ? 'OUT' : lap.in_lap ? 'IN' : '';
      const neutralised = String(lap.track_status || '').includes('4') ? 'SC'
        : String(lap.track_status || '').includes('6') ? 'VSC' : '';
      const title = lap.in_lap && lap.out_lap ? 'Pit entry and exit occurred in this lap; trace may include a garage stop'
        : lap.out_lap ? 'Pit-out segment from pit exit to the timing line; comparison may be partial'
        : lap.in_lap ? 'Pit-in lap includes the pit entry'
        : neutralised ? `${neutralised} lap; time is not representative of racing pace`
        : !Number.isFinite(displayTime) ? 'No lap time published by the timing feeds' : '';
      const age = Number.isFinite(lap.tyre_life) && lap.tyre_life >= 1 ? Math.round(lap.tyre_life) : null;
      const tyreDetail = hasQualifyingPhases ? `<small class="lap-tyre-age">Run ${qualifyingRuns.indexOf(lap.stint) + 1} · Tyre age ${age === null ? 'unknown' : `${age} ${age === 1 ? 'lap' : 'laps'}`}</small>` : '';
      return `<button class="${classes}" aria-pressed="${isLoaded}" style="--team:${teamColor}" data-motion-key="lap-${code}-${lap.lap}" data-code="${code}" data-lap="${lap.lap}" ${selectable ? '' : 'disabled'} title="${escapeUI(title)}"><span class="lap-token">${flag}${context ? ` <b class="lap-state">${context}</b>` : ''}${neutralised ? ` <b class="lap-state">${neutralised}</b>` : ''}</span><span class="lap-clock">${duration}</span>${compoundBadgeMarkup(lap.compound)}${tyreDetail}</button>`;
    }).join('');
    const groupLabel = hasQualifyingPhases ? active : `Stint ${active}`;

    return `
      <article class="driver-run-card" data-motion-key="run-card-${code}" style="--team:${teamColor}">
        <header class="run-card-header">
          <div class="run-driver">${teamLogoMarkup(display[4])}<div class="run-driver-copy"><h3>${escapeUI(driver.name)}</h3><small>${code} · ${timedLaps.length} timed laps</small></div></div>
          ${fastest ? `<button class="fastest-lap-pick ${fastestLoaded ? 'selected' : ''}" data-motion-key="fastest-${code}" data-code="${code}" data-lap="${fastest.lap}" title="Add or remove this fastest lap"><span>Fastest</span><strong>${time(fastest.time)}</strong></button>` : ''}
        </header>
        <div class="run-section-label"><span>Runs</span></div>
        <div class="run-segments" style="--run-count:${Math.min(groupIds.length,3)}" role="group" aria-label="${code} runs">${runButtons}</div>
        <div class="lap-group-header"><span>${groupLabel} laps</span>${hasQualifyingPhases ? '' : `<small>${activeLaps.length} available</small>`}</div>
        <div class="lap-grid">${lapButtons}</div>
      </article>
    `;
  }).join('');

  replaceUI(actions, toolbar);
  replaceUI(root, cards);

  $('#compareAllFastest').onclick = () => {
    const fastestLaps = selected.map(code => ({ code, lap: fastestTimedLap(realDrivers.get(code)) })).filter(item => item.lap);
    if (isAllFastestLoaded) {
      loaded = loaded.filter(item => !fastestLaps.some(target => target.code === item.code && target.lap.lap === item.lap));
    } else {
      mapView = 'comparison';
      fastestLaps.forEach(target => {
        if (!loaded.some(item => item.code === target.code && item.lap === target.lap.lap)) {
          loaded.push({ code: target.code, lap: target.lap.lap, time: target.lap.time, real: target.lap });
        }
      });
    }
    renderAll();
    renderStints();
    // The chooser stays open after comparing; people often add or swap laps.
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
  const pitNotice = $('#pitLapNotice');
  if (pitNotice) pitNotice.hidden = !loaded.some(item => item.real?.in_lap || item.real?.out_lap);
  if (!loaded.length) {
    root.innerHTML = '<span class="section-empty">No laps loaded. Click laps in the panel to compare.</span>';
    return;
  }
  
  replaceUI(root, loaded.map((item, index) => `
    <div class="loaded-lap-pill ${index === 0 ? 'reference' : ''}" style="--team:${getLapColor(item)}" data-motion-key="comparison-${item.code}-${item.lap}" data-index="${index}">
      <button class="loaded-lap-main ${index === 0 ? 'reference' : ''}" data-motion-key="reference-${item.code}-${item.lap}" aria-pressed="${index === 0}" aria-label="Use ${item.code} lap ${item.lap} as reference"><b>${item.code}</b><span>L${item.lap}${item.real?.in_lap && item.real?.out_lap ? ' IN/OUT' : item.real?.out_lap ? ' OUT' : item.real?.in_lap ? ' IN' : ''}</span><strong>${item.real?.display_time_estimated ? '~' : ''}${time(Number.isFinite(item.real?.display_time) ? item.real.display_time : item.time)}</strong></button><button class="remove" data-motion-key="remove-${item.code}-${item.lap}" data-remove="${index}" aria-label="Remove ${item.code} lap ${item.lap}">×</button>
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
    const tyreAge = Number.isFinite(lap.tyre_life) ? Math.max(1, Math.round(lap.tyre_life)) : null;
    const tyreLife = tyreAge === null ? '' : `${tyreAge} lap${tyreAge === 1 ? '' : 's'}`;
    return `
      <article class="lap-summary-card has-conditions" data-motion-key="summary-${item.code}-${item.lap}" style="--team:${color}">
        <header>
          <span class="summary-driver" title="${item.code} · lap ${item.lap}"><b>${item.code}</b><span class="summary-lap-label">Lap ${item.lap}</span>${i === 0 ? '<em>REF</em>' : ''}</span>
          <span class="summary-header-actions">
            <span class="summary-tyre ${compoundClass}">${compoundBadgeMarkup(lap.compound)}<span class="summary-tyre-copy"><b>${compound}</b>${tyreLife ? `<small>${tyreLife} used</small>` : ''}</span></span>
            <span class="summary-lap-time"><small>${lap.in_lap && lap.out_lap ? 'PIT IN/OUT' : lap.out_lap ? 'PIT EXIT → LINE' : lap.in_lap ? 'PIT-IN LAP' : 'LAP'}</small>${i === 0 || lap.out_lap || ref.real?.out_lap ? '' : deltaBadge(item.time, ref.time)}<strong>${lap.display_time_estimated ? '~' : ''}${time(Number.isFinite(lap.display_time) ? lap.display_time : item.time)}</strong></span>
          </span>
        </header>
        <div class="summary-sectors">${sectors.map(({ label, value, reference, state }) => `
          <span class="sector-cell ${state.className}" title="${label} · ${state.label}">
            <span class="sector-cell-value"><small>${label}</small><span class="sector-measurements"><span class="sector-delta-slot">${i === 0 ? '' : deltaBadge(value, reference)}</span><strong>${Number.isFinite(value) ? `${value.toFixed(3)}s` : '—'}</strong></span></span>
          </span>`).join('')}
        </div>
        ${conditionsHtml}
      </article>
    `;
  }).join(''));

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

function updateTimingDeltaZoomReadout() {
  const readout = $('#timingDeltaZoomReadout');
  const zoomOut = $('[data-delta-zoom="out"]');
  const zoomIn = $('[data-delta-zoom="in"]');
  const reset = $('[data-delta-zoom="reset"]');
  if (readout) readout.textContent = `${Math.round(timingDeltaZoom * 100)}%`;
  if (zoomOut) zoomOut.disabled = timingDeltaZoom <= MIN_TIMING_DELTA_ZOOM;
  if (zoomIn) zoomIn.disabled = timingDeltaZoom >= MAX_TIMING_DELTA_ZOOM;
  if (reset) reset.disabled = Math.abs(timingDeltaZoom - 1) < 1e-6;
}

function setTimingDeltaZoom(nextZoom) {
  const clamped = Math.max(MIN_TIMING_DELTA_ZOOM, Math.min(MAX_TIMING_DELTA_ZOOM, nextZoom));
  timingDeltaZoom = Math.round(clamped / TIMING_DELTA_ZOOM_STEP) * TIMING_DELTA_ZOOM_STEP;
  updateTimingDeltaZoomReadout();
  drawRealChart('Timing delta');
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
  $('[data-trace-focus="open"]')?.addEventListener('click', () => setTraceFocus(true));
  $('[data-trace-focus="close"]')?.addEventListener('click', () => setTraceFocus(false));
  $('[data-zoom="in"]')?.addEventListener('click', () => zoomTraceBy(.55));
  $('[data-zoom="out"]')?.addEventListener('click', () => zoomTraceBy(1.8));
  $('[data-zoom="reset"]')?.addEventListener('click', () => setTraceZoom(0, 1));
  $('[data-pan="left"]')?.addEventListener('click', () => panTrace(-1));
  $('[data-pan="right"]')?.addEventListener('click', () => panTrace(1));
  $('[data-delta-zoom="out"]')?.addEventListener('click', () => setTimingDeltaZoom(timingDeltaZoom - TIMING_DELTA_ZOOM_STEP));
  $('[data-delta-zoom="in"]')?.addEventListener('click', () => setTimingDeltaZoom(timingDeltaZoom + TIMING_DELTA_ZOOM_STEP));
  $('[data-delta-zoom="reset"]')?.addEventListener('click', () => setTimingDeltaZoom(1));
  const speedCanvas = document.querySelector('[data-chart="Speed trace"]');
  if (speedCanvas) {
    speedCanvas.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !loaded.length) return;
      const rect = speedCanvas.getBoundingClientRect();
      const local = Math.max(0, Math.min(1, (event.clientX - rect.left - TRACE_PLOT_LEFT) / (rect.width - TRACE_PLOT_LEFT - TRACE_PLOT_RIGHT)));
      const fraction = traceZoom.start + local * (traceZoom.end - traceZoom.start);
      zoomDrag = { anchor: fraction, current: fraction };
      speedCanvas.setPointerCapture?.(event.pointerId);
      hoverFraction = null;
      event.preventDefault();
      drawRealChart('Speed trace');
    });
    speedCanvas.addEventListener('dblclick', () => setTraceZoom(0, 1));
    speedCanvas.addEventListener('pointercancel', () => { zoomDrag=null; drawRealChart('Speed trace'); });
  }
  updateZoomReadout();
  updateTimingDeltaZoomReadout();
}

let traceFocusReturn = null;
let traceFocusPreviousView = null;
function setTraceFocus(expanded) {
  const charts = $('#charts');
  if (!charts) return;
  if (expanded) {
    if(document.body.classList.contains('trace-focus'))return;
    traceFocusReturn = document.activeElement;
    traceFocusPreviousView = {zoom:{...traceZoom},delta:timingDeltaZoom};
    // The expanded view is for reading the entire lap, not magnifying a section.
    traceZoom = { start: 0, end: 1 };
    hoverFraction = null;
    updateZoomReadout();
  }
  else if(traceFocusPreviousView) {
    traceZoom={...traceFocusPreviousView.zoom};timingDeltaZoom=traceFocusPreviousView.delta;
    traceFocusPreviousView=null;updateZoomReadout();updateTimingDeltaZoomReadout();
  }
  document.body.classList.toggle('trace-focus', expanded);
  $('#realTooltip').style.display = 'none';
  charts.setAttribute('aria-label', expanded ? 'Expanded speed trace and timing delta' : 'Telemetry charts');
  $('[data-trace-focus="open"]')?.setAttribute('aria-expanded', String(expanded));
  if (expanded) $('[data-trace-focus="close"]')?.focus();
  else if (traceFocusReturn?.isConnected) traceFocusReturn.focus();
  requestAnimationFrame(() => {
    drawRealChart('Speed trace');
    drawRealChart('Timing delta');
  });
}

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && document.body.classList.contains('trace-focus')) {
    event.preventDefault();
    setTraceFocus(false);
  }
});

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
    const displayTime=Number.isFinite(lap.real?.display_time)?lap.real.display_time:lap.time;
    const lapLabel=`${lap.real?.display_time_estimated?'~':''}${time(displayTime)}s`;
    return `<div class="trace-pill-group" style="--team:${getLapColor(lap)}"><label class="trace-driver-chip ${visible ? 'is-visible' : ''}" style="--team:${getLapColor(lap)}" title="${visible ? 'Hide' : 'Show'} ${lap.code} lap ${lap.lap}">
      <input type="checkbox" data-trace-key="${key}" ${visible ? 'checked' : ''} ${disableLast ? 'disabled' : ''}>
      <b>${lap.code}</b><small>${lapLabel}</small>
    </label><label class="trace-swatch" title="Change ${lap.code} lap ${lap.lap} colour"><input type="color" value="${getLapColor(lap)}" data-lap-color="${key}" aria-label="Change ${lap.code} lap ${lap.lap} trace colour"></label></div>`;
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
  $('#speedAnnotationToggle')?.addEventListener('change', event => {
    showSpeedAnnotations = event.target.checked;
    window.ApexAnalysis?.savePreference('speed-annotations',showSpeedAnnotations);
    if (loaded.length) drawRealChart('Speed trace');
  });
  $('#cornerToggle')?.addEventListener('change', event => {
    showCornerNumbers = event.target.checked;
    window.ApexAnalysis?.savePreference('corner-numbers',showCornerNumbers);
    const status = $('#cornerStatus');
    if (status) status.textContent = showCornerNumbers
      ? 'Corner labels and adaptive analysis active.'
      : 'Corner labels hidden.';
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
        </div><button type="button" class="trace-focus-button" data-trace-focus="open" aria-expanded="false" aria-controls="charts" title="Show speed trace and timing delta across the full page">Expand charts</button><button type="button" class="trace-focus-button trace-focus-close" data-trace-focus="close" title="Return to session analysis">Close view</button>` : name === 'Timing delta' ? `
        <div class="trace-zoom-cluster delta-zoom-cluster" aria-label="Timing delta vertical zoom controls">
          <span class="trace-zoom-readout">Scale <b id="timingDeltaZoomReadout">${Math.round(timingDeltaZoom * 100)}%</b></span>
          <div class="trace-tools">
            <button data-delta-zoom="out" title="Compress timing delta" aria-label="Compress timing delta">−</button>
            <button data-delta-zoom="in" title="Magnify timing delta" aria-label="Magnify timing delta">+</button>
            <button class="trace-reset" data-delta-zoom="reset" title="Reset timing delta scale">Reset</button>
          </div>
        </div>` : ''}</div>
      ${name === 'Speed trace' ? `
        <div class="speed-chart-controls">
          <div class="trace-settings" aria-label="Telemetry display settings">
            <div class="alignment-readout"><i></i><span id="alignmentStatus" data-state="idle">Speed trace controls</span></div>
            <label class="trace-setting"><input type="checkbox" id="cornerToggle" ${showCornerNumbers ? 'checked' : ''}><i aria-hidden="true"></i><span>Corner numbers</span></label>
            <label class="trace-setting" title="Label every measured speed peak and dip. Each lap uses its own minimum or maximum, matched to the other laps by GPS position. The fastest lap shows its speed in km/h; the others show their difference. A dash means that lap has no matching measured extreme."><input type="checkbox" id="speedAnnotationToggle" ${showSpeedAnnotations ? 'checked' : ''}><i aria-hidden="true"></i><span>Speed annotations</span></label>
          </div>
          <div class="trace-display-bar">
            <span>Visible traces</span>
            <div class="trace-driver-toggles" id="traceDriverToggles"></div>
          </div>
          <p class="pit-lap-notice" id="pitLapNotice" hidden>Pit-in laps include pit entry. Pit-out traces begin at pit exit and are partial; a lap marked IN/OUT may include a garage stop. No full-lap timing delta is shown for pit-out traces.</p>
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
    // Broadcast-style speed scale: a gridline every 50 km/h, with headroom
    // above the fastest peak for its label.
    min = Math.max(0, Math.floor((rawMin - 10) / 50) * 50);
    max = Math.ceil((rawMax + 25) / 50) * 50;
    tickStep = 50;
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

function trackIntersectsLabel(box, points, clearance = 8, closed = true) {
  const left = box.x - clearance, right = box.x + box.width + clearance;
  const top = box.y - clearance, bottom = box.y + box.height + clearance;
  return points.some((a, index) => {
    if (!closed && index===points.length-1) return false;
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

// Numbering verified against Sepang's official safety-briefing circuit map.
// Chainage is approximate, digitized on the bundled my-1999 centreline.
const SEPANG_MAP_CORNERS = Object.freeze([
  [6,367],[14,507],[24,783],[35,1307],[44,1683],[52,1908],[57,2290],
  [60,2401],[66,2891],[71,3053],[78,3249],[83,3585],[89,3801],[94,3931],[100,4879],
].map(([outlineIndex,distance], i) => Object.freeze({number:String(i+1),letter:'',
  outlineIndex,distance,fraction:distance/5543,source:'official_map_estimate',approximate:true})));

// Geographic anchors, normalized against the complete north-up Sepang outline.
// Do not transfer its chainage to a car stream: integrated telemetry distance
// and the map's start line are not interchangeable.
const SEPANG_CORNER_POSITIONS = Object.freeze([
  [0,.477778],[.094181,.517310],[.070923,.785614],[.479518,.992982],
  [.604422,.655322],[.774407,.745614],[1,.466316],[.957504,.364211],
  [.547569,.291813],[.638783,.175322],[.572071,0],[.338821,.200585],
  [.162902,.151111],[.095616,.249942],[.858059,.488187],
]);

function projectSepangCorners(samples) {
  const points = samples.filter(p => p.X != null && p.Y != null && Number.isFinite(+p.X) && Number.isFinite(+p.Y));
  if (points.length < 30) return [];
  const minX = Math.min(...points.map(p => +p.X)), maxX = Math.max(...points.map(p => +p.X));
  const minY = Math.min(...points.map(p => +p.Y)), maxY = Math.max(...points.map(p => +p.Y));
  if (maxX <= minX || maxY <= minY) return [];
  const normalized = points.map(p => ({x:(+p.X-minX)/(maxX-minX), y:(+p.Y-minY)/(maxY-minY), fraction:traceSampleFraction(samples,p)}));
  let previous = -Infinity;
  return SEPANG_MAP_CORNERS.flatMap((corner,index) => {
    const [x,y] = SEPANG_CORNER_POSITIONS[index];
    let best = null;
    for (let i=1;i<normalized.length;i++) {
      const a=normalized[i-1], b=normalized[i];
      if (b.fraction <= previous || b.fraction-a.fraction > .025) continue;
      const dx=b.x-a.x, dy=b.y-a.y;
      const t=Math.max(0,Math.min(1,((x-a.x)*dx+(y-a.y)*dy)/(dx*dx+dy*dy||1)));
      const fraction=a.fraction+(b.fraction-a.fraction)*t;
      if (fraction <= previous) continue;
      const error=Math.hypot(a.x+t*dx-x,a.y+t*dy-y);
      if (!best || error<best.error) best={fraction,error};
    }
    // Missing or mismatched GPS must not produce convincing but wrong labels.
    if (!best || best.error>.045) return [];
    previous=best.fraction;
    return [{...corner,key:`${corner.number}:`,fraction:best.fraction,source:'map_position',approximate:true}];
  });
}

function isSepangCircuit(event = null) {
  const key = sessionCircuitKey ?? event?.circuit_key;
  const location = normalizedPlaceName(sessionLocation || event?.location || '');
  // A supplied identity always wins over a familiar Grand Prix name.
  return key != null && Number(key) > 0 ? Number(key) === 12 : /sepang|kuala lumpur/.test(location);
}

function markerRowsForCurrentCircuit(rows) {
  rows = Array.isArray(rows) ? rows : [];
  const selectedVal = selectValue($('#gp'));
  const event = calendar.find(item => String(item.round) === String(selectedVal) || item.name === selectedVal) || calendar[0];
  const year = sessionYear || Number(selectValue($('#year')));
  const name = normalizedPlaceName(sessionEventName || event?.name);

  if (isSepangCircuit(event) && !rows.length) {
    return SEPANG_MAP_CORNERS.map(marker => ({...marker}));
  }

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
  if (markerRows.length && isSepangCircuit() && markerRows.every(row => row.source === 'official_map_estimate')) {
    return projectSepangCorners(samples);
  }
  const positionSamples = samples.filter(point => point.X != null && point.Y != null && Number.isFinite(+point.X) && Number.isFinite(+point.Y));
  const xs = positionSamples.map(point => +point.X);
  const ys = positionSamples.map(point => +point.Y);
  const diagonal = positionSamples.length > 1
    ? Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
    : 0;

  // A circuit can pass close to itself (Baku T20 is beside T5/T6).
  // Project in turn order so a later corner cannot snap to an earlier pass.
  let previousFraction = 0;
  const orderedRows = [...markerRows].sort((a, b) =>
    Number(a.number) - Number(b.number) || String(a.letter || '').localeCompare(String(b.letter || '')));
  const resolved = orderedRows.map(corner => {
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
    if (!Number.isFinite(fraction) || fraction <= previousFraction + .001 || fraction > 1.02) {
      const x = Number(corner.x), y = Number(corner.y);
      let nearest = null;
      let nearestDistance = Infinity;
      if (Number.isFinite(x) && Number.isFinite(y)) {
        positionSamples.forEach(point => {
          if ((+point.Distance || 0) / totalDistance <= previousFraction + .001) return;
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

    if (Number.isFinite(fraction) && fraction > previousFraction) previousFraction = fraction;
    const rawFraction = fraction;
    // Corner fractions arrive in the source lap's distance coordinates; the
    // charts and map use the registered comparison grid after alignment.
    if (Number.isFinite(samples[0]?.AlignedFraction) && Number.isFinite(fraction)) {
      const target = fraction * (+samples[samples.length - 1]?.Distance || totalDistance);
      const afterIndex = samples.findIndex(p => +p.Distance >= target);
      if (afterIndex >= 0) {
        const before = samples[Math.max(0,afterIndex-1)], after = samples[afterIndex];
        if (Number.isFinite(before.AlignedFraction) && Number.isFinite(after.AlignedFraction)) {
          const ratio = Math.max(0,Math.min(1,(target-before.Distance)/(after.Distance-before.Distance||1)));
          fraction = before.AlignedFraction + (after.AlignedFraction-before.AlignedFraction)*ratio;
        }
      }
    }
    return {
      ...corner,
      key: `${corner.number}:${corner.letter || ''}`,
      fraction,
      rawFraction,
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
  if (unit === 'KM/H') {
    // Axis title, rotated beside the tick labels: "Speed [km/h]".
    ctx.save();
    ctx.translate(11, top + (height - top - bottom) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.font = canvasFont(10, 500);
    ctx.fillStyle = theme.text;
    ctx.fillText('Speed [km/h]', 0, 0);
    ctx.restore();
  }
  ctx.textAlign = 'left';
}



function layoutSpeedCornerCallouts(markers, width, left = 43, right = 7, viewStart = 0, viewEnd = 1) {
  const gap = 3, maxNudge = 12;
  const plotWidth = width - left - right;
  const lanes = [];
  // Source corner rows are normally delivered in lap order, but sorting here
  // guarantees lane allocation still works if a provider returns them shuffled.
  const items = [...markers]
    .filter(corner => Number.isFinite(corner.fraction) && corner.fraction >= viewStart && corner.fraction <= viewEnd)
    .sort((a, b) => a.fraction - b.fraction)
    .map(corner => {
      const anchorX = left + ((corner.fraction - viewStart) / (viewEnd - viewStart || 1)) * plotWidth;
      const tagWidth = Math.max(22, String(cornerLabel(corner)).length * 7 + 8);
      // Nudge sideways a few pixels before opening another row; the tick keeps the exact position visible.
      for (let lane = 0; ; lane++) {
        lanes[lane] ||= [];
        for (const shift of [0, 4, -4, 8, -8, maxNudge, -maxNudge]) {
          const x = Math.max(left + tagWidth / 2, Math.min(width - right - tagWidth / 2, anchorX + shift));
          if (lanes[lane].every(([l, r]) => x + tagWidth / 2 + gap <= l || x - tagWidth / 2 - gap >= r)) {
            lanes[lane].push([x - tagWidth / 2, x + tagWidth / 2]);
            return { corner, x, anchorX, lane, width: tagWidth };
          }
        }
      }
    });
  return { items, lanes: lanes.length };
}

function sharedCornerSpeed(entry, fraction, totalDistance) {
  const samples=entry.samples;
  const index=samples.findIndex(p=>traceSampleFraction(samples,p)>=fraction);
  if(index<0)return null;
  const after=samples[index],af=traceSampleFraction(samples,after);
  const valid=p=>p?.Speed!=null&&Number.isFinite(+p.Speed)&&+p.Speed>0;
  if(Math.abs(af-fraction)<1e-9)return valid(after)?{lap:entry.lap,speed:+after.Speed,fraction,estimated:false}:null;
  if(index===0)return null;
  const before=samples[index-1],bf=traceSampleFraction(samples,before);
  if(!valid(before)||!valid(after)||!(af>bf)||af-bf>Math.max(40/totalDistance,.008))return null;
  if(finiteTelemetryTime(before.ElapsedSeconds)&&finiteTelemetryTime(after.ElapsedSeconds)
    && after.ElapsedSeconds-before.ElapsedSeconds>.6)return null;
  // Bounded interpolation of native speed at one shared spatial position,
  // not each driver's independently selected minimum or reconstructed curve.
  if(typeof telemetryEstimateInfo==='function'&&telemetryEstimateInfo(samples,fraction,'Speed'))return null;
  const ratio=(fraction-bf)/(af-bf);
  return {lap:entry.lap,speed:+before.Speed+(+after.Speed-before.Speed)*ratio,fraction,estimated:true};
}

// Each lap's own measured speed extremes: local minima and maxima of native
// samples with real (topographic) prominence. Never sampled at a corner marker
// or a fixed window edge, which reads entry or exit speed instead of the apex.
function lapSpeedExtremes(samples, totalDistance, {prominence=8, reach=900, gapSeconds=1.6, gapMetres=100}={}) {
  if (!samples?.length || !(totalDistance > 0)) return [];
  const points = samples
    .filter(p => p?.Speed != null && Number.isFinite(+p.Speed) && +p.Speed > 0)
    .map(p => ({fraction: traceSampleFraction(samples, p), speed: +p.Speed, x: +p.X, y: +p.Y, t: Number.isFinite(+p.ElapsedSeconds) && p.ElapsedSeconds != null ? +p.ElapsedSeconds : null}))
    .filter(p => Number.isFinite(p.fraction))
    .sort((a, b) => a.fraction - b.fraction);
  const metres = fraction => fraction * totalDistance;
  // A packet gap is a hole in the measurement, judged by time where known.
  // ~4 Hz feeds have routine 1.1 s packets (the drawn line bridges them), so
  // only longer holes are refused; without timestamps, 100 m.
  const gap = (a, b) => a.t != null && b.t != null ? b.t - a.t > gapSeconds : metres(b.fraction - a.fraction) > gapMetres;
  const result = [];
  for (let i = 0; i < points.length; i++) {
    const here = points[i], at = metres(here.fraction);
    // Plateaus: evaluate only the first sample of a run of equal speeds.
    // A plateau never spans a telemetry gap.
    if (i > 0 && points[i - 1].speed === here.speed && !gap(points[i - 1], here)) continue;
    let end = i; while (end + 1 < points.length && points[end + 1].speed === here.speed && !gap(points[end], points[end + 1])) end++;
    const before = points[i - 1], after = points[end + 1];
    if ((before && gap(before, here)) || (after && gap(points[end], after))) continue;
    for (const kind of ['max', 'min']) {
      const higher = (s) => kind === 'max' ? s > here.speed : s < here.speed;
      if ((before && higher(before.speed)) || (after && higher(after.speed))) continue;
      // The lap's first and last packets are a cut through the timing line, not a peak or dip.
      if (!before || !after) continue;
      // Walk outwards until a more extreme sample: the deepest opposite value on
      // each side is the col; prominence is the smaller of the two drops.
      const side = (step, start) => {
        let base = here.speed, j = start;
        while (j >= 0 && j < points.length && Math.abs(metres(points[j].fraction) - at) <= reach) {
          // Ties: an equal extreme earlier in the lap wins, so two equal
          // peaks (e.g. a 306 km/h plateau with a 1 km/h dip) get one label.
          if (higher(points[j].speed) || (step < 0 && points[j].speed === here.speed)) break;
          base = kind === 'max' ? Math.min(base, points[j].speed) : Math.max(base, points[j].speed);
          j += step;
        }
        return base;
      };
      const left = before ? side(-1, i - 1) : null, right = after ? side(1, end + 1) : null;
      const drops = [left, right].filter(v => v != null).map(v => Math.abs(here.speed - v));
      const depth = Math.min(...drops);
      if (!(depth >= prominence)) continue;
      const mid = points[Math.floor((i + end) / 2)];
      result.push({kind, ...here, fraction: mid.fraction, x: mid.x, y: mid.y, prominence: depth});
    }
  }
  return result.filter(e => !(typeof telemetryEstimateInfo === 'function' && telemetryEstimateInfo(samples, e.fraction, 'Speed')));
}

// Raw GPS units per metre of this lap, so a 70 m match radius works whether
// the feed reports metres or tenths of a metre.
function lapPositionScale(samples, totalDistance) {
  let path = 0, previous = null;
  for (const p of samples || []) {
    if (!Number.isFinite(+p?.X) || !Number.isFinite(+p?.Y) || p.X == null || p.Y == null) continue;
    if (previous) path += Math.hypot(+p.X - previous.x, +p.Y - previous.y);
    previous = {x: +p.X, y: +p.Y};
  }
  return path > 0 && totalDistance > 0 ? path / totalDistance : null;
}

// A lap's own raw minimum or maximum inside one segment (no matching extreme
// there, e.g. a flat-out kink for one driver but a lift for another).
function lapSegmentExtreme(samples, kind, from, to) {
  let best = null;
  for (const p of samples || []) {
    const f = traceSampleFraction(samples, p);
    if (!(f >= from && f <= to) || p?.Speed == null || !(+p.Speed > 0)) continue;
    if (!best || (kind === 'max' ? +p.Speed > best.speed : +p.Speed < best.speed)) best = {speed: +p.Speed, fraction: f};
  }
  // An extreme sitting on the segment edge is just the slope continuing, not a peak or dip.
  const margin = (to - from) * .1;
  return best && best.fraction > from + margin && best.fraction < to - margin ? best : null;
}

const STEADY_SPEED_RANGE_KMH = 10;
function lapSpeedRange(samples, from, to) {
  let lo = Infinity, hi = -Infinity;
  for (const p of samples || []) {
    const f = traceSampleFraction(samples, p);
    if (!(f >= from && f <= to) || p?.Speed == null || !(+p.Speed > 0)) continue;
    lo = Math.min(lo, +p.Speed); hi = Math.max(hi, +p.Speed);
  }
  return hi >= lo ? hi - lo : null;
}

function buildSpeedAnnotations(entries, markers, totalDistance, {matchMetres=70, segmentMetres=120} = {}) {
  if (!entries?.length || !Number.isFinite(totalDistance) || totalDistance <= 0) return [];
  const lapsWithExtremes = entries.map(entry => ({entry, scale: lapPositionScale(entry.samples, totalDistance), extremes: lapSpeedExtremes(entry.samples, totalDistance)}));
  const [anchor, ...others] = lapsWithExtremes;
  const used = others.map(() => new Set());
  const nearestCorner = extreme => {
    let best = null;
    for (const marker of markers || []) {
      const gap = Math.abs(marker.fraction - extreme.fraction) * totalDistance;
      if (gap <= 150 && (!best || gap < best.gap)) best = {marker, gap};
    }
    return best?.marker || null;
  };
  return anchor.extremes.map(extreme => {
    const values = [{lap: anchor.entry.lap, speed: extreme.speed, fraction: extreme.fraction}];
    const missing = [];
    others.forEach((other, index) => {
      let best = null;
      other.extremes.forEach((candidate, candidateIndex) => {
        if (candidate.kind !== extreme.kind || used[index].has(candidateIndex)) return;
        // Match the same physical place by GPS; distance fractions drift between laps.
        const gps = [extreme.x, extreme.y, candidate.x, candidate.y].every(Number.isFinite) && anchor.scale && other.scale
          ? Math.hypot(candidate.x - extreme.x, candidate.y - extreme.y) / ((anchor.scale + other.scale) / 2)
          : null;
        const metres = gps ?? Math.abs(candidate.fraction - extreme.fraction) * totalDistance;
        if (metres <= matchMetres && (!best || metres < best.metres)) best = {candidate, candidateIndex, metres};
      });
      if (best) { used[index].add(best.candidateIndex); values.push({lap: other.entry.lap, speed: best.candidate.speed, fraction: best.candidate.fraction}); return; }
      // No matching extreme: that lap's own raw extreme in the same segment.
      const span = segmentMetres / totalDistance;
      const own = lapSegmentExtreme(other.entry.samples, extreme.kind, extreme.fraction - span, extreme.fraction + span);
      if (own && !(typeof telemetryEstimateInfo === 'function' && telemetryEstimateInfo(other.entry.samples, own.fraction, 'Speed'))) { values.push({lap: other.entry.lap, speed: own.speed, fraction: own.fraction, segment: true}); return; }
      // No dip or peak of its own: this lap held a steady speed through here
      // (flat out where the anchor lifted). Its measured speed at the same
      // place is the comparison, not a blank. Only when steady: on a slope a
      // few metres of position drift would read entry or exit speed instead.
      const steady = lapSpeedRange(other.entry.samples, extreme.fraction - span, extreme.fraction + span);
      const here = steady !== null && steady <= STEADY_SPEED_RANGE_KMH ? sharedCornerSpeed(other.entry, extreme.fraction, totalDistance) : null;
      if (here) values.push({lap: other.entry.lap, speed: here.speed, fraction: extreme.fraction, atPoint: true});
      else missing.push(other.entry.lap);
    });
    values.sort((a, b) => b.speed - a.speed);
    const corner = extreme.kind === 'min' ? nearestCorner(extreme) : null;
    return {title: corner ? cornerLabel(corner) : '', kind: extreme.kind, fraction: extreme.fraction, speed: values[0].speed, values, missing};
  });
}

// Broadcast-style labels: the leader's whole km/h, then every other lap's
// whole-km/h difference, stacked in lap colours.
function speedAnnotationLines(annotation) {
  const allLaps = [...annotation.values.map(v => v.lap), ...(annotation.missing || [])];
  const identity = lap => lap.code + (allLaps.filter(l => l.code === lap.code).length > 1 ? ` L${lap.lap}` : '');
  const leader = Math.round(annotation.values[0].speed);
  return [
    ...annotation.values.map((v, i) => {
      const delta = Math.round(v.speed) - leader;
      return {text: `${identity(v.lap)} ${i === 0 ? leader : delta === 0 ? '0' : (delta < 0 ? '−' : '+') + Math.abs(delta)}`, color: getLapColor(v.lap)};
    }),
    ...(annotation.missing || []).map(lap => ({text: `${identity(lap)} —`, color: getLapColor(lap)}))
  ];
}

function drawSpeedAnnotations(ctx, annotations, rect, bounds, xForFraction, viewStart, viewEnd, traces = []) {
  const theme = canvasTheme(), occupied = [];
  const bottom = rect.height - bounds.bottom, lineHeight = 13, plotRight = rect.width - bounds.right;
  const yFor = speed => bounds.top + (bounds.max - speed) / (bounds.max - bounds.min || 1) * (bottom - bounds.top);
  ctx.save();
  ctx.font = canvasFont(10, 600);
  ctx.textAlign = 'center';
  ctx.lineJoin = 'round';
  const collides = box => occupied.some(b => box.x < b.x + b.width + 3 && box.x + box.width + 3 > b.x && box.y < b.y + b.height + 2 && box.y + box.height + 2 > b.y);
  const fits = box => box.x >= bounds.left && box.x + box.width <= plotRight && box.y >= bounds.top + 14 && box.y + box.height <= bottom - 2;
  annotations.filter(a => a.fraction >= viewStart && a.fraction <= viewEnd).forEach(a => {
    const lines = speedAnnotationLines(a);
    const width = Math.max(...lines.map(l => ctx.measureText(l.text).width)) + 6;
    const height = lines.length * lineHeight + 2;
    const points = a.values.filter(v => v.fraction >= viewStart && v.fraction <= viewEnd).map(v => ({x: xForFraction(v.fraction), y: yFor(v.speed), color: getLapColor(v.lap)}));
    const px = xForFraction(a.fraction), py = yFor(a.speed);
    // Preferred side first (above peaks, below dips), then the other side,
    // then beside the point, so labels near the chart edges are never dropped.
    const vertical = (dir, offset) => ({x: Math.max(bounds.left, Math.min(plotRight - width, px - width / 2)), y: dir < 0 ? py - offset - height : py + offset, width, height});
    const sideways = (dir, offset) => ({x: dir < 0 ? px - offset - width : px + offset, y: Math.max(bounds.top + 14, Math.min(bottom - 2 - height, py - height / 2)), width, height});
    const first = a.kind === 'max' ? -1 : 1;
    const candidates = [];
    for (const offset of [7, 18, 32]) candidates.push(vertical(first, offset));
    for (const offset of [7, 18, 32]) candidates.push(vertical(-first, offset));
    for (const offset of [9, 22, 40]) candidates.push(sideways(1, offset), sideways(-1, offset));
    const clearOfTraces = box => !traces.some(trace => trackIntersectsLabel(box, trace.points, 1, false));
    const box = candidates.find(b => fits(b) && !collides(b) && clearOfTraces(b)) || candidates.find(b => fits(b) && !collides(b));
    if (!box) return;
    occupied.push(box);
    // Mark exactly where each value was measured, in that lap's colour.
    points.forEach(p => { ctx.beginPath(); ctx.arc(p.x, p.y, 2.6, 0, Math.PI * 2); ctx.fillStyle = p.color; ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = theme.labelStroke; ctx.stroke(); });
    // Leader from the measured point to the nearest edge of its label.
    const ex = Math.max(box.x, Math.min(box.x + box.width, px)), ey = Math.max(box.y, Math.min(box.y + box.height, py));
    if (Math.hypot(ex - px, ey - py) > 5) { ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(ex, ey); ctx.strokeStyle = theme.gridStrong; ctx.lineWidth = 1; ctx.stroke(); }
    lines.forEach((line, i) => {
      const ty = box.y + (i + 1) * lineHeight - 1;
      ctx.strokeStyle = theme.labelStroke; ctx.lineWidth = 3;
      ctx.strokeText(line.text, box.x + box.width / 2, ty);
      ctx.fillStyle = line.color;
      ctx.fillText(line.text, box.x + box.width / 2, ty);
    });
  });
  ctx.restore();
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
  if (value === null || value === undefined || !Number.isFinite(+value)) return null;
  if (field === 'Brake') return +value >= 50 ? 100 : 0;
  if (field === 'DRS') return +value >= .5 ? 1 : 0;
  if (field === 'nGear') return Math.round(+value);
  return +value;
}

// Discrete states change at the observed packet, never at an invented midpoint.
// Keep missing packets and long gaps in the path so the tooltip cannot turn
// an unknown brake/DRS observation into an apparently measured state.
function measuredDiscreteTrace(series, field, viewStart, viewEnd) {
  const samples = series
    .map(point => ({ x: traceSampleFraction(series, point), y: discreteTraceState(field, point[field]), time: point.ElapsedSeconds }))
    .sort((a, b) => a.x - b.x);
  if (!samples.length) return [];
  const points = [{x:viewStart,y:discreteTraceState(field, alignedValue(series, viewStart, field))}];
  for (let index = 1; index < samples.length; index++) {
    const before = samples[index - 1];
    const after = samples[index];
    if (!(after.x > before.x)) continue;
    if (finiteTelemetryTime(after.time) && finiteTelemetryTime(before.time) && after.time-before.time>1) {
      const x=Math.max(viewStart,before.x+1e-9);
      if(x<viewEnd)points.push({x,y:null});
    }
    if (after.x > viewStart && after.x < viewEnd) points.push({x:after.x,y:after.y});
  }
  points.push({x:viewEnd,y:discreteTraceState(field, alignedValue(series, viewEnd, field))});
  return points;
}

function finiteTelemetryTime(value) { return value!==null && value!==undefined && Number.isFinite(+value); }

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
  if (Math.abs(after.x-fraction)<1e-9) return after.y;
  if (Math.abs(before.x-fraction)<1e-9) return before.y;
  if (before.y===null || after.y===null) return null;
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
  // Category switches and focused mode hide some channels. A zero-sized
  // backing canvas cannot be copied into the static drawing cache.
  if (rect.width < 1 || rect.height < 1) {
    chartStaticLayers.delete(canvas);
    return;
  }
  const dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, rect.width, rect.height);
  const theme = canvasTheme();
  
  const unit = defs.find(def => def[0] === name)?.[1] || '';
  const field = chartField[name];
  const visibleEntries = name === 'Timing delta'
    ? visibleTraceLaps().filter(({ lap }) => !lap.real?.out_lap)
    : visibleTraceLaps();
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

  if (name === 'Timing delta' && loaded[0]?.real?.out_lap) {
    ctx.fillStyle = theme.text;
    ctx.font = canvasFont(12);
    ctx.fillText('Select a complete lap as reference for timing delta.', 43, 25);
    return;
  }

  if (name === 'Timing delta' && !visibleEntries.length) {
    ctx.fillStyle = theme.text;
    ctx.font = canvasFont(12);
    ctx.fillText('Pit-out segments have no full-lap timing delta.', 43, 25);
    return;
  }
  
  if (!data.length) {
    ctx.fillStyle = theme.text;
    ctx.font = canvasFont(12);
    ctx.fillText('Loading telemetry data…', 43, 25);
    return;
  }

  if (name === 'Timing delta' && !telemetryCache.get(telemetryKey(loaded[0]))?.length) {
    ctx.fillStyle = theme.text;
    ctx.font = canvasFont(12);
    ctx.fillText('Waiting for reference lap…', 43, 25);
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
  
  let niceBounds = getNiceBounds(name, rawMin, rawMax);
  if (name === 'Timing delta' && Math.abs(timingDeltaZoom - 1) > 1e-6) {
    niceBounds = getNiceBounds(name, niceBounds.min / timingDeltaZoom, niceBounds.max / timingDeltaZoom);
  }
  const min = niceBounds.min;
  const max = niceBounds.max;
  const refLap = loaded.find(lap => telemetryCache.get(telemetryKey(lap))?.length) || loaded[0];
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
  const distanceTickCount = Math.max(2, Math.min(6, Math.floor(plotWidth / 100)));
  for (let tick = 0; tick <= distanceTickCount; tick++) {
    const fraction = viewStart + viewSpan * tick / distanceTickCount;
    const x = xForFraction(fraction);
    ctx.beginPath();
    ctx.moveTo(x, bounds.top);
    ctx.lineTo(x, rect.height - bounds.bottom);
    ctx.strokeStyle = theme.grid;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = theme.text;
    ctx.font = canvasFont(12);
    ctx.textAlign = tick === 0 ? 'left' : tick === distanceTickCount ? 'right' : 'center';
    ctx.fillText(`${Math.round(fraction * totalDist)} M`, x, rect.height - bounds.bottom + 18);
  }
  ctx.textAlign = 'left';
  
  if (name === 'Speed trace' && $('#cornerToggle').checked) {
    const count = speedCornerMarkers.length;
    const projection = refLap?.cornerMarkers?.[0]?.source === 'lap_projection';
    const approximate = speedCornerMarkers.some(marker => marker.approximate);
    $('#cornerStatus').textContent = approximate
      ? isSepangCircuit()
        ? `Sepang: ${count} map-derived turn positions matched to this lap's GPS (approximate).`
        : 'Madrid: 22 turns + T5A/T20A · approximate positions from the FIA circuit map.'
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
    // observed packet transitions used by alignedValue, including missing data.
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
      y: point.y===null?null:bounds.top + (bounds.max - point.y) / (bounds.max - bounds.min || 1)
        * (rect.height - bounds.top - bounds.bottom),
    }));
    if (points.length) traceEntries.push({ points, domainPoints, teamColor, index });
  });

  const tracePath = points => {
    ctx.beginPath();
    let previous=null;
    points.forEach(point => {
      if(point.y===null){previous=null;return;}
      if(!previous)ctx.moveTo(point.x,point.y);
      else {
        if (name === 'Gear' || name === 'DRS' || name === 'Brake application') ctx.lineTo(point.x,previous.y);
        ctx.lineTo(point.x,point.y);
      }
      previous=point;
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
      if (!points.length || points.some(point=>point.y===null)) return;
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
  if (name==='Speed trace' && showSpeedAnnotations) {
    const entries=visibleEntries.map(({lap})=>({lap,samples:telemetryCache.get(telemetryKey(lap))})).filter(e=>e.samples?.length && !e.lap.real?.out_lap);
    const key=totalDist.toFixed(1)+'|'+speedCornerMarkers.map(m=>`${m.key}:${m.fraction.toFixed(5)}`).join('|')+'|'+entries.map(e=>e.samples.positionRevision||0).join(':');
    if (!speedAnnotationCache || speedAnnotationCache.key!==key || speedAnnotationCache.entries.length!==entries.length || entries.some((e,i)=>speedAnnotationCache.entries[i].samples!==e.samples || speedAnnotationCache.entries[i].lap!==e.lap)) {
      speedAnnotationCache={key,entries,annotations:buildSpeedAnnotations(entries,speedCornerMarkers,totalDist)};
    }
    drawSpeedAnnotations(ctx,speedAnnotationCache.annotations,rect,bounds,xForFraction,viewStart,viewEnd,traceEntries);
  }
  
  // Draw collision-free corner labels in a reserved header band. Corner
  // speeds live in the dedicated analysis panel below the track map.
  if (name === 'Speed trace' && $('#cornerToggle').checked) {
    const rowHeight = 20;
    const calloutHeight = 16;
    cornerCalloutLayout.items.forEach(({ corner, x, anchorX, lane, width }) => {
      if (!Number.isFinite(corner.fraction)) return;
      const labelY = rect.height - cornerAxisInset + 4 + lane * rowHeight;
      const left = x - width / 2;
      // Tick from the exact corner position on the axis to its tag.
      ctx.beginPath(); ctx.moveTo(anchorX, rect.height - bounds.bottom); ctx.lineTo(anchorX, rect.height - bounds.bottom + 3); ctx.lineTo(x, labelY + 1.5);
      ctx.strokeStyle = theme.gridStrong; ctx.lineWidth = 1; ctx.stroke();

      // Small grey boxed turn tags, like broadcast speed-trace graphics.
      const label = cornerLabel(corner);
      ctx.font = canvasFont(10, 600);
      const tagWidth = width;
      const tagLeft = left;
      ctx.fillStyle = lightThemeActive() ? 'rgba(20,25,32,.08)' : 'rgba(255,255,255,.1)';
      ctx.strokeStyle = theme.outline;
      ctx.lineWidth = 1;
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') ctx.roundRect(tagLeft + .5, labelY + 1.5, tagWidth - 1, calloutHeight - 1, 3);
      else ctx.rect(tagLeft + .5, labelY + 1.5, tagWidth - 1, calloutHeight - 1);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = theme.textStrong;
      ctx.textAlign = 'center';
      ctx.fillText(label, tagLeft + tagWidth / 2, labelY + 12.5);
      ctx.textAlign = 'left';
    });
  }
  
  // Retain expensive axes/paths/annotations; pointer motion paints overlays only.
  const staticCanvas=document.createElement('canvas');
  staticCanvas.width=canvas.width;staticCanvas.height=canvas.height;
  staticCanvas.getContext('2d').drawImage(canvas,0,0);
  chartStaticLayers.set(canvas,{image:staticCanvas,rect,bounds,viewStart,viewEnd,traceEntries,visibleEntries,dpr,theme});
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
function drawChartHover(name) {
  const canvas=document.querySelector(`[data-chart="${name}"]`),layer=canvas&&chartStaticLayers.get(canvas);
  if(!layer){drawRealChart(name);return;}
  if(!canvas.getBoundingClientRect().width)return;
  const {rect,bounds,viewStart,viewEnd,traceEntries,visibleEntries,dpr,theme}=layer;
  const ctx=canvas.getContext('2d');ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(layer.image,0,0);ctx.setTransform(dpr,0,0,dpr,0,0);
  if(hoverFraction===null||hoverFraction<viewStart||hoverFraction>viewEnd)return;
  const x=bounds.left+(hoverFraction-viewStart)/(viewEnd-viewStart)*(rect.width-bounds.left-bounds.right);
  ctx.strokeStyle=theme.crosshair;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x,bounds.top);ctx.lineTo(x,rect.height-bounds.bottom);ctx.stroke();
  for(const {lap,index}of visibleEntries){
    const entry=traceEntries.find(item=>item.index===index),stepped=['Brake application','Gear','DRS'].includes(name);
    const value=entry?renderedTraceValue(entry.domainPoints,hoverFraction,stepped):null;
    if(!Number.isFinite(value))continue;
    const y=bounds.top+(bounds.max-value)/(bounds.max-bounds.min||1)*(rect.height-bounds.top-bounds.bottom);
    ctx.fillStyle=getLapColor(lap);ctx.strokeStyle='#fff';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(x,y,4,0,2*Math.PI);ctx.fill();ctx.stroke();
  }
}
function scheduleHover(callback) {
  if(hoverFrame)cancelAnimationFrame(hoverFrame);
  hoverFrame=requestAnimationFrame(()=>{hoverFrame=0;callback();});
}
function bindAllChartHover() {
  const canvases = document.querySelectorAll('canvas[data-chart]');
  const tooltip = $('#realTooltip');
  const telemetryCard = $('.telemetry-card');
  
  canvases.forEach(canvas => {
    canvas.addEventListener('pointermove', event => scheduleHover(() => {
      const e=event;
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
      defs.forEach(def => drawChartHover(def[0]));
      drawMapHover();
      
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
        if (hoveredChartName === 'Timing delta' && !lap.real?.out_lap && !loaded[0]?.real?.out_lap) {
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
              ? val.toFixed(3)
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
      
      if (document.body.classList.contains('trace-focus')) {
        const tipRect = tooltip.getBoundingClientRect();
        // Fixed positions are in layout px; pointer coordinates include the page zoom.
        const pageZoom = document.documentElement.getBoundingClientRect().width / document.documentElement.offsetWidth || 1;
        tooltip.style.left = `${Math.max(8, Math.min(e.clientX + 15, innerWidth - tipRect.width - 12)) / pageZoom}px`;
        tooltip.style.top = `${Math.max(8, Math.min(e.clientY + 15, innerHeight - tipRect.height - 12)) / pageZoom}px`;
        return;
      }
      const parentRect = telemetryCard.getBoundingClientRect();
      const zoom = parentRect.width / telemetryCard.offsetWidth || 1;
      const tipRect = tooltip.getBoundingClientRect();
      const right = Math.min(parentRect.right, window.innerWidth) - 12;
      const x = e.clientX + 15 + tipRect.width > right ? e.clientX - tipRect.width - 15 : e.clientX + 15;
      const xPos = Math.max(8, (x - parentRect.left) / zoom);
      const yPos = Math.max(8, (Math.min(e.clientY + 15, window.innerHeight - tipRect.height - 12) - parentRect.top) / zoom);
      tooltip.style.left = `${xPos}px`;
      tooltip.style.top = `${yPos}px`;
    }));
    
    canvas.addEventListener('mouseleave', () => {
      if(hoverFrame){cancelAnimationFrame(hoverFrame);hoverFrame=0;}
      if (zoomDrag && canvas.dataset.chart === 'Speed trace') return;
      hoverFraction = null;
      hoveredChartName = null;
      tooltip.style.display = 'none';
      defs.forEach(def => drawChartHover(def[0]));
      drawMapHover();
    });
  });
}

function bindTrackMapHover() {
  const canvas = $('#dominanceCanvas');
  const tooltip = $('#realTooltip');
  const telemetryCard = $('.telemetry-card');
  if (!canvas) return;

  canvas.addEventListener('pointermove', event => scheduleHover(() => {
    const e=event;
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

      defs.forEach(def => drawChartHover(def[0]));
      drawMapHover();

      if (tooltip && telemetryCard) {
        const distanceKM = (bestFraction * totalDistance) / 1000;
        const {start: segmentStart, end: segmentEnd} = miniSectorBounds(totalDistance, bestFraction);
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
        const comparable = segmentRows.length >= 2 && segmentRows.every(row => Number.isFinite(row.sectionTime) && row.sectionTime > 0);
        const bestTime = comparable ? Math.min(...segmentRows.map(row => row.sectionTime)) : null;
        const lines = segmentRows.map(({ lap, speed, sectionTime }) => {
          const speedDisplay = Number.isFinite(speed) ? `${speed.toFixed(1)} KM/H` : '—';
          const timeDisplay = Number.isFinite(sectionTime) && sectionTime > 0
            ? `${sectionTime.toFixed(3)}s${bestTime == null ? ' · NOT COMPARED' : Math.abs(sectionTime - bestTime) < .0005 ? ' FASTEST' : ` +${(sectionTime - bestTime).toFixed(3)}s`}`
            : 'NO SECTION TIME';
          return `<span style="color: ${getLapColor(lap)}">●</span> ${lap.code} L${lap.lap} · <b>${speedDisplay}</b> · ${timeDisplay}`;
        });

        tooltip.innerHTML = `<b>TRACK MAP · ${distanceKM.toFixed(3)} KM · ${((segmentEnd-segmentStart)*totalDistance).toFixed(1)} M SECTION</b><br>${lines.join('<br>')}`;
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
  }));

  canvas.addEventListener('mouseleave', () => {
    if(hoverFrame){cancelAnimationFrame(hoverFrame);hoverFrame=0;}
    if (hoveredChartName === 'Track map') {
      hoverFraction = null;
      hoveredChartName = null;
      if (tooltip) tooltip.style.display = 'none';
      defs.forEach(def => drawChartHover(def[0]));
      drawMapHover();
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
      if (!alreadyReady && outstanding > 1 && generation === drawGeneration) {
        paintReadyTelemetry();
      }
    } catch (err) {
      if (err.name !== 'AbortError') console.warn(err);
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
  const genericMap = empty && (selected.length > 0 || !!sessionEventName);
  card.classList.toggle('is-empty', empty);
  card.classList.toggle('has-generic-map', genericMap);
  const emptyState = $('#telemetryEmpty');
  if (emptyState) emptyState.hidden = !empty || genericMap;
}

function renderAll() {
  const sessionContext = $('#loadedSessionContext');
  if (sessionContext) {
    sessionContext.hidden = !sessionEventName;
    sessionContext.textContent = sessionEventName ? `${sessionYear} · ${sessionEventName} · ${loadedSessionName}` : '';
  }
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

function mergeCornerWindows(zones) {
  const merged=[];
  zones.map(z=>({start:z.start,end:z.end})).sort((a,b)=>a.start-b.start).forEach(z=>{
    const last=merged.at(-1);
    if(last && z.start<=last.end)last.end=Math.max(last.end,z.end);
    else merged.push({...z});
  });
  return merged;
}

function sessionPerformanceZones(zones, totalDistance) {
  if (!zones.length) return [];
  const corners = zones.map(zone => ({...zone,kind:'corner'}));
  // Short links are transitions belonging to the adjacent corner complex,
  // not selectable 5 m "straights". Split at a common boundary, count once.
  for(let index=1;index<corners.length;index++){
    const gap=(corners[index].start-corners[index-1].end)*totalDistance;
    if(gap>=0&&gap<100){
      const boundary=gap<1e-6?corners[index-1].end:(corners[index].start+corners[index-1].end)/2;
      corners[index-1].end=boundary;corners[index].start=boundary;
    }
  }
  if(corners[0].start*totalDistance<100)corners[0].start=0;
  if((1-corners.at(-1).end)*totalDistance<100)corners.at(-1).end=1;
  corners.forEach(zone=>zone.metres=Math.round((zone.end-zone.start)*totalDistance));
  for(let index=1;index<corners.length;index++){
    // Canonicalise numerical dust at an already shared boundary. Otherwise
    // a 10^-16-lap "straight" has zero elapsed time and blocks comparisons.
    if(Math.abs(corners[index].start-corners[index-1].end)<1e-9)corners[index].start=corners[index-1].end;
  }
  // Keep stable indices even where two corner windows already meet. Empty
  // links are not offered as selectable zones or counted as measurements.
  const straights = Array.from({length:zones.length+1},(_,index)=>{
    const before=corners[index-1],after=corners[index];
    const start=before?.end??0,end=Math.max(start,after?.start??1);
    const straight=(end-start)*totalDistance>=100&&typeof sessionStraightEvidence==='function'&&sessionStraightEvidence(start,end,totalDistance);
    const prefix=straight?'Straight':'Link';
    const label=before&&after?`${prefix} ${cornerLabel(before)}–${cornerLabel(after)}`
      :before?`${prefix} after ${cornerLabel(before)}`:`${prefix} before ${cornerLabel(after)}`;
    return {kind:straight?'straight':'transition',type:straight?'LOW-CURVATURE STRAIGHT':'TRANSITION / UNVERIFIED GEOMETRY',label,start,end,
      between:[index-1,index],metres:Math.round((end-start)*totalDistance)};
  });
  return [...corners,...straights];
}

function cornerSelectionWindows(zones, indices) {
  return mergeCornerWindows([...new Set(indices)].filter(index=>Number.isInteger(index)&&zones[index]?.end>zones[index]?.start).map(index=>zones[index]));
}

function selectLinkingStraights(zones, selected, previousAutomatic) {
  const selection=new Set([...selected].filter(index=>!previousAutomatic.has(index)));
  const automatic=new Set();
  zones.forEach((zone,index)=>{
    if(zone.kind==='corner'||zone.end<=zone.start)return;
    const [before,after]=zone.between;
    if(zones[before]?.kind==='corner'&&zones[after]?.kind==='corner'&&selection.has(before)&&selection.has(after)&&!selection.has(index))automatic.add(index);
  });
  automatic.forEach(index=>selection.add(index));
  return {selection,automatic};
}

function selectedCornerWindows(zones) {
  return cornerSelectionWindows(zones, selectedCornerIndices);
}

function combinedCornerPerformance(samples,zones,totalDistance,indices=zones.map((_,index)=>index)) {
  const windows=cornerSelectionWindows(zones,indices);
  if(!windows.length||!Number.isFinite(totalDistance)||totalDistance<=0)return null;
  const times=windows.map(w=>performanceSectionDuration(samples,w.start,w.end));
  if(times.some(t=>!Number.isFinite(t)||t<=0))return null;
  const sectionTime=times.reduce((s,t)=>s+t,0);
  const metres=windows.reduce((s,w)=>s+(w.end-w.start)*totalDistance,0);
  return {sectionTime,minimumSpeed:metres/sectionTime*3.6,combined:true};
}

function renderCornerAnalysis() {
  const section = $('#cornerAnalysis');
  const root = $('#cornerMetricGrid');
  const pickerRoot = $('#cornerPickerRow');
  if (!section || !root || !pickerRoot) return;
  const enabled = loaded.length > 0 || selected.length > 0 || !!sessionEventName;
  section.hidden = !enabled;
  if (!enabled) {
    pickerRoot.innerHTML = ''; cornerPickerMarkup.delete(pickerRoot);
    root.innerHTML = '';
    return;
  }

  if (!loaded.length) {
    pickerRoot.innerHTML = ''; cornerPickerMarkup.delete(pickerRoot);
    root.innerHTML = '';
    return;
  }
  const referenceLap = loaded[0];
  const reference = telemetryCache.get(telemetryKey(referenceLap));
  if (!reference?.length || typeof adaptiveCornerZones !== 'function' || typeof cornerPerformance !== 'function') {
    pickerRoot.innerHTML = ''; cornerPickerMarkup.delete(pickerRoot);
    root.innerHTML = '<span class="section-empty">Corner analysis is waiting for aligned position data.</span>';
    return;
  }
  const totalDistance = reference[reference.length - 1].Distance || 1;
  const markers = resolveCornerMarkers(reference, totalDistance, referenceLap?.cornerMarkers);
  const zones = sessionPerformanceZones(adaptiveCornerZones(markers), totalDistance);
  if (!zones.length) {
    pickerRoot.innerHTML = ''; cornerPickerMarkup.delete(pickerRoot);
    root.innerHTML = '<span class="section-empty">Official corner positions are unavailable for this lap.</span>';
    return;
  }

  selectedCornerIndices=new Set([...selectedCornerIndices].filter(i=>i>=0&&i<zones.length&&zones[i].end>zones[i].start));
  const allMetrics = zones.map(zone => loaded.map(lap => {
    const samples = telemetryCache.get(telemetryKey(lap));
    const metric = zone.end<=zone.start?null:zone.kind!=='corner'?combinedCornerPerformance(samples,[zone],totalDistance):cornerPerformance(samples, zone);
    return metric ? { lap, metric } : null;
  }).filter(Boolean));
  const pickedZones=[...selectedCornerIndices].sort((a,b)=>a-b).map(i=>zones[i]);
  const combined=pickedZones.length>1;
  const selectedIndex = [...selectedCornerIndices][0];
  const zone = combined?{type:'Combined selected sections',metres:Math.round(selectedCornerWindows(zones).reduce((s,w)=>s+(w.end-w.start)*totalDistance,0)),apexMetres:0}:zones[selectedIndex]||{type:'No section selected',metres:0};
  const averageSpeed=combined||zone.kind!=='corner';
  const metrics = combined?loaded.map(lap=>{
    if([...selectedCornerIndices].some(i=>!allMetrics[i].some(m=>m.lap===lap)))return null;
    const metric=combinedCornerPerformance(telemetryCache.get(telemetryKey(lap)),zones,totalDistance,selectedCornerIndices);
    return metric?{lap,metric}:null;
  }).filter(Boolean):allMetrics[selectedIndex]||[];
  const finiteTimes = metrics.map(item => item.metric.sectionTime).filter(Number.isFinite);
  const fastestSection = finiteTimes.length ? Math.min(...finiteTimes) : null;
  const finiteMinimumSpeeds = metrics.map(item => item.metric.minimumSpeed).filter(Number.isFinite);
  const highestMinimumSpeed = finiteMinimumSpeeds.length ? Math.max(...finiteMinimumSpeeds) : null;
  const referenceSection = metrics[0]?.metric.sectionTime;
  const signedDelta = value => `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(3)}s`;
  // Retained model diagnostic, separate from measured timestamps and the
  // current common-distance season estimator. Never expand primary driver rows.
  const cornerOrder=zones.map((z,i)=>[z,i]).filter(([z])=>z.kind==='corner'&&z.end>z.start);
  const nextCorner=cornerOrder.find(([z])=>z.start>=(zone.end??1))?.[0]||cornerOrder[0]?.[0];
  const exitStraight=!combined&&zone.kind==='corner'&&nextCorner?((nextCorner.start-zone.end+(nextCorner.start<zone.end?1:0))*totalDistance):0;
  const referencePhases=!combined&&zone.kind==='corner'&&typeof cornerPhaseBreakdown==='function'?cornerPhaseBreakdown(reference,reference,zone,exitStraight):null;
  const phaseSplit=lap=>{
    if(!referencePhases||lap===referenceLap)return '';
    const own=cornerPhaseBreakdown(telemetryCache.get(telemetryKey(lap)),reference,zone,exitStraight);
    if(!own)return '';
    const d=['braking','mid','exit'].map(k=>own[k]-referencePhases[k]);
    return `<small class="corner-phase-split" title="Modelled, not measured: not the section delta above. It applies the same entry-speed correction and exit-speed credit as the season cornering metric. Includes an assumed entry correction (${own.entryKmh.toFixed(0)} vs REF ${referencePhases.entryKmh.toFixed(0)} km/h) and exit-speed credit over up to ${Math.round(Math.min(500,exitStraight))} m of the next straight.">Braking ${signedDelta(d[0])} · Mid ${signedDelta(d[1])} · Exit ${signedDelta(d[2])} · modelled total ${signedDelta(d[0]+d[1]+d[2])}</small>`;
  };
  const picker = kind=>zones.map((candidate, index) => {
    if(candidate.kind!==kind||candidate.end<=candidate.start)return '';
    const candidateMetrics = allMetrics[index];
    const winner = candidateMetrics.reduce((best, item) => !Number.isFinite(item.metric.sectionTime)
      ? best : !best || item.metric.sectionTime < best.metric.sectionTime ? item : best, null);
    const label=candidate.label||cornerLabel(candidate);
    return `<button class="corner-pick" data-corner-index="${index}" aria-label="${escapeUI(label)}" aria-pressed="false" title="${escapeUI(label)} · fastest ${winner?.lap.code || 'unavailable'}"><strong>${escapeUI(kind==='straight'?label.replace('Straight ',''):label)}</strong><small>${winner?.lap.code || '—'}</small></button>`;
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
        <span class="corner-time"><strong>${Number.isFinite(sectionTime) ? sectionTime.toFixed(3) : '—'}</strong></span>
        <span class="corner-delta ${deltaClass}"><strong>${Number.isFinite(toReference) ? signedDelta(toReference).replace(/s$/, '') : '—'}</strong></span>
        <span class="corner-speed"><strong>${Number.isFinite(item.metric.minimumSpeed) ? item.metric.minimumSpeed.toFixed(1) : '—'}</strong></span>
      </div>`;
  }).join('');

  updateCornerPicker(pickerRoot, `<section class="circuit-section-group"><header><h3>Corners</h3><span>Choose one or more</span></header><nav class="corner-picker" aria-label="Select one or more corners">${picker('corner')}</nav></section><section class="circuit-section-group"><header><h3>Straights</h3><span>≥100 m · low GPS curvature</span></header><nav class="corner-picker straight-zone-picker" aria-label="Select straight zones">${picker('straight')||'<small>No supported straight zones.</small>'}</nav></section><small class="corner-selection-note">Each corner runs from before the earliest braking point of the compared laps to after the last one is back at full throttle. Timestamp section times and the optional speed-correction diagnostic are different estimates, not isolated grip measurements. Links shorter than 100 m join adjacent corner windows; consecutive selected corners include their link; click any selected section to remove it.</small>`, selectedCornerIndices, automaticStraightIndices);
  const pickedCorners=pickedZones.filter(z=>z.kind==='corner').map(cornerLabel);
  const pickedStraights=pickedZones.filter(z=>z.kind!=='corner');
  const selectionLabel=combined?[...pickedCorners,...(pickedStraights.length?[`${pickedStraights.length} link${pickedStraights.length===1?'':'s'}`]:[])].join(' + '):zone.label||cornerLabel(zone);
  root.innerHTML = !pickedZones.length?'<div class="corner-selection-empty"><strong>Compare a section</strong><span>Select corners or straights above to inspect their times.</span></div>':`
    <article class="corner-detail-card">
      <header class="corner-detail-header">
        <div><strong>${escapeUI(selectionLabel)}</strong><small>${escapeUI(String(zone.type).toLowerCase())}${markers.some(marker => marker.approximate) ? ' · Approx. map position' : ''}${zone.boundaryMethod?' · '+escapeUI(zone.boundaryMethod):''}</small></div>
        <dl><div><dt>Measured distance</dt><dd>${zone.metres} m</dd></div>${averageSpeed?'':`<div><dt>Min-speed window</dt><dd>${zone.apexMetres} m</dd></div>`}</dl>
      </header>
      <div class="corner-table-head"><span>Driver</span>${[['time','Time','s'],['delta','Delta','s'],['minimum',averageSpeed?'Average speed':'Minimum','km/h']].map(([key,label,unit]) => `<button type="button" data-corner-sort="${key}" aria-pressed="${cornerSort === key}" title="Sort best to worst by ${label}">${label}${cornerSort === key ? ' ↓' : ''}<small>${unit}</small></button>`).join('')}</div>
      <div class="corner-driver-metrics">${rows||'<span class="section-empty">The selected sections have insufficient measured data. Remove a corner or choose another lap.</span>'}</div>
      ${referencePhases&&metrics.length>1?`<details class="corner-phase-evidence"><summary>Modelled entry / exit diagnostic</summary><p>Modelled, not measured: the same entry-speed correction and exit-speed credit the season cornering metric uses, applied to these laps. Separate from the measured section times above.</p>${rankedMetrics.map(item=>{const split=phaseSplit(item.lap);return split?`<div><b>${item.lap.code}</b>${split}</div>`:'';}).join('')}</details>`:''}
    </article>`;
  root.querySelectorAll('[data-corner-sort]').forEach(button => {
    button.onclick = () => { cornerSort = button.dataset.cornerSort; renderCornerAnalysis(); root.querySelector(`[data-corner-sort="${cornerSort}"]`)?.focus({ preventScroll: true }); };
  });
  pickerRoot.onclick = event => {
    const button = event.target.closest('[data-corner-index]');
    if (!button) return;
    const index=Number(button.dataset.cornerIndex)||0;
    if(selectedCornerIndices.has(index))selectedCornerIndices.delete(index);
    else selectedCornerIndices.add(index);
    if(zones[index].kind==='corner'){
      const linked=selectLinkingStraights(zones,selectedCornerIndices,automaticStraightIndices);
      selectedCornerIndices=linked.selection;automaticStraightIndices=linked.automatic;
    }else automaticStraightIndices.delete(index);
    renderCornerAnalysis();
    renderMiniSectorMap();
  };
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
    // ~4 Hz position feeds have occasional 1.2 s packets; longer holes are not bridged.
    if(dt <= 0 || dt > 1.6) return null;
  }
  const boundaries=[times[0],times[0]+times[1]];
  // DRS is only drawn up to 2025: the 2026 straight-mode state isn't in the public feed.
  const drsKnown=Number(sessionYear)<2026&&valid.some(p=>p.DRS!=null&&Number.isFinite(+p.DRS));
  const points=valid.map(p=>({x:p.X,y:p.Y,t:p.ElapsedSeconds,drs:drsKnown&&+p.DRS>=.5}));
  for(const t of boundaries) {
    const i=points.findIndex(p=>p.t>=t);
    if(i<1)return null;
    if(points[i].t===t)continue;
    const a=points[i-1],b=points[i],f=(t-a.t)/(b.t-a.t);
    points.splice(i,0,{x:a.x+(b.x-a.x)*f,y:a.y+(b.y-a.y)*f,t,drs:a.drs&&b.drs});
  }
  // The lap's fastest measured point, where the speed trap normally sits.
  const fastest=valid.filter(p=>Number.isFinite(+p.Speed)).reduce((best,p)=>!best||+p.Speed>+best.Speed?p:best,null);
  const distance=valid.at(-1).Distance;
  const markers=Number.isFinite(distance) && distance>0
    ? resolveCornerMarkers(valid,distance,suppliedCorners) : [];
  const mappedCorners=markers.map(c=>{
    const target=c.fraction*distance;
    const p=valid.reduce((best,p)=>Math.abs(p.Distance-target)<Math.abs(best.Distance-target)?p:best,valid[0]);
    return {...c,trackPosition:{x:p.X,y:p.Y}};
  });
  return {x:points.map(p=>p.x),y:points.map(p=>p.y),
    drs:drsKnown&&points.some(p=>p.drs)?points.map(p=>p.drs):null,
    topSpeed:fastest?{x:fastest.X,y:fastest.Y,speed:+fastest.Speed}:null,
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
  const light=lightThemeActive();
  const minX=Math.min(...raw.map(p=>p.x)),maxX=Math.max(...raw.map(p=>p.x));
  const minY=Math.min(...raw.map(p=>p.y)),maxY=Math.max(...raw.map(p=>p.y));
  const pad=Math.min(70,Math.max(38,rect.width*.09));
  const scale=Math.min((rect.width-pad*2)/(maxX-minX||1),(rect.height-pad*2)/(maxY-minY||1));
  const project=p=>({x:(p.x-(minX+maxX)/2)*scale+rect.width/2,y:(p.y-(minY+maxY)/2)*scale+rect.height/2});
  const geometry=raw.map(project);
  const centre=geometry.reduce((s,p)=>({x:s.x+p.x/geometry.length,y:s.y+p.y/geometry.length}),{x:0,y:0});
  const tangent=i=>{const a=geometry[Math.max(0,i-2)],b=geometry[Math.min(geometry.length-1,i+2)],l=Math.hypot(b.x-a.x,b.y-a.y)||1;return {x:(b.x-a.x)/l,y:(b.y-a.y)/l};};
  const nearestIndex=p=>{let best=0,dist=Infinity;geometry.forEach((g,i)=>{const d=Math.hypot(g.x-p.x,g.y-p.y);if(d<dist){dist=d;best=i;}});return best;};
  const occupied=[];
  const overlaps=box=>occupied.some(b=>box.x<b.x+b.width+3&&box.x+box.width+3>b.x&&box.y<b.y+b.height+3&&box.y+box.height+3>b.y);
  const inside=box=>box.x>=2&&box.y>=2&&box.x+box.width<=rect.width-2&&box.y+box.height<=rect.height-2;
  // Place a label beside the track along the outward normal (either side), never on it.
  const placeBeside=(i,width,height,distances)=>{
    const t=tangent(i),p=geometry[i],normal={x:-t.y,y:t.x};
    const outward=(p.x-centre.x)*normal.x+(p.y-centre.y)*normal.y>=0?1:-1;
    for(const d of distances)for(const side of [outward,-outward]){
      const cx=p.x+normal.x*d*side,cy=p.y+normal.y*d*side;
      const box={x:cx-width/2,y:cy-height/2,width,height};
      if(!inside(box)||overlaps(box)||trackIntersectsLabel(box,geometry,6))continue;
      occupied.push(box);return {x:cx,y:cy,box,anchor:p};
    }
    // Tight hairpins: fall back to the nearest free spot around the corner.
    for(const d of distances)for(let j=0;j<24;j++){
      const angle=j*Math.PI/12,cx=Math.max(width/2+2,Math.min(rect.width-width/2-2,p.x+Math.cos(angle)*d)),cy=Math.max(height/2+2,Math.min(rect.height-height/2-2,p.y+Math.sin(angle)*d));
      const box={x:cx-width/2,y:cy-height/2,width,height};
      if(overlaps(box)||trackIntersectsLabel(box,geometry,4))continue;
      occupied.push(box);return {x:cx,y:cy,box,anchor:p};
    }
    return null;
  };
  const trace=(from,to)=>{ctx.beginPath();for(let i=from;i<=to;i++){const p=geometry[i];i===from?ctx.moveTo(p.x,p.y):ctx.lineTo(p.x,p.y);}};
  ctx.clearRect(0,0,rect.width,rect.height);
  ctx.lineJoin='round';ctx.lineCap='round';
  // Track body: a dark road with a hairline edge so it reads on both appearances.
  trace(0,geometry.length-1);ctx.lineWidth=15;ctx.strokeStyle=light?'rgba(0,0,0,.18)':'rgba(255,255,255,.22)';ctx.stroke();
  trace(0,geometry.length-1);ctx.lineWidth=13;ctx.strokeStyle=light?'#2c2c30':'#0c0c0e';ctx.stroke();
  // Sector centre line, coloured per timing sector.
  const sectors=data.segmentSectors?.length===geometry.length-1?data.segmentSectors:null;
  for(let i=1;i<geometry.length;i++){
    ctx.beginPath();ctx.moveTo(geometry[i-1].x,geometry[i-1].y);ctx.lineTo(geometry[i].x,geometry[i].y);
    ctx.strokeStyle=sectors?GUIDE_SECTOR_COLORS[sectors[i-1]]:'#d0d0d6';ctx.lineWidth=3.2;ctx.stroke();
  }
  // DRS zones detected on this lap, as a dashed line beside the road.
  if(Array.isArray(data.drs)&&data.drs.length===geometry.length){
    ctx.save();ctx.setLineDash([5,4]);ctx.lineWidth=2;ctx.strokeStyle='#ff453a';ctx.lineCap='butt';
    let open=false;
    for(let i=1;i<geometry.length;i++){
      if(!(data.drs[i]&&data.drs[i-1])){if(open){ctx.stroke();open=false;}continue;}
      const t=tangent(i),side=((geometry[i].x-centre.x)*-t.y+(geometry[i].y-centre.y)*t.x)>=0?1:-1;
      const a={x:geometry[i-1].x-t.y*11*side,y:geometry[i-1].y+t.x*11*side},b={x:geometry[i].x-t.y*11*side,y:geometry[i].y+t.x*11*side};
      if(!open){ctx.beginPath();ctx.moveTo(a.x,a.y);open=true;}
      ctx.lineTo(b.x,b.y);
    }
    if(open)ctx.stroke();ctx.restore();
  }
  // Sector boundaries: short white ticks across the road.
  if(sectors)for(let i=1;i<sectors.length;i++){
    if(sectors[i]===sectors[i-1])continue;
    const t=tangent(i),p=geometry[i];
    ctx.beginPath();ctx.moveTo(p.x+t.y*9,p.y-t.x*9);ctx.lineTo(p.x-t.y*9,p.y+t.x*9);ctx.strokeStyle='#ffffff';ctx.lineWidth=2;ctx.lineCap='butt';ctx.stroke();
  }
  // Start/finish: a chequered block across the road plus a direction arrow.
  {
    const t=tangent(0),p=geometry[0],n={x:-t.y,y:t.x};
    ctx.save();ctx.translate(p.x,p.y);ctx.rotate(Math.atan2(n.y,n.x));
    const cell=3.2;
    for(let r=-4;r<4;r++)for(let c=0;c<2;c++){ctx.fillStyle=(r+c)%2?'#111':'#fff';ctx.fillRect(r*cell,(c-1)*cell,cell,cell);}
    ctx.restore();
    const side=((p.x-centre.x)*n.x+(p.y-centre.y)*n.y)>=0?1:-1;
    const base={x:p.x+n.x*17*side+t.x*2,y:p.y+n.y*17*side+t.y*2};
    ctx.beginPath();ctx.moveTo(base.x-t.x*8,base.y-t.y*8);ctx.lineTo(base.x+t.x*6,base.y+t.y*6);
    ctx.strokeStyle=light?'#1d1d1f':'#f2f2f4';ctx.lineWidth=1.6;ctx.stroke();
    ctx.beginPath();ctx.moveTo(base.x+t.x*9,base.y+t.y*9);ctx.lineTo(base.x+t.x*3-n.x*3.5,base.y+t.y*3-n.y*3.5);ctx.lineTo(base.x+t.x*3+n.x*3.5,base.y+t.y*3+n.y*3.5);ctx.closePath();
    ctx.fillStyle=light?'#1d1d1f':'#f2f2f4';ctx.fill();
    occupied.push({x:p.x-14,y:p.y-14,width:28,height:28});
  }
  ctx.textAlign='center';ctx.textBaseline='middle';
  // Turn numbers in circles beside the track.
  ctx.font=canvasFont(10,700);
  for(const corner of data.corners || []){
    const position=corner.trackPosition;
    if(!position||!Number.isFinite(Number(position.x))||!Number.isFinite(Number(position.y)))continue;
    const p=project({x:Number(position.x),y:-Number(position.y)}),label=cornerLabel(corner).replace(/^T/,'');
    const radius=Math.max(8.5,ctx.measureText(label).width/2+4);
    const spot=placeBeside(nearestIndex(p),radius*2,radius*2,[17,23,30,38,48]);
    if(!spot)continue;
    ctx.beginPath();ctx.arc(spot.x,spot.y,radius,0,Math.PI*2);
    ctx.fillStyle=light?'#ffffff':'#1c1c1e';ctx.fill();ctx.strokeStyle=light?'#1d1d1f':'#e5e5ea';ctx.lineWidth=1.2;ctx.stroke();
    ctx.fillStyle=light?'#1d1d1f':'#f2f2f4';ctx.fillText(label,spot.x,spot.y+.5);
  }
  // Sector names, boxed, beside the middle of each sector.
  if(sectors){
    ctx.font=canvasFont(10,700);
    [0,1,2].forEach(sector=>{
      const indices=sectors.map((s,i)=>s===sector?i:-1).filter(i=>i>=0);
      if(!indices.length)return;
      const label=`SECTOR ${sector+1}`,width=ctx.measureText(label).width+12;
      let spot=null;
      for(const fraction of [.5,.35,.65,.2,.8]){spot=placeBeside(indices[Math.floor(indices.length*fraction)],width,17,[24,34,46,60,76,94]);if(spot)break;}
      if(!spot)return;
      ctx.fillStyle=light?'#ffffff':'#f2f2f4';ctx.strokeStyle=GUIDE_SECTOR_COLORS[sector];ctx.lineWidth=1.5;
      ctx.beginPath();if(typeof ctx.roundRect==='function')ctx.roundRect(spot.box.x,spot.box.y,width,17,3);else ctx.rect(spot.box.x,spot.box.y,width,17);ctx.fill();ctx.stroke();
      ctx.fillStyle='#1d1d1f';ctx.fillText(label,spot.x,spot.y+.5);
    });
  }
  // Fastest point of this lap (where the speed trap normally sits).
  if(data.topSpeed&&Number.isFinite(+data.topSpeed.x)&&Number.isFinite(+data.topSpeed.y)){
    const p=project({x:+data.topSpeed.x,y:-+data.topSpeed.y});
    ctx.beginPath();ctx.arc(p.x,p.y,4.5,0,Math.PI*2);ctx.fillStyle='#ffd60a';ctx.fill();ctx.strokeStyle='#1d1d1f';ctx.lineWidth=1;ctx.stroke();
    ctx.font=canvasFont(10,600);
    const label=`TOP SPEED ${Math.round(data.topSpeed.speed)} km/h`,width=ctx.measureText(label).width+10;
    const spot=placeBeside(nearestIndex(p),width,16,[26,38,52,68,86,106]);
    if(spot){
      ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(spot.x,spot.y);ctx.strokeStyle='#ffd60a';ctx.lineWidth=1;ctx.stroke();
      ctx.fillStyle=light?'#1d1d1f':'#2c2c2e';ctx.beginPath();if(typeof ctx.roundRect==='function')ctx.roundRect(spot.box.x,spot.box.y,width,16,3);else ctx.rect(spot.box.x,spot.box.y,width,16);ctx.fill();
      ctx.fillStyle='#ffd60a';ctx.fillText(label,spot.x,spot.y+.5);
    }
  }
  ctx.textAlign='start';ctx.textBaseline='alphabetic';return true;
}

function circuitGuideContent() {
  const event=calendar.find(item=>item.name===sessionEventName);
  const sepang=isSepangCircuit(event);
  const samples=loaded.length?telemetryCache.get(telemetryKey(loaded[0])):null;
  const distance=samples?.at(-1)?.Distance;
  const markers=distance?resolveCornerMarkers(samples,distance,loaded[0]?.cornerMarkers):[];
  const zones=markers.length?sessionPerformanceZones(adaptiveCornerZones(markers),distance):[];
  const straights=zones.filter(z=>z.kind==='straight'&&z.end>z.start);
  const lap=loaded[0]?.real;
  const sectors=[lap?.s1,lap?.s2,lap?.s3].map(Number);
  let official='';
  if(sepang){
    official=`<div class="circuit-guide-source"><strong>Sepang · Pirelli track characteristics</strong><p>Lateral load: T5–T7 and T12–T13. Traction: the T2 exit. Braking: the approach to T15. These are qualitative circuit characteristics from Pirelli’s 2012 guide, not current-car g-force ratings.</p><a href="https://press.pirelli.com/the-malaysian-grand-prix-from-a-tyre-point-of-view/" target="_blank" rel="noopener">Pirelli corner guide · 22 Mar 2012</a></div>`;
    if(sessionYear===2026)official+=`<div class="circuit-guide-source"><strong>2026 tyre briefing</strong><p>Medium circuit-wide tyre stress; abrasive asphalt. Nominated compounds: C2 / C3 / C4.</p><a href="https://press.pirelli.com/tyre-compound-selections-for-baku-sepang-and-singapore/" target="_blank" rel="noopener">Pirelli preview · 27 Aug 2026</a></div>`;
  }
  return `<div class="circuit-guide-facts"><span><small>Measured lap</small><b>${distance?(distance/1000).toFixed(3)+' km':'Load a lap'}</b></span><span><small>Numbered corners</small><b>${markers.length|| (sepang?15:'Map annotations')}</b></span><span><small>Supported straight zones</small><b>${distance?straights.length:'Load telemetry'}</b></span></div>${sectors.every(t=>Number.isFinite(t)&&t>0)?`<p class="circuit-guide-sector-times">Reference lap sectors · S1 ${sectors[0].toFixed(3)} s · S2 ${sectors[1].toFixed(3)} s · S3 ${sectors[2].toFixed(3)} s</p>`:''}${official||'<p class="circuit-guide-sector-times">Map turn numbering and timing-derived sectors are shown where available. No verified Pirelli characteristic ratings are currently stored for this circuit; ratings are not inferred from lap speed.</p>'}<details><summary>What the guide describes</summary><p>Traction concerns acceleration out of corners; braking concerns deceleration demands; lateral load concerns turning. These describe a circuit, not a team ranking. GPS boundaries and corner centres are approximate.</p><a href="https://www.pirelli.com/global/en-ww/race/racingspot/formula-1/formula-1-for-dummies-the-choice-of-tyres-in-formula-1-53864/" target="_blank" rel="noopener">Pirelli’s circuit-characteristic definitions</a></details>`;
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
      canvas.setAttribute('aria-label',`${sessionEventName} circuit guide: sector 1 pink, sector 2 yellow, sector 3 blue, numbered turns, start/finish and direction${sessionSectorGuide.drs?', DRS zones dashed red':''}${sessionSectorGuide.topSpeed?', fastest point yellow':''}`);
      $('#dominanceLegend').innerHTML='<span class="guide-legend"><span><i style="background:#ff4081"></i>S1</span><span><i style="background:#e6bc24"></i>S2</span><span><i style="background:#40a9ed"></i>S3</span>'+(sessionSectorGuide.drs?'<span><i class="is-dashed"></i>DRS (this lap)</span>':'')+(sessionSectorGuide.topSpeed?'<span><i class="is-dot"></i>Top speed (this lap)</span>':'')+'</span><small class="explanation-only">Sector boundaries come from the official sector times matched to this lap\'s position telemetry'+(sessionSectorGuide.corners?.some(c=>c.approximate)?'; corner numbers use approximate official-map positions':'')+'.</small>';
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
  const event = calendar.find(item => item.name === sessionEventName);
  const sepang = isSepangCircuit(event);
  const id = sepang ? 'my-1999' : aliases.find(([term]) => name.includes(term))?.[1];
  const circuitKey = sepang ? null : sessionCircuitKey || event?.circuit_key
    || (name.includes('sakhir') && sessionYear === 2020 ? 148 : CIRCUIT_API_KEYS[id]);
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
  if (sepang) {
    const guide = {x:coords.map(p=>p[0]*Math.cos(latitude)),y:coords.map(p=>p[1]),
      corners:SEPANG_MAP_CORNERS.map(c=>({...c,trackPosition:{x:coords[c.outlineIndex][0]*Math.cos(latitude),y:coords[c.outlineIndex][1]}}))};
    drawApiCircuitGuide(ctx,guide,rect);
    canvas.setAttribute('aria-label','Sepang International Circuit, turns 1 to 15');
    $('#dominanceLegend').innerHTML = '<small>Sepang · <a href="https://www.sepangcircuit.com/media/wysiwyg/pdf/Daily_Safety_Briefing.pdf" target="_blank" rel="noopener">Official circuit turn numbering</a><br>Approximate corner positions on the circuit outline.</small>';
  } else if (id === 'es-2026' && sessionYear === 2026) {
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

function miniSectorBounds(totalDistance, fraction, segmentLength = 25) {
  const index = Math.max(0, Math.min(Math.ceil(totalDistance / segmentLength) - 1, Math.floor(fraction * totalDistance / segmentLength)));
  return {start: index * segmentLength / totalDistance, end: Math.min(1, (index + 1) * segmentLength / totalDistance)};
}

function miniSectorGeometryPoints(geometry, start, end, pointAt) {
  const points = [pointAt(start)];
  // Use the very same dense vertices as the outline, not coarser chords
  // which cut across bends and expose a false gap in the comparison layer.
  for (let index = Math.floor(start * geometry.length) + 1; index < end * geometry.length; index++) {
    points.push(geometry[index]);
  }
  points.push(pointAt(end));
  return points;
}

function miniSectorDominanceSegments(series, totalDistance, segmentLength = 25) {
  if (!(totalDistance > 0) || !(segmentLength > 0)) return [];
  return Array.from({length: Math.ceil(totalDistance / segmentLength)}, (_, index) => {
    const start = index * segmentLength / totalDistance;
    const end = Math.min(1, (index + 1) * segmentLength / totalDistance);
    const durations = series.map(samples => {
      if (typeof performanceSectionDuration === 'function') return performanceSectionDuration(samples, start, end);
      const before = calibratedElapsed(samples, start), after = calibratedElapsed(samples, end);
      return before == null || after == null ? null : after - before;
    });
    const comparable = durations.length >= 2 && durations.every(time => Number.isFinite(time) && time > 0);
    return {start, end, durations, winner: comparable ? durations.indexOf(Math.min(...durations)) : -1};
  });
}

function renderMiniSectorMap() {
  mapStaticLayer=null;
  const canvas = $('#dominanceCanvas');
  const empty = $('#dominanceEmpty');
  const legend = $('#dominanceLegend');
  const title = $('#dominanceTitle');
  if (!canvas || !empty || !legend || !title) return;
  if ($('#cornerAnalysis')?.hidden) return;
  if (!loaded.length) mapView = 'guide';
  const guideDetails=$('#circuitGuideDetails');
  if(guideDetails){
    guideDetails.hidden=mapView!=='guide'||!sessionEventName;
    guideDetails.innerHTML=guideDetails.hidden?'':circuitGuideContent();
  }
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
  const reference = spatial?.samples;
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
  const markerCorners = resolveCornerMarkers(reference, totalDistance, spatial?.lap?.cornerMarkers);
  let highlightedCornerWindows = [];
  if (typeof adaptiveCornerZones === 'function') {
    highlightedCornerWindows = selectedCornerWindows(sessionPerformanceZones(adaptiveCornerZones(markerCorners), totalDistance));
  }

  // Paint the selected union behind the track, not over dominance colours.
  ctx.save();
  ctx.strokeStyle = theme.labelFill;
  ctx.globalAlpha = .65;
  ctx.lineWidth = 11;
  for (const window of highlightedCornerWindows) {
    ctx.beginPath();
    miniSectorGeometryPoints(canvasGeometry, window.start, window.end, pointAt).forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.stroke();
  }
  ctx.restore();

  let unavailableSegments = 0;
  if (comparative) {
    for (const {start, end, winner} of miniSectorDominanceSegments(allSeries, totalDistance)) {
      if (winner < 0) { unavailableSegments++; continue; }
      ctx.strokeStyle = getLapColor(mapEntries[winner].lap);
      ctx.lineWidth = 7;
      ctx.beginPath();
      miniSectorGeometryPoints(canvasGeometry, start, end, pointAt).forEach((point, index) => {
        if (index === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      });
      ctx.stroke();
    }
  }

  if (highlightedCornerWindows.length) {
    ctx.save();
    for (const fraction of highlightedCornerWindows.flatMap(window => [window.start, window.end])) {
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
    ctx.font = canvasFont(12, 500);
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
      ctx.fillStyle = theme.labelFill;
      ctx.fillText(label, placement.x, placement.y);
    });
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
  }

  // Ball Tracker indicator when hovering (telemetry charts or track map)
  const staticMap=document.createElement('canvas');staticMap.width=canvas.width;staticMap.height=canvas.height;
  staticMap.getContext('2d').drawImage(canvas,0,0);
  mapStaticLayer={image:staticMap,canvas,rect,dpr,pointAt,color:getLapColor(mapEntries[0].lap)};
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
  const legendIndexes = comparative ? mapEntries.map((_, index) => index) : [0];
  legend.innerHTML = `<span class="map-north" aria-label="North is up"><svg viewBox="0 0 16 20" width="12" height="16" aria-hidden="true"><path d="M8 1 14 18 8 14 2 18Z" fill="currentColor"/></svg>N</span>${windText}` + legendIndexes.map(index => {
    const lap = mapEntries[index]?.lap;
    if (!lap) return '';
    return `<span class="legend-item"><i class="legend-color" style="--team:${getLapColor(lap)}"></i>${lap.code} L${lap.lap}</span>`;
  }).join('') + (unavailableSegments ? `<span class="legend-item" title="Every selected lap needs a supported positive timing for a segment to be compared.">${unavailableSegments} segments unavailable · grey</span>` : '');
}

function drawMapHover() {
  if(!mapStaticLayer)return;
  const {canvas,image,dpr,pointAt,color}=mapStaticLayer,ctx=canvas.getContext('2d');
  ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0);ctx.setTransform(dpr,0,0,dpr,0,0);
  if(hoverFraction===null)return;
  const point=pointAt(hoverFraction);if(!point)return;
  ctx.fillStyle=hexToRgba(color,.35);ctx.beginPath();ctx.arc(point.x,point.y,10,0,2*Math.PI);ctx.fill();
  ctx.fillStyle=lightThemeActive()?'#161b22':'#fff';ctx.strokeStyle=color;ctx.lineWidth=2;ctx.beginPath();ctx.arc(point.x,point.y,4.5,0,2*Math.PI);ctx.fill();ctx.stroke();
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
  function descriptions(value) {
    document.body.classList.toggle('is-descriptions-hidden',!value);
    const toggle=$('#explanationsToggle');toggle?.setAttribute('aria-pressed',String(value));
    if(toggle)toggle.querySelector('span').textContent=value?'Hide explanations':'Show explanations';
  }
  descriptions(window.ApexAnalysis?.preference('descriptions',false)===true);
  $('#explanationsToggle')?.addEventListener('click',()=>{
    const value=document.body.classList.contains('is-descriptions-hidden');
    window.ApexAnalysis?.savePreference('descriptions',value);descriptions(value);
    window.dispatchEvent(new CustomEvent('apex-descriptions',{detail:value}));
  });
  window.addEventListener('apex-descriptions',event=>descriptions(event.detail===true));
  const definitions=$('#performanceDefinitions');
  if(definitions&&window.ApexAnalysis)definitions.innerHTML=Object.values(window.ApexAnalysis.definitions).map(d=>`<dt>${d.title}</dt><dd>${d.description}</dd>`).join('');
  window.addEventListener('pointerup', finishZoomDrag);
  applyTheme(document.documentElement.dataset.theme, false);
  document.querySelectorAll('.select-shell select').forEach(enhanceSelect);
  window.addEventListener('resize', () => document.querySelectorAll('.select-shell.is-open').forEach(positionSelectMenu));
  window.addEventListener('scroll', event => {
    if (event.target.closest?.('.select-menu')) return;
    document.querySelectorAll('.select-shell.is-open').forEach(positionSelectMenu);
  }, true);
  document.addEventListener('click', event => {
    if (event.target.closest('.select-shell')) return;
    document.querySelectorAll('.select-shell.is-open').forEach(shell => {
      closeSelectMenu(shell);
    });
  });
  const yearSelect = $('#year');
  const currentYear = new Date().getFullYear();
  const years = [];
  for (let y = currentYear; y >= 2018; y--) {
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
  $('#lapWorkspaceToggle')?.addEventListener('click', event => {
    setLapSelectionExpanded(event.currentTarget.getAttribute('aria-expanded') !== 'true');
  });
  const cornerAnalysis = $('#cornerAnalysis');
  if (cornerAnalysisToggle && cornerAnalysis) {
    cornerAnalysisToggle.addEventListener('click', () => {
      const collapsed = cornerAnalysis.classList.toggle('is-collapsed');
      $('#cornerWorkspace').inert = collapsed;
      cornerAnalysisToggle.setAttribute('aria-expanded', String(!collapsed));
    });
    cornerAnalysis.addEventListener('transitionend', event => {
      if (event.propertyName === 'grid-template-rows' && !cornerAnalysis.classList.contains('is-collapsed')) renderMiniSectorMap();
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
  
  card.style.display = '';
  
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
