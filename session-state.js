/* Session analysis: shared state, data requests, caching and small utilities. */
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
// Query of the session actually loaded (not the selectors awaiting "Load session").
let loadedSessionQuery = '';
let restoringSessionUrl = false;
let calendarReady = null;
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
// Settled car-performance data pre-rendered at build time (scripts/prerender.mjs).
// Used only when it was computed with this page's methodology revision.
let prerenderedIndex = null;
const PRERENDERED_PATHS = new Set(['/api/performance', '/api/performance/trace-batch', '/api/performance/pits', '/api/performance/sprint']);
function prerenderedKey(parsed) {
  // Same identity as lib/data-cache.mjs normalizeDataPath for these paths.
  const query = new URLSearchParams(parsed.search);
  for (const key of ['fresh', 'refresh', '_t', 't']) query.delete(key);
  query.sort();
  return parsed.pathname + '?' + query;
}
async function prerenderedData(parsed) {
  if (!PRERENDERED_PATHS.has(parsed.pathname) || typeof DecompressionStream === 'undefined') return null;
  prerenderedIndex ||= fetch('assets/data/prerendered/index.json').then(r => r.ok ? r.json() : null).catch(() => null);
  const index = await prerenderedIndex;
  if (!index || index.revision !== window.APEX_BACKEND_VERSION) return null;
  const file = index.entries?.[prerenderedKey(parsed)];
  if (!file) return null;
  const response = await fetch(`assets/data/prerendered/${file}`);
  if (!response.ok || !response.body) return null;
  return new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).json();
}
async function preparedData(url) {
  const parsed = new URL(url, window.location?.href || 'http://localhost');
  const prerendered = await prerenderedData(parsed).catch(() => null);
  if (prerendered) return prerendered;
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
