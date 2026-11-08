/* Compute on this PC, from the published site. The site always shows what is already published or saved; anything not
   calculated yet is calculated by the compute service on the person's own PC (start-local.cmd or the installed
   launcher), which the page reaches at 127.0.0.1 once the person has chosen "Use this PC" in Compute settings.

   - Nothing on the PC is contacted until the person has chosen it (a public page reaching this PC needs the browser's
     local network permission, so other visitors are never asked).
   - After that, each visit checks the service quickly before the first data request (window.apexComputeReady), so
     requests go to the PC from the start. While a page uses it, a lease keeps the service from stopping.
   - The PC's address is the only setting: window.APEX_COMPUTE_ORIGIN is set while the service answers; session-state.js
     sends data requests there, live.js starts once it is set ('apex-compute' event). */
(() => {
  // The service's address; tests and a second service on another port can override it before this script runs.
  const COMPUTE = String(window.APEX_LOCAL_COMPUTE_ORIGIN || 'http://127.0.0.1:54123').replace(/\/$/, ''), KEY = 'apex-compute';
  const choice = value => { try { if (value) localStorage.setItem(KEY, value); return localStorage.getItem(KEY); } catch { return null; } };
  const panel = document.getElementById('computeSettings'), trigger = document.querySelector('[popovertarget="computeSettings"]');
  const $ = name => panel?.querySelector(`[data-compute-${name}]`);
  let watching = null, lease = null;

  function show(state, text) {
    if (!panel) return;
    panel.dataset.state = state;
    trigger?.setAttribute('data-compute', state);
    if (trigger) trigger.title = state === 'local' ? 'Compute: this PC' : 'Compute settings';
    $('status').textContent = text;
    $('use').hidden = state === 'local' || state === 'checking';
    $('start').hidden = state !== 'offline';
    $('off').hidden = !(state === 'local' || state === 'offline');
  }
  async function reachable(timeout = 1500) {
    try {
      const r = await fetch(COMPUTE + '/api/local-status', {signal: AbortSignal.timeout(timeout), credentials: 'omit'});
      const data = await r.json();
      return r.ok && data.mode === 'local';
    } catch { return false; }
  }
  function hold() {
    // A lease keeps an auto-stopping service running while this page is open; the stream ends it when the page closes.
    if (lease || typeof EventSource !== 'function') return;
    const id = crypto.randomUUID();
    fetch(COMPUTE + '/api/local-tab', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({id, action: 'open'}), credentials: 'omit'})
      .then(() => { lease = new EventSource(COMPUTE + '/api/local-tab-stream?id=' + encodeURIComponent(id)); }).catch(() => {});
  }
  function connected() {
    window.APEX_COMPUTE_ORIGIN = COMPUTE;
    show('local', 'Using this PC. Published data is shown first; anything not published yet is calculated on this PC and kept in its cache.');
    hold();
    window.dispatchEvent(new CustomEvent('apex-compute', {detail: COMPUTE}));
  }
  async function connect({quiet = false} = {}) {
    if (!quiet) show('checking', 'Looking for compute on this PC…');
    if (await reachable()) { connected(); return true; }
    show('offline', 'Compute is not running on this PC. Start it with the installed launcher (or start-local.cmd); this page connects as soon as it answers.');
    return false;
  }

  if (!panel) { window.apexComputeReady = Promise.resolve(false); return; }
  show('off', 'Showing published data. To calculate sessions that are not published yet, run compute on your PC.');
  // The first data request waits for this check (at most 1.5 s), so it goes to the PC from the start.
  window.apexComputeReady = choice() === 'local' ? connect({quiet: true}) : Promise.resolve(false);

  $('use').addEventListener('click', () => { choice('local'); void connect(); });
  $('off').addEventListener('click', () => {
    choice('off');
    // Requests already made went to the PC; reloading starts again from published data only.
    location.reload();
  });
  $('start').addEventListener('click', () => {
    // The link opens the installed launcher (the browser asks first); then wait for the service to answer.
    clearInterval(watching);
    const deadline = Date.now() + 120000;
    show('offline', 'Starting compute on this PC… approve the browser prompt if one appears.');
    watching = setInterval(async () => {
      if (await reachable()) { clearInterval(watching); connected(); return; }
      if (Date.now() > deadline) { clearInterval(watching); show('offline', 'Compute did not answer. Run start-local.cmd on this PC, then choose Use this PC again.'); }
    }, 1500);
  });
})();
