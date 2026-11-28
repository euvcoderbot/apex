/* Live timing view: needs compute on this PC. The page talks to the PC's live service (/api/live/*), which reads F1's
   live feed with the user's own F1 TV sign-in, or replays a cached session through the same pipeline. On the published
   site it starts once the person has connected their PC (local-compute.js); before that it does nothing. All
   data-derived text is set with textContent. */
(() => {
  if (!window.APEX_LOCAL_MODE && !window.APEX_COMPUTE_ORIGIN) {
    // Not connected yet: run this script again once the PC's compute answers.
    const src = document.currentScript?.src;
    if (src) addEventListener('apex-compute', () => { const again = document.createElement('script'); again.src = src; document.body.append(again); }, {once: true});
    return;
  }
  if (window.ApexLive) return;
  // The PC's compute service, or this page's own origin when the PC serves it.
  const base = String(window.APEX_COMPUTE_ORIGIN || '').replace(/\/$/, '');
  // The email and password form only appears on a page this PC serves; elsewhere sign-in happens on Formula 1's own page.
  const passwordSignin = !base;
  const assetVersion = document.currentScript?.src.match(/\?v=[^&#]+/)?.[0] || '';
  // Its stylesheet ships separately (the published page never loads it), with this script's version.
  {
    for (const sheet of ['live.css', 'live-linear.css']) {
      const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = sheet + assetVersion;
      document.head.append(link);
    }
  }
  const $ = (scope, name) => scope.querySelector(`[data-live="${name}"]`);
  const SPEEDS = [1, 2, 5, 10, 30, 60];
  const TYRES = {SOFT: ['S', '#ff3b30'], MEDIUM: ['M', '#ffd60a'], HARD: ['H', '#f2f2f7'], INTERMEDIATE: ['I', '#34c759'], WET: ['W', '#0a84ff']};
  const FLAGS = {'2': 'yellow', '4': 'sc', '5': 'red', '6': 'vsc', '7': 'vsc'};
  let page, button, stream, statusTimer, active = false;
  let state = null, source = null, outline = null, telemetry = {}, bounds = null;
  const chosen = [];
  let lapLists = {}, compareTraces = [], lapsFetchedAt = 0, compareKey = '', currentLaps = null;
  let compareRequest = null, compareRetryAt = 0, compareRetryTimer = null;
  // The laps being compared: [{driver, lap}] where lap is 'latest', 'fastest', 'last' or a lap number. The first is the reference.
  let picks = [];
  const MAX_PICKS = 4;
  let drawQueued = false;

  const api = (path, options = {}) => fetch(base + '/api/live/' + path, {cache: 'no-store', ...options}).then(async r => {
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.detail || `Live service error ${r.status}`);
    return body;
  });
  const post = (path, body) => api(path, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body || {})});
  const el = (tag, cls, text) => { const node = document.createElement(tag); if (cls) node.className = cls; if (text != null) node.textContent = text; return node; };
  const colour = driver => (driver.color && (window.apexTeamColour?.(driver.color) || driver.color)) || '#8e8e93';

  // ---------- page ----------
  function build() {
    page = document.createElement('section');
    page.id = 'liveTiming'; page.className = 'live-page'; page.hidden = true; page.tabIndex = -1;
    page.setAttribute('aria-label', 'Live timing');
    // Static authored markup only.
    page.innerHTML = `
      <header class="live-head">
        <div class="live-title"><span class="workspace-eyebrow">LIVE TIMING</span><h1 data-live="title">No session running</h1><p data-live="subtitle">Connect during a session, or replay one from this PC's cache.</p></div>
        <div class="live-meta">
          <span class="live-badge" data-live="badge">Idle</span>
          <span class="live-chip" data-live="lap" hidden></span>
          <span class="live-chip" data-live="clock" hidden></span>
        </div>
      </header>
      <div class="live-flag" data-live="flag" role="status" aria-live="polite" hidden></div>
      <section class="dashboard-card live-source" aria-label="Data source">
        <div class="live-source-row">
          <div class="live-source-group live-connect" role="group" aria-label="Live">
            <button type="button" class="live-button live-primary" data-live="connect">Connect</button>
            <span class="live-auth" data-live="auth"></span>
            <button type="button" class="live-button" data-live="signin" aria-expanded="false" aria-controls="liveSignin">Sign in to F1 TV</button>
            <button type="button" class="live-button live-quiet" data-live="signout" hidden>Sign out</button>
          </div>
          <div class="live-source-group live-source-actions">
            <button type="button" class="live-button" data-live="stop" hidden>Stop replay</button>
            <button type="button" class="live-button" data-live="replaySettings" aria-expanded="false" aria-controls="liveReplaySettings">Replay</button>
          </div>
        </div>
        <div id="liveReplaySettings" class="live-source-group live-replay" role="group" aria-label="Replay settings" hidden>
          <select id="liveReplay" data-live="replay" aria-label="Session to replay"></select>
          <select id="liveSpeed" data-live="speed" aria-label="Replay speed"></select>
          <label class="live-from">Start at <input data-live="from" type="number" min="0" step="5" value="0" inputmode="numeric" aria-label="Start minutes into the session"> min</label>
          <button type="button" class="live-button" data-live="play">Play replay</button>
        </div>
        <form id="liveSignin" class="live-signin" data-live="signinForm" hidden>
          <label>F1 TV email <input name="email" type="email" autocomplete="username" required></label>
          <label>Password <input name="password" type="password" autocomplete="current-password" required></label>
          <button type="submit" class="live-button live-primary">Sign in</button>
          <button type="button" class="live-button" data-live="signinCancel">Cancel</button>
          <span class="live-signin-or">or</span>
          <button type="button" class="live-button" data-live="signinBrowser">Sign in with browser</button>
          <p class="live-signin-note">Email and password go only to the local app on this PC, which passes them to FastF1's sign-in with Formula 1; only the resulting token is kept. If Formula 1 rejects them, use Sign in with browser: you sign in on Formula 1's own page, and FastF1's Companion browser add-on (offered on that page the first time) hands the sign-in to this PC.</p>
          <p class="live-signin-note" data-live="browserWaiting" hidden>Waiting for the browser sign-in… finish it in the tab that opened. <a data-live="browserLink" target="_blank" rel="noopener">Open the sign-in page again</a></p>
          <p class="live-signin-error" data-live="signinError" role="alert" hidden></p>
        </form>
        <p class="live-help" data-live="help" hidden></p>
        <div class="live-seek" data-live="seek" hidden>
          <div class="live-progress" data-live="progress" role="slider" tabindex="0" aria-label="Replay position: select to jump there" aria-valuemin="0" aria-valuemax="100"><span></span></div>
          <select data-live="jumpLap" aria-label="Jump to a lap"></select>
        </div>
      </section>
      <nav class="live-tower-mode" aria-label="Live workspace" data-ui-group="segments">
        <button type="button" data-live-workspace="timing" aria-pressed="true">Timing and strategy</button>
        <button type="button" data-live-workspace="laps" aria-pressed="false">Completed laps</button>
        <button type="button" data-live-workspace="telemetry" aria-pressed="false">Current telemetry</button>
      </nav>
      <div class="live-grid" data-workspace="timing">
        <div class="live-col live-col-main">
          <section class="dashboard-card live-tower" aria-label="Timing tower">
            <div class="live-card-head"><h2>Timing</h2><small>Select a best time to compare laps</small><div class="live-tower-mode" data-ui-group="segments" role="group" aria-label="Sector times"><button type="button" data-live="towerLive" aria-pressed="true">Live</button><button type="button" data-live="towerBest" aria-pressed="false">Best</button></div></div>
            <div class="live-table-wrap"><table class="live-table">
              <thead><tr><th scope="col">P</th><th scope="col">Driver</th><th scope="col">Best lap</th><th scope="col">Gap</th><th scope="col">Int</th><th scope="col">Last</th><th scope="col">S1</th><th scope="col">S2</th><th scope="col">S3</th><th scope="col">Tyre</th><th scope="col">Pit</th></tr></thead>
              <tbody data-live="tower"><tr><td colspan="11" class="live-empty">Waiting for timing data.</td></tr></tbody>
            </table></div>
          </section>
        <section class="dashboard-card live-engineer" data-live="engineer" aria-label="Race strategy" hidden>
          <div class="live-card-head"><h2>Race strategy</h2><small>From timing gaps and completed laps</small></div>
          <div class="live-engineer-tiles" data-live="engineerTiles"></div>
          <div class="live-table-wrap"><table class="live-table live-engineer-table">
            <thead><tr><th scope="col" class="num">P</th><th scope="col">Driver</th><th scope="col">Tyre</th><th scope="col" class="num">Pace</th><th scope="col" class="num">Trend</th><th scope="col" class="num">Gap</th><th scope="col" class="num">Int</th><th scope="col" class="num">Pit now</th></tr></thead>
            <tbody data-live="engineerRows"></tbody>
          </table></div>
          <p class="live-note explanation-only">Pace: mean of the last three clean laps. Trend: seconds a lap against the leader over the same laps (negative is catching). Pit now: where the car would rejoin, from the pit loss measured at this race's stops (in-lap plus out-lap minus two clean laps).</p>
        </section>
        <section class="dashboard-card live-compare" aria-label="Compare completed laps">
          <div class="live-card-head">
            <div class="live-card-title"><h2>Compare laps</h2><small data-live="lapsNote"></small></div>
            <div class="live-card-actions">
              <button type="button" class="live-button live-primary-compare" data-live="quickFastest" disabled>Compare selected fastest laps</button>
              <button type="button" class="live-button" data-live="backfill" title="Load earlier laps from Formula 1’s archive">Load earlier laps</button>
              <button type="button" class="live-button" data-live="sessionAnalysis" hidden>Open in Session analysis</button>
            </div>
          </div>
          <div class="live-lapchart" data-live="lapChart">
            <div class="live-chart-drivers" data-live="chartDrivers" role="group" aria-label="Drivers to compare"></div>
          </div>
          <div class="comparison-tray live-comparison-tray" aria-label="Loaded comparison laps">
            <div class="live-lap-chips loaded-laps" data-live="lapChips" role="list" aria-label="Laps being compared"></div>
          </div>
          <details class="live-lap-history">
            <summary>Lap history</summary>
            <div class="live-chart-actions">
              <button type="button" class="live-button" data-live="chartSlow" aria-pressed="false">Show slow laps</button>
              <button type="button" class="live-button" data-live="chartList" aria-pressed="false">Lap list</button>
            </div>
            <div class="live-chart-plot" data-live="chartPlot"></div>
            <div class="tooltip overview-tip live-chart-card" data-live="chartCard" role="tooltip" hidden></div>
            <div class="live-lap-list-wrap" data-live="lapList" hidden></div>
          </details>
          <div class="live-sector-table" data-live="sectorTable"></div>
          <p class="live-note" data-live="traceStatus" role="status" hidden></p>
          <div class="live-lap-picker" id="liveLapPicker" data-live="lapPicker" popover="auto" aria-label="Choose a lap">
            <div class="live-picker-head"><strong data-live="pickerTitle">Add a lap</strong><button type="button" class="live-picker-close" data-live="pickerClose" aria-label="Close">×</button></div>
            <div class="live-picker-drivers" data-live="pickerDrivers" role="group" aria-label="Driver"></div>
            <div class="live-picker-laps" data-live="pickerLaps" role="group" aria-label="Lap"></div>
          </div>
          <div class="live-charts" data-live="compareCharts" role="region" aria-label="Completed lap telemetry"></div>
        </section>
        </div>
        <div class="live-col live-col-side">
          <section class="dashboard-card live-map-card" aria-label="Track map">
            <div class="live-card-head"><h2>Track</h2><small data-live="mapnote">Learning the circuit from car positions</small></div>
            <canvas data-live="map" role="img" aria-label="Car positions on track"></canvas>
          </section>
          <section class="dashboard-card live-telemetry-card" aria-label="Live telemetry">
            <div class="live-card-head"><h2>Telemetry</h2><small data-live="telenote">Current lap</small></div>
            <div class="live-chart-drivers" data-live="traceDrivers" role="group" aria-label="Current telemetry drivers"></div>
            <div class="live-readouts" data-live="readouts"></div>
            <div class="live-charts" data-live="traceCharts" role="region" aria-label="Current lap telemetry"></div>
          </section>
          <section class="dashboard-card live-side" aria-label="Race control and weather">
            <div class="live-card-head"><h2>Conditions</h2></div>
            <dl class="live-weather" data-live="weather"></dl>
            <div class="live-card-head"><h2>Race control</h2></div>
            <ol class="live-rc" data-live="rc"><li class="live-empty">No messages yet.</li></ol>
          </section>
        </div>
      </div>`;
    const anchor = document.getElementById('carPerformance');
    (anchor || document.querySelector('main#top')).after(page);
    const speed = $(page, 'speed');
    for (const value of SPEEDS) speed.append(new Option(value + '×', value, value === 10, value === 10));
    $(page, 'connect').addEventListener('click', () => start({mode: 'live'}));
    $(page, 'signin').addEventListener('click', () => showSignin($(page, 'signinForm').hidden));
    $(page, 'signinCancel').addEventListener('click', () => showSignin(false));
    $(page, 'signinBrowser').addEventListener('click', signInWithBrowser);
    $(page, 'signinForm').addEventListener('submit', submitSignin);
    $(page, 'signout').addEventListener('click', signOut);
    $(page, 'replaySettings').addEventListener('click', event => {
      const settings = page.querySelector('#liveReplaySettings');
      settings.hidden = !settings.hidden;
      event.currentTarget.setAttribute('aria-expanded', String(!settings.hidden));
    });
    $(page, 'play').addEventListener('click', () => {
      const path = $(page, 'replay').value; if (!path) return;
      start({mode: 'replay', path, speed: Number(speed.value), start: Math.max(0, Number($(page, 'from').value) || 0) * 60});
    });
    $(page, 'stop').addEventListener('click', () => post('stop').then(applyStatus).catch(showError));
    // Seek: restart the same replay at the chosen point and speed (everything before it is applied at once).
    const seekTo = seconds => { const path = source?.path || $(page, 'replay').value; if (!path || !Number.isFinite(seconds)) return; start({mode: 'replay', path, speed: Number(speed.value), start: Math.max(0, seconds)}); };
    $(page, 'progress').addEventListener('click', event => { const r = event.currentTarget.getBoundingClientRect(); seekTo((event.clientX - r.left) / r.width * (source?.duration || 0)); });
    $(page, 'progress').addEventListener('keydown', event => {
      const step = {ArrowRight: 60, ArrowLeft: -60, PageUp: 300, PageDown: -300}[event.key];
      if (step) { event.preventDefault(); seekTo((source?.position || 0) + step); }
    });
    $(page, 'jumpLap').addEventListener('change', event => { const at = Number(event.target.value); if (Number.isFinite(at)) seekTo(at - 5); event.target.value = 'none'; window.syncSelectUI?.(event.target); });
    $(page, 'tower').addEventListener('click', event => {
      const row = event.target.closest('tr[data-number]'); if (!row) return;
      if (event.target.closest('[data-compare-best]')) { compareBest(row.dataset.number); return; }
      toggleDriver(row.dataset.number);
    });
    $(page, 'tower').addEventListener('keydown', event => {
      if (event.target.closest('button')) return;
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const row = event.target.closest('tr[data-number]'); if (!row) return;
      event.preventDefault(); toggleDriver(row.dataset.number);
    });
    new ResizeObserver(() => queueDraw()).observe(page);
    $(page, 'quickFastest').addEventListener('click', compareSelectedBest);
    $(page, 'sessionAnalysis').addEventListener('click', openSessionAnalysis);
    // Sector columns: the current lap's sectors (with mini-sectors), or each driver's best sectors of the session.
    for (const [name, best] of [['towerLive', false], ['towerBest', true]]) $(page, name).addEventListener('click', () => {
      towerBest = best; $(page, 'towerLive').setAttribute('aria-pressed', String(!best)); $(page, 'towerBest').setAttribute('aria-pressed', String(best)); renderTower();
    });
    for (const button of page.querySelectorAll('[data-live-workspace]')) {
      button.addEventListener('click', () => showWorkspace(button.dataset.liveWorkspace));
    }
    page.querySelector('.live-lap-history').addEventListener('toggle', renderLapChart);
    $(page, 'chartSlow').addEventListener('click', () => { chartSlow = !chartSlow; renderLapChart(); });
    $(page, 'chartList').addEventListener('click', () => { chartList = !chartList; renderLapChart(); });
    if (typeof ResizeObserver === 'function') new ResizeObserver(() => requestAnimationFrame(() => renderLapChart())).observe($(page, 'chartPlot'));
    $(page, 'pickerClose').addEventListener('click', () => $(page, 'lapPicker').hidePopover?.());
    $(page, 'lapChips').addEventListener('click', event => {
      const reference = event.target.closest('[data-reference]');
      if (reference) {
        const [pick] = picks.splice(Number(reference.dataset.reference), 1);
        if (pick) { picks.unshift(pick); renderChips(); loadCompare(); renderLapChart(); }
        return;
      }
      const remove = event.target.closest('[data-remove]');
      if (remove) { picks.splice(Number(remove.dataset.remove), 1); renderChips(); loadCompare(); renderLapChart(); return; }
      const chip = event.target.closest('[data-pick]');
      if (chip) openPicker(chip, chip.dataset.pick === 'add' ? null : Number(chip.dataset.pick));
    });
  }

  function showWorkspace(name) {
    page.querySelector('.live-grid').dataset.workspace = name;
    for (const option of page.querySelectorAll('[data-live-workspace]')) option.setAttribute('aria-pressed', String(option.dataset.liveWorkspace === name));
    requestAnimationFrame(() => { renderLapChart(); queueDraw(); });
    if (name === 'laps') void loadCompare();
  }

  function buildButton() {
    button = document.createElement('button');
    button.type = 'button'; button.id = 'liveViewButton'; button.className = 'live-view-button';
    button.setAttribute('aria-pressed', 'false'); button.title = 'Live timing';
    button.innerHTML = '<span class="live-dot" aria-hidden="true"></span><span class="live-view-label">Live</span>';
    button.addEventListener('click', () => (active ? null : enter()));
  }

  // In the header's tab list the button is one more tab (aria-selected); in the Linear rail it is a toggle (aria-pressed).
  function mark(on) {
    if (button.closest('.performance-tabs')) {
      button.setAttribute('role', 'tab'); button.removeAttribute('aria-pressed'); button.setAttribute('aria-selected', String(on));
    } else {
      button.removeAttribute('role'); button.removeAttribute('aria-selected'); button.setAttribute('aria-pressed', String(on));
    }
  }

  // macOS look: a pill beside the view tabs. Linear look: a row in the rail's Analysis section.
  function place() {
    const rail = document.querySelector('#linearWorkspace .linear-navigation');
    if (rail) rail.append(button);
    // macOS look: the third segment of the view tabs (Session analysis · Car performance · Live), not a separate pill.
    else (document.querySelector('.site-header .performance-tabs') || document.querySelector('.site-header .header-actions'))?.append(button);
    mark(active);
  }

  // ---------- entering and leaving the view ----------
  function enter() {
    active = true;
    document.querySelectorAll('[data-analysis-view]').forEach(tab => tab.setAttribute('aria-selected', 'false'));
    document.body.classList.add('live-view');
    page.hidden = false; mark(true);
    const title = document.getElementById('windowTitle'), subtitle = document.getElementById('windowSubtitle');
    // The breadcrumb reads like the other views' ("Session analysis › Compare laps"): Live › Timing, or Live › Replay.
    if (title) title.textContent = source?.kind === 'replay' ? 'Replay' : 'Timing';
    if (subtitle) subtitle.textContent = 'Live';
    document.body.dataset.view = 'live';
    refreshStatus(); connect(); queueDraw();
    page.focus({preventScroll: true});
  }
  function leave() {
    if (!active) return;
    active = false;
    document.body.classList.remove('live-view');
    page.hidden = true; mark(false);
    disconnect();
  }
  // Any of the existing view tabs takes the page back; their own handlers then show their view.
  document.addEventListener('click', event => { if (event.target.closest?.('[data-analysis-view], #seasonViewButton, [data-season-tab]')) leave(); }, true);

  // ---------- data ----------
  function connect() {
    disconnect();
    stream = new EventSource(base + '/api/live/stream' + (chosen.length ? '?drivers=' + chosen.join(',') : ''));
    stream.onmessage = event => {
      let payload; try { payload = JSON.parse(event.data); } catch { return; }
      if (state?.session?.path && payload.state?.session?.path && state.session.path !== payload.state.session.path) {
        resetLapComparison();
        outline = null; bounds = null; currentLaps = null; telemetry = {};
      }
      state = payload.state; source = payload.source;
      if (payload.telemetry) telemetry = payload.telemetry;
      if (payload.current) currentLaps = payload.current;
      if (payload.outline) { outline = payload.outline; bounds = null; }
      render();
    };
  }
  function disconnect() { stream?.close(); stream = null; }
  async function refreshOutline() {
    try { outline = {...await api('outline'), fetchedAt: Date.now()}; bounds = null; queueDraw(); } catch { /* next update retries */ }
  }
  async function refreshStatus() {
    try { applyStatus(await api('status')); } catch (error) { showError(error); }
  }
  // ---------- F1 TV sign-in ----------
  let signinBusy = false;
  function signedIn(yes) {
    $(page, 'signin').hidden = yes; $(page, 'signout').hidden = !yes;
    if (yes) showSignin(false);
  }
  function showSignin(open) {
    const form = $(page, 'signinForm');
    form.hidden = !open; $(page, 'signin').setAttribute('aria-expanded', String(open));
    if (!passwordSignin) {
      // Only the browser sign-in: no password passes through a page this PC does not serve.
      for (const field of form.querySelectorAll('label, [type="submit"], .live-signin-or')) field.hidden = true;
      form.querySelector('.live-signin-note').textContent = 'Sign in on Formula 1\u2019s own page: FastF1\u2019s Companion browser add-on (offered there the first time) hands the sign-in to this PC. Only the resulting token is kept, on this PC.';
      if (open) $(page, 'signinBrowser').focus();
      if (!open) $(page, 'signinError').hidden = true;
      return;
    }
    if (open) form.elements.email.focus(); else { form.elements.password.value = ''; $(page, 'signinError').hidden = true; }
  }
  async function submitSignin(event) {
    event.preventDefault();
    if (signinBusy) return;
    const form = event.currentTarget, error = $(page, 'signinError'), submit = form.querySelector('[type="submit"]');
    signinBusy = true; submit.disabled = true; submit.textContent = 'Signing in…'; error.hidden = true;
    try {
      const reply = await post('signin', {email: form.elements.email.value, password: form.elements.password.value});
      form.elements.password.value = '';
      applyStatus({auth: reply.auth, source, replays: null});
    } catch (problem) {
      error.textContent = problem.message || String(problem); error.hidden = false;
    } finally {
      signinBusy = false; submit.disabled = false; submit.textContent = 'Sign in';
    }
  }
  let browserTimer = null;
  async function signInWithBrowser() {
    // Open the tab now, inside the click, so it is not blocked as a pop-up; it is pointed at the sign-in page once known.
    const tab = window.open('about:blank', '_blank');
    const error = $(page, 'signinError'); error.hidden = true;
    try {
      const reply = await post('signin-browser');
      if (tab) { try { tab.opener = null; } catch { /* cross-origin later */ } tab.location.href = reply.url; }
      $(page, 'browserLink').href = reply.url; $(page, 'browserWaiting').hidden = false;
      clearInterval(browserTimer);
      browserTimer = setInterval(async () => {
        let status; try { status = await api('status'); } catch { return; }
        const browser = status.browser_signin || {};
        if (status.auth?.available || !browser.waiting) {
          clearInterval(browserTimer); $(page, 'browserWaiting').hidden = true;
          if (!status.auth?.available && browser.error) { error.textContent = browser.error; error.hidden = false; }
          applyStatus({...status, replays: null});
        }
      }, 2000);
    } catch (problem) {
      tab?.close();
      error.textContent = problem.message || String(problem); error.hidden = false;
    }
  }
  async function signOut() {
    try { await post('signout'); refreshStatus(); } catch (error) { showError(error); }
  }

  function applyStatus(status) {
    source = status.source;
    const auth = status.auth || {};
    const authText = $(page, 'auth'), help = $(page, 'help');
    if (auth.available) {
      const until = auth.expires_at ? new Date(Number(auth.expires_at) * 1000) : null;
      const untilText = until && !Number.isNaN(until.getTime()) ? ` until ${until.toLocaleString([], {weekday: 'short', hour: '2-digit', minute: '2-digit'})}` : '';
      authText.textContent = `F1 TV · signed in${untilText}`;
      authText.title = `Signed in to F1 TV${auth.subscription ? ` (${auth.subscription})` : ''}${untilText}. The sign-in lasts a few days.`;
      // The F1 TV sign-in lasts a few days: when it ends within three, say so here, so it is renewed before a session
      // rather than found expired when the cars go out.
      const left = until ? until.getTime() - Date.now() : Infinity;
      help.hidden = !(left < 3 * 86400000);
      if (!help.hidden) help.textContent = `Your F1 TV sign-in ends ${until.toLocaleString([], {weekday: 'long', hour: '2-digit', minute: '2-digit'})}. To use live timing after that, sign out and sign in again before the session.`;
      signedIn(true);
    } else {
      authText.textContent = auth.reason || 'Not signed in.';
      help.hidden = false;
      help.textContent = 'Live timing needs your F1 TV account (Access or Pro). Sign in once; it lasts a few days. Replays need no sign-in.';
      signedIn(false);
    }
    if (Array.isArray(status.replays)) {
      const select = $(page, 'replay'), current = select.value;
      select.replaceChildren(...status.replays.map(s => new Option(`${s.year} ${s.event} · ${s.session}`, s.path)));
      if (!status.replays.length) select.append(new Option('No cached sessions', ''));
      if (current && status.replays.some(s => s.path === current)) select.value = current;
    }
    if (source?.kind === 'replay' && source.path) $(page, 'replay').value = source.path;
    window.syncSelectUI?.($(page, 'replay'));
    syncSource(); syncDot();
  }
  async function start(body) {
    const help = $(page, 'help');
    try {
      state = null; outline = null; telemetry = {}; bounds = null; currentLaps = null;
      resetLapComparison();
      applyStatus({...(await post('start', body)), replays: null});
      connect(); render();
    } catch (error) { showError(error); help.hidden = false; }
  }
  function showError(error) {
    const help = $(page, 'help'); help.hidden = false; help.textContent = error.message || String(error);
  }
  function toggleDriver(number) {
    const at = chosen.indexOf(number);
    if (at >= 0) chosen.splice(at, 1);
    else if (chosen.length < MAX_PICKS) chosen.push(number);
    else return;
    renderTower(); renderReadouts(); renderTraceDrivers(); queueDraw();
    if (active) connect();
  }

  // ---------- rendering ----------
  function syncDot() {
    const running = !!source?.running;
    button.dataset.state = running ? source.kind : 'idle';
    button.title = running ? (source.kind === 'live' ? 'Live timing · connected' : 'Live timing · replaying') : 'Live timing';
  }
  function syncSource() {
    if (!page) return;
    $(page, 'backfill').hidden = source?.kind !== 'live';
    const running = !!source?.running, badge = $(page, 'badge');
    badge.dataset.kind = running ? source.kind : 'idle';
    badge.textContent = running ? (source.kind === 'live' ? 'Live' : `Replay ${source.speed}×`) : source?.error ? 'Stopped' : 'Idle';
    $(page, 'stop').hidden = !running;
    if (active) { const crumb = document.getElementById('windowTitle'); if (crumb) crumb.textContent = source?.kind === 'replay' && running ? 'Replay' : 'Timing'; }
    $(page, 'stop').textContent = source?.kind === 'live' ? 'Disconnect' : 'Stop replay';
    $(page, 'connect').textContent = running && source.kind === 'live' ? (source.connected === false ? 'Reconnecting…' : 'Connected') : 'Connect';
    $(page, 'connect').disabled = running && source.kind === 'live';
    if (running && source.kind === 'replay') {
      const speed = $(page, 'speed');
      if ([...speed.options].some(o => Number(o.value) === Number(source.speed)) && Number(speed.value) !== Number(source.speed)) { speed.value = String(source.speed); window.syncSelectUI?.(speed); }
    }
    if (source?.waiting) { const help = $(page, 'help'); help.hidden = false; help.textContent = source.waiting; }
    if (source?.error) showError({message: source.error});
    const progress = $(page, 'progress'), seek = $(page, 'seek');
    seek.hidden = !(source?.kind === 'replay' && source.duration);
    if (!seek.hidden) {
      const share = Math.min(100, 100 * (source.position || 0) / source.duration);
      progress.firstElementChild.style.width = share + '%'; progress.setAttribute('aria-valuenow', String(Math.round(share)));
      const laps = source.laps || [], jump = $(page, 'jumpLap');
      if (jump.options.length !== laps.length + 1) {
        jump.replaceChildren(new Option('Jump to lap', 'none'), ...laps.map(([lap, at]) => new Option(`Lap ${lap}`, String(at))));
        jump.value = 'none'; window.syncSelectUI?.(jump);
      }
    }
  }
  function render() {
    if (!active || !state) { syncSource(); syncDot(); return; }
    const s = state.session || {};
    const title = $(page, 'title'), titleText = s.meeting ? `${s.meeting} · ${s.name || ''}` : 'Waiting for session data';
    if (title.dataset.text !== titleText) {
    title.dataset.text = titleText; title.textContent = titleText;
    const country = s.meeting && window.grandPrixCountryCode?.({name: s.meeting, country: s.country});
    if (/^[A-Z]{2}$/.test(country || '')) {
      const img = el('img', 'title-flag'); img.src = `assets/flags/${country.toLowerCase()}.svg`; img.alt = ''; img.width = 24; img.height = 18;
      title.prepend(img);
    }
    }
    $(page, 'subtitle').textContent = [s.circuit, s.status].filter(Boolean).join(' · ') || 'Connected. Timing appears when the session sends it.';
    const lap = $(page, 'lap');
    lap.hidden = !state.lap?.current;
    if (!lap.hidden) lap.textContent = `Lap ${state.lap.current}${state.lap.total ? ' / ' + state.lap.total : ''}`;
    const clock = $(page, 'clock');
    clock.hidden = !state.clock?.remaining;
    if (!clock.hidden) clock.textContent = state.clock.remaining + ' left';
    const flag = $(page, 'flag'), code = state.track_status?.code;
    flag.hidden = !code || code === '1';
    if (!flag.hidden) { flag.dataset.flag = FLAGS[code] || 'yellow'; flag.textContent = state.track_status.label || 'Track status'; }
    if (state.outline === 'complete' && !outline?.complete) refreshOutline();
    else if (!outline && Object.keys(state.positions || {}).length) refreshOutline();
    $(page, 'mapnote').textContent = outline?.complete ? `${s.circuit || 'Circuit'}${outline.sectors?.every(Boolean) ? ' · S1 S2 S3' : ''}` : 'Learning the circuit from car positions';
    if (outline?.complete && !outline.sectors?.every(Boolean) && Date.now() - (outline.fetchedAt || 0) > 10000) refreshOutline();
    syncSource(); syncDot();
    renderTower(); renderWeather(); renderRaceControl(); renderReadouts(); renderTraceDrivers(); renderEngineer(); queueDraw();
    if (Date.now() - lapsFetchedAt > 2000) refreshLaps();
    backfill();
  }
  let towerBest = false;
  const MINI = {2051: 'overall', 2049: 'personal', 2048: 'slower', 2064: 'pit'};
  function timeCell(row, value, flags = {}) {
    const cell = el('td', 'live-time', value || '');
    if (flags.overall) cell.classList.add('is-overall'); else if (flags.personal) cell.classList.add('is-personal');
    row.append(cell);
  }
  function renderTower() {
    if (!state) return;
    const body = $(page, 'tower'), rows = [];
    for (const d of state.drivers || []) {
      const row = el('tr'); row.dataset.number = d.number; row.tabIndex = 0;
      row.setAttribute('aria-selected', String(chosen.includes(d.number)));
      if (d.retired || d.stopped) row.classList.add('is-out');
      row.append(el('td', 'live-pos', d.position ?? ''));
      const name = el('td', 'live-driver'), label = el('span', 'live-driver-label'), bar = el('i'); bar.style.background = colour(d);
      label.append(bar, el('strong', null, d.code), el('small', null, d.number));
      // Places gained or lost against the starting grid (races).
      if (state.session?.type === 'Race' && d.grid && d.position) {
        const moved = d.grid - d.position;
        if (moved) { const m = el('small', `live-moved ${moved > 0 ? 'is-up' : 'is-down'}`, `${moved > 0 ? '▲' : '▼'}${Math.abs(moved)}`); m.title = `Started P${d.grid}`; label.append(m); }
      }
      name.append(label); row.append(name);
      const bestCell = el('td', 'live-time');
      if (d.best && source?.kind === 'live') {
        const compare = el('button', 'live-best-time', d.best);
        compare.type = 'button'; compare.dataset.compareBest = '';
        compare.setAttribute('aria-label', `${d.best}, compare ${d.code}'s best lap`);
        const full = picks.length >= MAX_PICKS && !picks.some(p => p.driver === d.number && p.lap === 'fastest');
        compare.setAttribute('aria-disabled', String(full));
        compare.title = full ? 'Remove a lap from the comparison first' : `Compare ${d.code}'s best lap`;
        bestCell.append(compare);
      } else bestCell.textContent = d.best || '';
      row.append(bestCell);
      row.append(el('td', 'live-gap', d.position === 1 ? (state.session?.type === 'Race' ? 'Leader' : '') : d.gap || ''));
      row.append(el('td', 'live-gap', d.position === 1 ? '' : d.interval || ''));
      timeCell(row, d.last?.time, d.last);
      for (let i = 0; i < 3; i++) {
        if (towerBest) { timeCell(row, d.best_sectors?.[i]); continue; }
        timeCell(row, d.sectors?.[i]?.time, d.sectors?.[i] || {});
        const segments = d.sectors?.[i]?.segments || [];
        if (segments.length) {
          const bars = el('span', 'live-minis'); bars.setAttribute('aria-hidden', 'true');
          for (const status of segments) { const b = el('i'); b.dataset.s = MINI[status] || 'none'; bars.append(b); }
          row.lastChild.append(bars);
        }
      }
      const tyre = el('td', 'live-tyre');
      if (d.stint?.compound) {
        // The main page's compound badge (session-state.js compoundBadgeMarkup: the ringed S/M/H/I/W), from a fixed list of names.
        const label = String(d.stint.compound).toLowerCase() + (d.stint.new ? ', new' : ', used');
        const badge = el('span', 'live-tyre-badge'); badge.title = label;
        if (typeof window.compoundBadgeMarkup === 'function' && /^(soft|medium|hard|intermediate|inter|wet)$/i.test(d.stint.compound)) badge.innerHTML = window.compoundBadgeMarkup(d.stint.compound);
        else { const [letter, hue] = TYRES[d.stint.compound] || ['?', '#8e8e93']; const b = el('b', null, letter); b.style.setProperty('--tyre', hue); badge.append(b); }
        const group = el('span', 'live-tyre-group'); group.append(badge, el('span', null, d.stint.laps ?? '')); tyre.append(group);
      }
      row.append(tyre);
      const pit = d.retired ? 'OUT' : d.stopped ? 'STOP' : d.in_pit ? 'PIT' : d.pit_out ? 'OUT LAP' : d.pits ? String(d.pits) : '';
      const pitCell = el('td', 'live-pit', pit); if (d.in_pit || d.pit_out) pitCell.classList.add('is-active'); row.append(pitCell);
      rows.push(row);
    }
    if (!rows.length) { const row = el('tr'); const cell = el('td', 'live-empty', 'Waiting for timing data.'); cell.colSpan = 11; row.append(cell); rows.push(row); }
    const focused = body.contains(document.activeElement) ? document.activeElement : null;
    const number = focused?.closest('tr')?.dataset.number;
    body.replaceChildren(...rows);
    if (number) {
      const row = rows.find(row => row.dataset.number === number);
      const target = focused.matches('[data-compare-best]') ? row?.querySelector('[data-compare-best]') : row;
      (target || row)?.focus({preventScroll: true});
    }
  }
  function renderWeather() {
    const w = state.weather || {}, list = $(page, 'weather'), items = [];
    // The lap card's condition icons and wind format (session-laps.js): a compass point, not degrees.
    const add = (icon, label, value) => {
      if (value == null || value === '') return;
      const dt = el('dt'); dt.append(el('i', 'live-condition-icon', icon), label); dt.firstChild.setAttribute('aria-hidden', 'true');
      items.push(dt, el('dd', null, value));
    };
    const compass = deg => { const n = Number(deg); return Number.isFinite(n) ? ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round((((n % 360) + 360) % 360) / 45) % 8] : ''; };
    add('🌤️', 'Air', w.air && `${w.air} °C`); add('🌡️', 'Track', w.track && `${w.track} °C`); add('💧', 'Humidity', w.humidity && `${w.humidity}%`);
    add('💨', 'Wind', w.wind_speed && `${w.wind_speed} m/s${compass(w.wind_direction) ? ' ' + compass(w.wind_direction) : ''}`);
    add('🌧️', 'Rain', w.rain == null ? null : (String(w.rain) === '1' || w.rain === true ? 'Yes' : 'No'));
    list.replaceChildren(...items);
  }
  function renderRaceControl() {
    const list = $(page, 'rc'), messages = state.race_control || [];
    if (!messages.length) { list.replaceChildren(el('li', 'live-empty', 'No messages yet.')); return; }
    list.replaceChildren(...messages.slice(0, 30).map(m => {
      const item = el('li'); if (m.flag) item.dataset.flag = String(m.flag).toLowerCase();
      const when = m.utc ? new Date(m.utc.endsWith('Z') ? m.utc : m.utc + 'Z') : null;
      item.append(el('time', null, [m.lap ? 'L' + m.lap : '', when && !Number.isNaN(when.getTime()) ? when.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}) : ''].filter(Boolean).join(' · ')), el('span', null, m.message));
      return item;
    }));
  }
  function driverFor(number) { return (state?.drivers || []).find(d => d.number === number) || {number, code: number}; }
  function renderReadouts() {
    const box = $(page, 'readouts');
    if (!chosen.length) { box.replaceChildren(); return; }
    box.replaceChildren(...chosen.map((number, index) => {
      const d = driverFor(number), last = (telemetry[number] || []).at(-1) || {};
      const card = el('div', 'live-readout'); card.style.setProperty('--team', colour(d)); if (index) card.classList.add('is-second');
      card.append(el('strong', null, d.code),
        el('span', null, last.speed != null ? `${last.speed} km/h` : '—'),
        el('span', null, last.gear != null ? `Gear ${last.gear}` : ''),
        el('span', null, last.throttle != null ? `Throttle ${last.throttle}%` : ''),
        el('span', last.brake ? 'is-braking' : null, last.brake ? 'Brake' : ''),
        el('span', 'live-readout-sectors', (d.sectors || []).map((sector, k) => sector.time ? `S${k + 1} ${sector.time}` : '').filter(Boolean).join(' · ')));
      return card;
    }));
  }

  const lapSecondsOf = text => { const m = /^(?:(\d+):)?(\d+(?:\.\d+)?)$/.exec(String(text || '').trim()); return m ? Number(m[1] || 0) * 60 + Number(m[2]) : Infinity; };

  // ---------- earlier laps from Formula 1's archive ----------
  const backfilled = new Set();
  async function backfill(force = false) {
    const path = state?.session?.path;
    if (source?.kind !== 'live' || !path || (!force && backfilled.has(path))) return;
    backfilled.add(path);
    const note = $(page, 'lapsNote');
    note.textContent = 'Loading the laps Formula 1 has published for this session…';
    try {
      await post('backfill');
      for (let i = 0; i < 60; i++) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        const status = (await api('status')).backfill || {};
        if (!status.running) {
          note.textContent = status.error?.includes('has not published') ? 'Earlier laps are available once Formula 1 publishes the archive.' :
            status.error || (status.laps ? `${status.laps} earlier laps loaded` : '');
          lapsFetchedAt = 0; refreshLaps();
          return;
        }
      }
    } catch (error) { note.textContent = error.message || String(error); }
  }

  // ---------- race strategy (races): battles, pace trends and a pit call, from timing gaps and completed laps ----------
  // Pace: the mean of a driver's last three clean laps (no pit lap, within 107% of their best). Trend: that pace against the
  // leader's over the same laps, seconds per lap (negative = catching). Pit loss: measured from this race's stops so far,
  // the median of (in-lap + out-lap - two clean laps around them); until a stop is seen it is not shown. Rejoin: where a car
  // would come out if it pitted now, counting the cars whose gap to the leader is below its gap plus the pit loss.
  const lapClock = t => { const m = Math.floor(t / 60); return `${m}:${(t - m * 60).toFixed(3).padStart(6, '0')}`; };
  const gapSeconds = text => { const n = parseFloat(String(text || '').replace('+', '')); return /L/i.test(String(text || '')) ? null : (Number.isFinite(n) ? n : null); };
  function cleanLaps(number) {
    const laps = (lapLists[number] || []).filter(l => l.seconds && !l.pit);
    const best = Math.min(...laps.map(l => l.seconds));
    return laps.filter(l => l.seconds <= best * 1.07);
  }
  const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
  function pitLoss() {
    const losses = [];
    for (const laps of Object.values(lapLists)) {
      laps.forEach((l, i) => {
        const next = laps[i + 1];
        if (!l.pit || !next?.pit || !l.seconds || !next.seconds) return;
        const around = [laps[i - 1], laps[i + 2]].filter(x => x?.seconds && !x.pit).map(x => x.seconds);
        if (around.length) losses.push(l.seconds + next.seconds - 2 * mean(around));
      });
    }
    losses.sort((a, b) => a - b);
    return losses.length ? losses[Math.floor(losses.length / 2)] : null;
  }
  function renderEngineer() {
    const card = $(page, 'engineer');
    if (!card) return;
    const race = /race|sprint/i.test(String(state?.session?.type || state?.session?.name || ''));
    card.hidden = !race;
    if (!race) return;
    const drivers = (state.drivers || []).filter(d => d.position && !d.retired && !d.stopped).sort((a, b) => a.position - b.position);
    const leader = drivers[0];
    if (!leader) return;
    const recent = number => { const laps = cleanLaps(number).slice(-3); return laps.length === 3 ? {pace: mean(laps.map(l => l.seconds)), laps: laps.map(l => l.lap)} : null; };
    const leaderPace = recent(leader.number);
    const loss = pitLoss();
    const rows = drivers.map(d => {
      const mine = recent(d.number), gap = d.position === 1 ? 0 : gapSeconds(d.gap), interval = d.position === 1 ? null : gapSeconds(d.interval);
      let trend = null;
      if (mine && leaderPace && d !== leader) {
        const theirs = cleanLaps(leader.number).filter(l => mine.laps.includes(l.lap));
        if (theirs.length === 3) trend = mine.pace - mean(theirs.map(l => l.seconds));
      }
      const rejoin = loss != null && gap != null ? 1 + drivers.filter(o => o !== d && (o.position === 1 ? 0 : gapSeconds(o.gap)) != null && (o.position === 1 ? 0 : gapSeconds(o.gap)) < gap + loss).length : null;
      return {d, mine, gap, interval, trend, rejoin};
    });
    // Tiles.
    const battle = rows.filter(r => r.interval != null).sort((a, b) => a.interval - b.interval)[0];
    const mover = rows.filter(r => r.trend != null).sort((a, b) => a.trend - b.trend)[0];
    const tile = (label, value, note) => { const t = el('div', 'live-engineer-tile'); t.append(el('small', null, label), el('b', null, value), el('span', null, note || '')); return t; };
    $(page, 'engineerTiles').replaceChildren(
      tile('Leader', leader.code, leaderPace ? `${lapClock(leaderPace.pace)} recent pace` : 'pace after three clean laps'),
      battle ? tile('Closest battle', `P${battle.d.position} ${battle.d.code}`, `${battle.interval.toFixed(3)} s to the car ahead`) : tile('Closest battle', '—'),
      mover ? tile('Pace mover', `P${mover.d.position} ${mover.d.code}`, `${mover.trend > 0 ? '+' : '−'}${Math.abs(mover.trend).toFixed(2)} s a lap on the leader`) : tile('Pace mover', '—', 'after three clean laps'),
      tile('Pit loss', loss != null ? `${loss.toFixed(1)} s` : '—', loss != null ? 'measured from this race’s stops' : 'after the first stops'));
    // Table.
    const body = $(page, 'engineerRows');
    body.replaceChildren(...rows.map(({d, mine, gap, interval, trend, rejoin}) => {
      const tr = el('tr');
      const who = el('td', 'live-driver'); const label = el('span', 'live-driver-label'), bar = el('i'); bar.style.background = colour(d);
      label.append(bar, el('strong', null, d.code)); who.append(label);
      const tyre = el('td'); if (d.stint?.compound) tyre.textContent = `${(TYRES[String(d.stint.compound).toUpperCase()] || ['?'])[0]} ${d.stint.laps ?? ''}`;
      const trendCell = el('td', `num${trend == null ? '' : trend < -.05 ? ' is-gain' : trend > .05 ? ' is-loss' : ''}`, trend == null ? '—' : `${trend > 0 ? '+' : '−'}${Math.abs(trend).toFixed(2)}`);
      const rejoinCell = el('td', 'num', rejoin == null ? '—' : `P${rejoin}${rejoin > d.position ? ` (−${rejoin - d.position})` : ''}`);
      tr.append(el('td', 'num', String(d.position)), who, tyre, el('td', 'num', mine ? lapClock(mine.pace) : '—'), trendCell,
        el('td', 'num', d.position === 1 ? 'Leader' : gap != null ? `+${gap.toFixed(1)}` : d.gap || '—'), el('td', 'num', interval != null ? interval.toFixed(1) : '—'), rejoinCell);
      return tr;
    }));
  }

  // ---------- lap chart: every completed lap of the chosen drivers; a point (or a lap list cell) loads that lap ----------
  // Drivers: the top three in running order until the person picks; at most six. Pit laps and laps over 110% of a driver's
  // best are left out unless "Show slow laps" is on. A lap in the comparison carries a ring in the chart and the list.
  let chartChosenSet = [], chartSlow = false, chartList = false, chartHoverLap = null;
  function resetLapComparison() {
    clearTimeout(compareRetryTimer);
    lapLists = {}; compareTraces = []; compareKey = ''; compareRequest = null; compareRetryAt = 0; picks = [];
    chartChosenSet = []; lapsFetchedAt = 0;
  }
  function chartDrivers() {
    const eligible = pickerDrivers();
    return chartChosenSet.map(number => eligible.find(d => d.number === number)).filter(Boolean);
  }
  const chartColour = d => colour(d);
  function chartLaps(number) {
    const laps = (lapLists[number] || []).filter(l => l.seconds);
    const best = Math.min(...laps.filter(l => !l.pit).map(l => l.seconds));
    return chartSlow ? laps : laps.filter(l => !l.pit && l.seconds <= best * 1.10);
  }
  const isPicked = (number, lap) => picks.some(p => p.driver === number && resolve(p)?.lap === lap);
  function toggleLapPick(number, lap) {
    const i = picks.findIndex(p => p.driver === number && resolve(p)?.lap === lap);
    if (i >= 0) picks.splice(i, 1);
    else if (picks.length < MAX_PICKS) picks.push({driver: number, lap});
    else return;
    renderChips(); loadCompare(); renderLapChart();
  }
  const tyreBadge = tyre => {
    if (!tyre?.compound) return null;
    const [letter, fill] = TYRES[String(tyre.compound).toUpperCase()] || ['?', '#8e8e93'];
    const b = el('span', 'live-tyre-mini', letter); b.style.setProperty('--tyre', fill);
    b.title = `${String(tyre.compound).toLowerCase()}${tyre.new ? ', new' : ''}${tyre.age != null ? `, ${tyre.age} laps old` : ''}`;
    return b;
  };
  function renderLapChart() {
    const box = $(page, 'lapChart');
    if (!box) return;
    const all = pickerDrivers(), chosen = chartDrivers();
    const drivers = $(page, 'chartDrivers');
    const focused = drivers.contains(document.activeElement) ? document.activeElement.dataset.driver : null;
    // Driver chips in running order.
    const chips = all.slice().sort((a, b) => (a.position ?? 99) - (b.position ?? 99)).map(d => {
      const b = el('button', 'live-chart-driver'); b.type = 'button'; b.style.setProperty('--c', chartColour(d));
      b.dataset.driver = d.number;
      const on = chosen.some(x => x.number === d.number);
      b.setAttribute('aria-pressed', String(on));
      b.setAttribute('aria-disabled', String(!on && chosen.length >= MAX_PICKS));
      b.append(el('i'), el('small', null, d.position ? `P${d.position}` : ''), el('strong', null, d.code));
      b.title = !on && chosen.length >= MAX_PICKS ? 'Deselect a driver first. Up to four can be compared.' : d.code;
      b.addEventListener('click', () => {
        const now = chartDrivers().map(x => x.number);
        if (!on && now.length >= MAX_PICKS) return;
        chartChosenSet = on ? now.filter(n => n !== d.number) : [...now, d.number];
        renderLapChart();
      });
      return b;
    });
    drivers.replaceChildren(...chips);
    if (focused) chips.find(node => node.dataset.driver === focused)?.focus({preventScroll: true});
    $(page, 'quickFastest').disabled = !chosen.some(d => resolve({driver: d.number, lap: 'fastest'}));
    if (!page.querySelector('.live-lap-history').open) return;
    $(page, 'chartSlow').setAttribute('aria-pressed', String(chartSlow));
    $(page, 'chartSlow').textContent = chartSlow ? 'Hide slow laps' : 'Show slow laps';
    $(page, 'chartList').setAttribute('aria-pressed', String(chartList));
    const plot = $(page, 'chartPlot');
    const series = chosen.map(d => ({d, colour: chartColour(d), laps: chartLaps(d.number)})).filter(s => s.laps.length);
    if (!series.length) { plot.replaceChildren(el('p', 'live-empty', all.length ? 'Choose a driver above.' : 'Laps appear here as drivers complete them.')); renderLapList(chosen); return; }
    const W = Math.max(320, Math.round(plot.clientWidth || 640)), H = 220, L = 48, R = 12, T = 10, B = 24;
    const points = series.flatMap(s => s.laps);
    const lapLo = Math.min(...points.map(l => l.lap)), lapHi = Math.max(...points.map(l => l.lap));
    const tLo = Math.min(...points.map(l => l.seconds)), tHi = Math.max(...points.map(l => l.seconds));
    const span = Math.max(.5, tHi - tLo), step = [.25, .5, 1, 2, 5, 10, 20].find(v => span / v <= 5) || 30;
    const yLo = Math.floor(tLo / step) * step, yHi = Math.ceil(tHi / step) * step;
    const x = lap => L + (lapHi === lapLo ? (W - L - R) / 2 : (lap - lapLo) / (lapHi - lapLo) * (W - L - R));
    const y = t => T + (yHi - t) / ((yHi - yLo) || 1) * (H - T - B);
    const dense = (W - L - R) / Math.max(1, lapHi - lapLo) < 16;
    const decimals = step >= 1 ? 0 : step >= .5 ? 1 : 2;
    const tick = t => { const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s.toFixed(decimals).padStart(decimals ? 3 + decimals : 2, '0')}`; };
    const NS = 'http://www.w3.org/2000/svg', node = (tag, attrs, text) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); if (text != null) n.textContent = text; return n; };
    const svg = node('svg', {class: `overview-lap-chart live-lap-chart${dense ? ' is-dense' : ''}`, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Lap times by lap for ${chosen.map(d => d.code).join(', ')}`});
    for (let t = yLo; t <= yHi + 1e-9; t += step) { svg.append(node('line', {class: 'grid', x1: L, x2: W - R, y1: y(t).toFixed(1), y2: y(t).toFixed(1)}), node('text', {class: 'axis', x: L - 8, y: (y(t) + 3.5).toFixed(1), 'text-anchor': 'end'}, tick(t))); }
    const lapStep = Math.max(1, Math.ceil((lapHi - lapLo) / 10));
    for (let lap = lapLo; lap <= lapHi; lap += lapStep) svg.append(node('text', {class: 'axis', x: x(lap).toFixed(1), y: H - 6, 'text-anchor': 'middle'}, String(lap)));
    const guide = node('line', {class: 'hover-guide', x1: 0, x2: 0, y1: T, y2: H - B, visibility: 'hidden'});
    svg.append(guide);
    const seen = new Set();
    for (const s of series) {
      const hollow = seen.has(s.colour); seen.add(s.colour);
      svg.append(node('polyline', {class: `line${hollow ? ' is-dashed' : ''}`, points: s.laps.map(l => `${x(l.lap).toFixed(1)},${y(l.seconds).toFixed(1)}`).join(' '), style: `stroke:${s.colour}`}));
      for (const l of s.laps) {
        const picked = isPicked(s.d.number, l.lap);
        const c = node('circle', {class: `point${picked ? ' is-loaded' : ''}${hollow ? ' is-hollow' : ''}`, cx: x(l.lap).toFixed(1), cy: y(l.seconds).toFixed(1), r: picked ? 5 : 3.5,
          style: `--c:${s.colour}`, tabindex: 0, role: 'button', 'data-driver': s.d.number, 'data-lap': l.lap,
          'aria-label': `${s.d.code} lap ${l.lap}, ${l.time}${l.tyre?.compound ? ', ' + String(l.tyre.compound).toLowerCase() : ''}. ${picked ? 'In the comparison; select to remove' : 'Select to compare'}`});
        svg.append(c);
      }
    }
    // Hover: the nearest lap, a guide line and a card with every chosen driver's time and tyre on that lap.
    const card = $(page, 'chartCard');
    const hide = () => { guide.setAttribute('visibility', 'hidden'); card.hidden = true; chartHoverLap = null; };
    svg.addEventListener('pointerleave', hide);
    svg.addEventListener('pointermove', event => {
      const box2 = svg.getBoundingClientRect(), vx = (event.clientX - box2.left) * W / box2.width;
      const lap = Math.round(lapLo + Math.min(1, Math.max(0, (vx - L) / (W - L - R))) * (lapHi - lapLo));
      if (lap === chartHoverLap) return;
      chartHoverLap = lap;
      const rows = series.map(s => [s, s.laps.find(l => l.lap === lap)]).filter(([, l]) => l).sort((a, b) => a[1].seconds - b[1].seconds);
      if (!rows.length) { hide(); return; }
      guide.setAttribute('x1', x(lap).toFixed(1)); guide.setAttribute('x2', x(lap).toFixed(1)); guide.setAttribute('visibility', 'visible');
      card.replaceChildren(el('b', null, `Lap ${lap}`), ...rows.map(([s, l]) => {
        const line = el('span'); const dot = el('i'); dot.style.setProperty('--c', s.colour);
        const tyre = l.tyre?.compound ? ` · ${TYRES[String(l.tyre.compound).toUpperCase()]?.[0] || '?'}${l.tyre.age != null ? ' ' + l.tyre.age : ''}` : '';
        line.append(dot, s.d.code, el('em', null, `${l.time}${tyre}${l.pit ? ' · pit' : ''}`)); return line;
      }));
      card.hidden = false;
      const px = box2.left + x(lap) * box2.width / W, w = card.offsetWidth;
      card.style.left = `${px + 14 + w > innerWidth - 8 ? px - 14 - w : px + 14}px`;
      card.style.top = `${Math.min(innerHeight - card.offsetHeight - 8, Math.max(8, event.clientY - card.offsetHeight / 2))}px`;
    });
    const activate = target => { const p = target.closest?.('.point'); if (p) toggleLapPick(p.dataset.driver, Number(p.dataset.lap)); };
    svg.addEventListener('click', event => activate(event.target));
    svg.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(event.target); } });
    plot.replaceChildren(svg);
    renderLapList(chosen);
  }
  // Every lap of the chosen drivers as the main site's lap tiles (lap-chip): one column per driver, newest first; state
  // and lap number, tyre age, time and the compound. A tile loads that lap into the comparison; F1's colours mark the
  // session's fastest lap (purple) and each driver's best (green).
  function renderLapList(chosen) {
    const box = $(page, 'lapList');
    box.hidden = !chartList;
    if (!chartList) return;
    const overall = sessionBests().overall[3];
    const columns = chosen.map(d => {
      const column = el('div', 'live-lap-column');
      const head = el('div', 'live-lap-column-head'); const dot = el('i'); dot.style.setProperty('--c', chartColour(d));
      head.append(dot, el('strong', null, d.code), el('small', null, d.position ? `P${d.position}` : ''));
      column.append(head);
      const laps = (lapLists[d.number] || []).slice().reverse();
      for (const l of laps) {
        const picked = isPicked(d.number, l.lap);
        const best = resolve({driver: d.number, lap: 'fastest'})?.lap === l.lap;
        const b = el('button', `lap lap-chip${l.pit ? ' in-out' : ''}${picked ? ' selected' : ''}${best ? (l.seconds === overall ? ' is-overall' : ' is-personal') : ''}`);
        b.type = 'button'; b.dataset.uiKind = 'choice'; b.setAttribute('aria-pressed', String(picked)); b.style.setProperty('--team', chartColour(d));
        const token = el('span', 'lap-token');
        if (l.pit) { const states = el('span', 'lap-states'); states.append(el('b', 'lap-state', 'PIT')); token.append(states); }
        token.append(document.createTextNode(`L${l.lap}`));
        b.append(token, el('span', 'lap-clock', l.time || '—'));
        const badge = typeof window.compoundBadgeMarkup === 'function' && l.tyre?.compound ? window.compoundBadgeMarkup(String(l.tyre.compound).toUpperCase()) : '';
        if (badge) b.insertAdjacentHTML('beforeend', badge);
        if (l.tyre?.age != null) { const age = el('small', 'lap-tyre-age', `Tyre age ${l.tyre.age}`); age.title = `${String(l.tyre.compound || '').toLowerCase()}${l.tyre.new ? ', new set' : ''}, ${l.tyre.age} laps old`; b.append(age); }
        b.setAttribute('aria-label', `${d.code} lap ${l.lap}, ${l.time || 'no time'}${l.pit ? ', pit lap' : ''}. ${picked ? 'In the comparison; select to remove' : 'Select to compare'}`);
        b.addEventListener('click', () => toggleLapPick(d.number, l.lap));
        column.append(b);
      }
      return column;
    });
    const grid = el('div', 'live-lap-tiles'); grid.style.setProperty('--columns', String(Math.max(1, columns.length)));
    grid.append(...columns);
    box.replaceChildren(grid);
  }

  // ---------- completed lap comparison: up to four laps, the first is the reference ----------
  async function refreshLaps() {
    lapsFetchedAt = Date.now();
    if (refreshLaps.busy) return;
    refreshLaps.busy = true;
    const session = state?.session?.path;
    try {
      const laps = await api('laps');
      if (session !== state?.session?.path) { lapsFetchedAt = 0; return; }
      lapLists = laps;
    } catch { return; } finally { refreshLaps.busy = false; }
    // Colours follow the session as it runs: a new session or personal best elsewhere recolours these laps at once.
    renderChips(); renderSectorTable(); loadCompare(); renderLapChart();
    if ($(page, 'lapPicker').matches?.(':popover-open')) renderPicker();
  }
  const pickerDrivers = () => (state?.drivers || []).filter(d => lapLists[d.number]?.length || (source?.kind === 'live' && d.best));
  function compareSelectedBest() {
    picks = chartDrivers().map(d => ({driver: d.number, lap: 'fastest'})).filter(resolve);
    renderChips(); loadCompare(); renderLapChart();
  }
  async function openSessionAnalysis() {
    const session = state?.session;
    const selected = picks.map((pick, i) => ({code: driverFor(pick.driver).code, lap: displayedLap(pick, i)?.lap})).filter(entry => entry.lap != null);
    if (!session?.year || !session.name || !selected.length || !window.ApexUrl) return;
    const button = $(page, 'sessionAnalysis');
    button.disabled = true;
    try {
      const r = await fetch(`assets/data/events/${Number(session.year)}.json`);
      if (!r.ok) throw new Error();
      const calendar = await r.json();
      const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      const date = String(session.path || '').match(/\/(\d{4}-\d{2}-\d{2})_[^/]+\/$/)?.[1];
      const event = calendar.find(item => normalize(item.name) === normalize(session.meeting))
        || (date && calendar.find(item => String(item.session_dates?.[session.name] || '').startsWith(date)));
      if (!event?.round) throw new Error();
      location.href = window.ApexUrl.href('session', {year: session.year, round: event.round, session: session.name,
        laps: selected.map(({code, lap}) => `${code}.${lap}`).join(',')});
    } catch {
      $(page, 'lapsNote').textContent = 'Could not find this session in the Session analysis calendar.';
    } finally { button.disabled = false; }
  }
  function compareBest(driver) {
    let index = picks.findIndex(p => p.driver === driver && p.lap === 'fastest');
    if (index < 0) {
      if (picks.length >= MAX_PICKS) return;
      index = picks.push({driver, lap: 'fastest'}) - 1;
    }
    if (!chartChosenSet.includes(driver) && chartChosenSet.length < MAX_PICKS) chartChosenSet.push(driver);
    showWorkspace('laps');
    renderChips(); loadCompare();
    $(page, 'lapChips').querySelector(`[data-pick="${index}"]`)?.focus();
  }
  // The lap a pick points at now ('latest' and 'fastest' move on as laps complete).
  function resolve(pick) {
    const laps = lapLists[pick.driver] || [];
    if (pick.lap === 'latest') return laps.filter(l => l.push).at(-1) || null;
    if (pick.lap === 'fastest') {
      const time = source?.kind === 'live' ? driverFor(pick.driver).best : null;
      const seconds = lapSecondsOf(time);
      if (Number.isFinite(seconds)) return laps.find(l => !l.pit && l.seconds === seconds) || {lap: null, time, seconds};
      return laps.find(l => l.fastest) || null;
    }
    if (pick.lap === 'last') return laps.at(-1) || null;
    return laps.find(l => l.lap === Number(pick.lap)) || null;
  }
  function displayedLap(pick, index) {
    const lap = resolve(pick), trace = compareTraces[index];
    return lap && lap.lap == null && trace?.driver === pick.driver && trace.seconds === lap.seconds ? trace : lap;
  }
  // Each lap its team colour; a second lap from the same team (or driver) takes a contrasting neutral.
  function pickColours() {
    const used = [], spare = [css('--ui-label') || '#fff', '#a1a1aa', '#f5a524'];
    return picks.map(p => {
      let c = colour(driverFor(p.driver));
      if (used.includes(c)) c = spare.find(x => !used.includes(x)) || c;
      used.push(c); return c;
    });
  }
  const MODE_NAMES = {latest: 'Latest push', fastest: 'Fastest', last: 'Last'};
  function formatGap(seconds) { return `${seconds > 0 ? '+' : seconds < 0 ? '−' : '±'}${Math.abs(seconds).toFixed(3)}`; }
  function renderChips() {
    const box = $(page, 'lapChips'), colours = pickColours(), ref = picks[0] && resolve(picks[0]);
    $(page, 'sessionAnalysis').hidden = !state?.session?.year || !picks.length || !picks.every((p, i) => displayedLap(p, i)?.lap != null);
    const focused = box.contains(document.activeElement) ? document.activeElement : null;
    const focusKey = focused?.hasAttribute('data-remove') ? 'remove' : 'pick';
    const chips = picks.map((pick, i) => {
      const lap = displayedLap(pick, i), d = driverFor(pick.driver);
      // The main site's comparison pill (loaded-lap-pill): team dot, code, lap, time, "Ref" on the reference, ×. Which lap a
      // moving pick follows and the gap to the reference are in its title.
      const chip = el('div', `loaded-lap-pill${i ? '' : ' reference'}`); chip.setAttribute('role', 'listitem'); chip.style.setProperty('--team', colours[i]);
      const body = el('button', `loaded-lap-main${i ? '' : ' reference'}`); body.type = 'button'; body.dataset.pick = String(i);
      const label = lap?.lap != null ? `L${lap.lap}` : lap ? 'Time only' : '—';
      body.setAttribute('aria-label', `Change lap ${i + 1}: ${d.code} ${label} ${lap?.time || ''}`.trim());
      body.append(el('b', null, d.code), el('span', null, label), el('strong', null, lap?.time || 'no lap yet'));
      const gap = i && lap?.seconds && ref?.seconds ? `${formatGap(lap.seconds - ref.seconds)} s to the reference` : i ? '' : 'Reference lap';
      body.title = [typeof pick.lap === 'string' ? `${MODE_NAMES[pick.lap]} lap, follows new laps` : '', gap, 'Select to change'].filter(Boolean).join(' · ');
      const remove = el('button', 'remove', '×'); remove.type = 'button'; remove.dataset.remove = String(i);
      remove.setAttribute('aria-label', `Remove ${d.code} lap from the comparison`);
      chip.append(body);
      if (i) {
        const reference = el('button', 'live-make-reference', 'Set ref');
        reference.type = 'button'; reference.dataset.reference = String(i);
        reference.setAttribute('aria-label', `Set ${d.code} as reference`);
        chip.append(reference);
      }
      chip.append(remove);
      return chip;
    });
    if (picks.length < MAX_PICKS) {
      const add = el('button', 'live-lap-add', '+ Add driver or lap'); add.type = 'button'; add.dataset.pick = 'add';
      add.disabled = !pickerDrivers().length; chips.push(add);
    }
    if (!pickerDrivers().length) chips.unshift(el('p', 'live-empty', 'Laps appear here as drivers complete them.'));
    box.replaceChildren(...chips);
    if (focused) [...box.querySelectorAll(`[data-${focusKey}]`)].find(button => button.dataset[focusKey] === focused.dataset[focusKey])?.focus({preventScroll: true});
  }
  // The picker: drivers in running order, then the chosen driver's laps.
  let pickerTarget = null, pickerDriver = null;
  function openPicker(anchor, index) {
    const drivers = pickerDrivers();
    pickerTarget = index; pickerDriver = index == null ? (drivers.find(d => !picks.some(p => p.driver === d.number)) || drivers[0])?.number : picks[index].driver;
    const picker = $(page, 'lapPicker');
    $(page, 'pickerTitle').textContent = index == null ? 'Add a driver or lap' : `Change lap ${index + 1}`;
    renderPicker();
    picker.showPopover?.();
    const r = anchor.getBoundingClientRect(), w = Math.min(420, innerWidth - 24);
    picker.style.width = w + 'px';
    picker.style.left = Math.max(12, Math.min(innerWidth - w - 12, r.left)) + 'px';
    const below = r.bottom + 6, height = picker.offsetHeight;
    picker.style.top = (below + height > innerHeight - 12 ? Math.max(12, r.top - height - 6) : below) + 'px';
    picker.querySelector('[aria-pressed="true"]')?.focus({preventScroll: true});
  }
  function renderPicker() {
    const drivers = pickerDrivers(), current = pickerTarget == null ? null : picks[pickerTarget];
    $(page, 'pickerDrivers').replaceChildren(...drivers.map(d => {
      const b = el('button', 'live-picker-driver'); b.type = 'button';
      b.setAttribute('aria-pressed', String(d.number === pickerDriver)); b.style.setProperty('--team', colour(d));
      b.append(el('i'), el('strong', null, d.code), el('small', null, d.position ? `P${d.position}` : ''));
      b.addEventListener('click', () => { pickerDriver = d.number; renderPicker(); });
      return b;
    }));
    const laps = lapLists[pickerDriver] || [], fastest = resolve({driver: pickerDriver, lap: 'fastest'});
    const row = (value, title, lap, extra = '') => {
      const b = el('button', 'live-picker-lap'); b.type = 'button';
      const selected = current && current.driver === pickerDriver && String(current.lap) === String(value);
      b.setAttribute('aria-pressed', String(!!selected));
      b.append(el('span', null, title), el('b', null, lap?.time || '—'));
      if (extra) b.append(el('small', null, extra));
      if (lap && (value === 'fastest' || fastest?.lap === lap.lap)) b.classList.add('is-fastest');
      if (lap?.pit) b.classList.add('is-pit');
      b.disabled = !lap;
      b.addEventListener('click', () => choose(value));
      return b;
    };
    const latest = laps.filter(l => l.push).at(-1);
    const rows = [
      row('latest', latest ? `Latest push · L${latest.lap}` : 'Latest push lap', latest, 'follows new laps'),
      row('fastest', fastest?.lap != null ? `Fastest · L${fastest.lap}` : 'Fastest lap', fastest, fastest && fastest.lap == null ? 'time only' : 'follows new bests'),
      el('div', 'live-picker-rule'),
      ...laps.slice().reverse().map(l => row(l.lap, `Lap ${l.lap}`, l, l.pit ? 'pit lap' : l.push ? '' : 'not a push lap')),
    ];
    $(page, 'pickerLaps').replaceChildren(...rows);
  }
  function choose(value) {
    if (!$(page, 'lapPicker').matches?.(':popover-open') || (pickerTarget == null && picks.length >= MAX_PICKS)) return;
    const pick = {driver: pickerDriver, lap: value};
    if (pickerTarget == null) picks.push(pick); else picks[pickerTarget] = pick;
    $(page, 'lapPicker').hidePopover?.();
    renderChips(); loadCompare(); renderLapChart();
  }
  async function loadCompare() {
    const entries = picks.map(pick => ({pick, lap: resolve(pick)}));
    const key = entries.map(({pick, lap}) => `${pick.driver}:${pick.lap}:${lap?.lap}:${lap?.time || ''}:${lap?.distance ?? ''}`).join('|');
    const changed = key !== compareKey;
    if (changed) {
      clearTimeout(compareRetryTimer);
      const previous = new Map(compareKey.split('|').map((part, i) => [part, compareTraces[i]]));
      compareTraces = key.split('|').map(part => previous.get(part) || null);
      compareRequest = null; compareRetryAt = 0; compareKey = key;
    }
    renderSectorTable();
    if (compareRequest || (!changed && (!compareRetryAt || Date.now() < compareRetryAt))) return;
    const pending = entries.map(({lap}, i) => Boolean(lap && !compareTraces[i]));
    if (!pending.some(Boolean)) { traceStatus(); return; }
    const request = {};
    compareRequest = request;
    traceStatus();
    queueDraw();
    const traces = await Promise.all(entries.map(async ({pick, lap}, i) => {
      if (!pending[i]) return compareTraces[i] || null;
      const trace = await api(`lap?driver=${encodeURIComponent(pick.driver)}&lap=${lap.lap ?? 'fastest'}`, {signal: AbortSignal.timeout(15000)}).catch(() => null);
      if (trace?.x?.length > 1 && (lap.lap != null || trace.seconds === lap.seconds)) {
        if (compareRequest === request) {
          compareTraces[i] = trace; renderChips(); renderSectorTable(); traceStatus(); queueDraw();
        }
        return trace;
      }
      return null;
    }));
    if (compareRequest !== request) return;
    compareRequest = null;
    compareTraces = traces;
    compareRetryAt = pending.some((needed, i) => needed && !traces[i]) ? Date.now() + 15_000 : 0;
    clearTimeout(compareRetryTimer);
    if (compareRetryAt) compareRetryTimer = setTimeout(() => {
      if (active && page.querySelector('.live-grid').dataset.workspace === 'laps') void loadCompare();
    }, 15_000);
    traceStatus();
    renderChips(); renderSectorTable(); queueDraw();
  }
  function traceStatus() {
    const status = $(page, 'traceStatus');
    const missing = picks.filter((pick, i) => resolve(pick) && !compareTraces[i]).map(pick => driverFor(pick.driver).code);
    const message = !missing.length ? '' : compareRequest ? `Loading telemetry for ${missing.join(', ')}…` :
      `Waiting for telemetry for ${missing.join(', ')}. Apex will retry automatically.`;
    if (status.textContent !== message) status.textContent = message;
    status.hidden = !message;
  }
  // Sector times of the compared laps in F1's colours for the session: purple the session's fastest, green the driver's
  // personal best, yellow neither. The bests come from every lap of the session the app holds (F1's own flags are only
  // true at the moment a lap finishes). The gap to the reference sits underneath in neutral grey.
  function sessionBests() {
    const overall = [Infinity, Infinity, Infinity, Infinity], personal = {};
    for (const [number, laps] of Object.entries(lapLists)) {
      const mine = personal[number] = [Infinity, Infinity, Infinity, Infinity];
      for (const lap of laps) {
        const values = [0, 1, 2].map(i => lap.sectors?.[i]?.seconds);
        values.forEach((v, k) => { if (v) { mine[k] = Math.min(mine[k], v); overall[k] = Math.min(overall[k], v); } });
      }
    }
    for (const d of pickerDrivers()) {
      const mine = personal[d.number] ??= [Infinity, Infinity, Infinity, Infinity];
      mine[3] = resolve({driver: d.number, lap: 'fastest'})?.seconds ?? Infinity;
      overall[3] = Math.min(overall[3], mine[3]);
    }
    return {overall, personal};
  }
  function renderSectorTable() {
    const box = $(page, 'sectorTable'), colours = pickColours();
    const rows = picks.map((pick, i) => {
      const lap = displayedLap(pick, i);
      return lap && {trace: {...lap, driver: pick.driver}, colour: colours[i], index: i};
    }).filter(Boolean);
    if (!rows.length) { box.replaceChildren(); return; }
    const value = (r, k) => (k < 3 ? r.trace.sectors?.[k]?.seconds : r.trace.seconds) ?? null;
    const text = (r, k) => (k < 3 ? r.trace.sectors?.[k]?.time : r.trace.time) || null;
    const bests = sessionBests(), close = (a, b) => Math.abs(a - b) < 0.0005;
    const grid = el('div', 'live-sectors'); grid.setAttribute('role', 'table'); grid.setAttribute('aria-label', 'Sector times of the compared laps');
    const head = el('div', 'live-sectors-row is-head'); head.setAttribute('role', 'row');
    ['Lap', 'Sector 1', 'Sector 2', 'Sector 3', 'Lap time'].forEach((label, k) => { const c = el('span', null, label); c.setAttribute('role', k ? 'columnheader' : 'rowheader'); head.append(c); });
    grid.append(head);
    rows.forEach(r => {
      const i = r.index, reference = rows[0].index === 0 ? rows[0] : null;
      const row = el('div', 'live-sectors-row'); row.setAttribute('role', 'row');
      const who = el('div', 'live-sectors-who'); who.setAttribute('role', 'rowheader'); who.style.setProperty('--team', r.colour);
      who.append(el('i'), el('strong', null, driverFor(r.trace.driver).code), el('small', null, r.trace.lap == null ? 'Time only' : `L${r.trace.lap}`));
      row.append(who);
      for (let k = 0; k < 4; k++) {
        const v = value(r, k), ref = reference ? value(reference, k) : null, cell = el('div', 'live-sectors-cell'); cell.setAttribute('role', 'cell');
        if (k === 3) cell.classList.add('is-lap');
        if (!i) cell.classList.add('is-ref');
        const gap = i && v != null && ref != null ? v - ref : null;
        cell.dataset.tone = v == null ? 'none' : close(v, bests.overall[k]) ? 'overall' : close(v, bests.personal[r.trace.driver]?.[k] ?? Infinity) ? 'personal' : 'slower';
        cell.title = {overall: 'Fastest of the session', personal: `${driverFor(r.trace.driver).code}'s personal best`, slower: `Neither the session's nor the driver's best`}[cell.dataset.tone] || '';
        cell.append(el('b', null, text(r, k) || '—'), el('small', gap > 0 ? 'is-slower' : gap < 0 ? 'is-faster' : null, !i ? (rows.length > 1 ? 'Ref' : '') : gap == null ? '' : formatGap(gap)));
        row.append(cell);
      }
      grid.append(row);
    });
    const legend = el('div', 'live-sectors-legend');
    [['var(--f1-purple)', 'Session best'], ['var(--f1-green)', 'Personal best'], ['var(--f1-yellow)', 'Neither'], [null, 'Gaps against the first lap: − faster, + slower']].forEach(([tone, label]) => {
      const item = el('span'); if (tone) { const bar = el('i'); bar.style.setProperty('--tone', tone); item.append(bar); } item.append(label); legend.append(item);
    });
    box.replaceChildren(grid, legend);
  }

  const traceFrames = new WeakMap();
  function updateTelemetryFrame(container, mode, laps, emptyMessage) {
    let view = traceFrames.get(container);
    if (!view) {
      const message = el('p', 'live-empty');
      container.append(message);
      view = {message, frame: null, payload: null};
      traceFrames.set(container, view);
    }
    const ready = laps.some(lap => lap.trace?.x?.length > 1);
    view.message.hidden = !emptyMessage || (ready && mode !== 'current');
    if (view.message.textContent !== emptyMessage) view.message.textContent = emptyMessage;
    if (!ready) {
      if (view.frame) view.frame.hidden = true;
      view.payload = null;
      return;
    }
    if (!view.frame) {
      const frame = el('iframe', 'live-telemetry-frame');
      frame.setAttribute('height', '0');
      frame.title = mode === 'current' ? 'Current lap telemetry charts' : 'Completed lap telemetry charts';
      frame.src = 'telemetry-frame.html' + assetVersion;
      frame.addEventListener('load', () => {
        if (view.payload) frame.contentWindow?.ApexTelemetryFrame?.update(view.payload);
      });
      view.frame = frame;
      container.append(frame);
    }
    const session = state?.session || {};
    const theme = document.documentElement.dataset.surface === 'black' ? 'black' : document.documentElement.dataset.theme;
    const key = session.path || [session.year, session.meeting, session.name].join(':');
    const previous = view.payload;
    view.frame.hidden = false;
    if (previous?.key === key && previous.theme === theme && previous.laps.length === laps.length &&
        laps.every((lap, index) => ['code', 'lap', 'seconds', 'colour', 'trace'].every(field => lap[field] === previous.laps[index][field]))) return;
    view.payload = {mode, key, year: session.year, theme, event: session.meeting, title: [session.meeting, session.name].filter(Boolean).join(' · '), laps,
      distance: mode === 'current' ? currentLaps?.length : null, sectors: currentLaps?.sector_marks};
    view.frame.contentWindow?.ApexTelemetryFrame?.update(view.payload);
  }

  function drawCompare() {
    const colours = pickColours();
    const laps = picks.map((pick, index) => {
      const entry = displayedLap(pick, index);
      return {code: driverFor(pick.driver).code, lap: entry?.lap, seconds: entry?.seconds,
        sectors: entry?.sectors, colour: colours[index], trace: compareTraces[index]};
    });
    updateTelemetryFrame($(page, 'compareCharts'), 'completed', laps, picks.length ? '' : 'Select drivers or add a lap to start the comparison.');
  }

  function renderTraceDrivers() {
    const group = $(page, 'traceDrivers');
    const drivers = state?.drivers || [];
    const key = JSON.stringify([chosen, drivers.map(d => [d.number, d.code, d.color])]);
    if (group.dataset.key === key) return;
    group.dataset.key = key;
    const focus = group.contains(document.activeElement) ? document.activeElement.dataset.driver : null;
    const buttons = drivers.map(d => {
      const button = el('button', 'live-chart-driver'); button.type = 'button'; button.dataset.driver = d.number;
      const selected = chosen.includes(d.number);
      button.style.setProperty('--c', colour(d));
      button.setAttribute('aria-pressed', String(selected));
      button.setAttribute('aria-disabled', String(!selected && chosen.length >= MAX_PICKS));
      button.append(el('i'), el('strong', null, d.code));
      button.addEventListener('click', () => toggleDriver(d.number));
      return button;
    });
    group.replaceChildren(...buttons);
    if (focus) buttons.find(button => button.dataset.driver === focus)?.focus({preventScroll: true});
  }
  function drawTrace() {
    const laps = chosen.map(number => {
      const trace = currentLaps?.laps?.[number], driver = driverFor(number);
      return {code: driver.code, lap: trace?.lap, colour: colour(driver), trace};
    });
    let message = '';
    if (!chosen.length) message = 'Select drivers to view their current laps.';
    else if (!source?.running || source.connected === false) message = 'Live feed disconnected. Any telemetry shown is from the last connection.';
    else {
      const pending = laps.filter(lap => !(lap.trace?.x?.length > 1)).map(lap => lap.code);
      if (pending.length) {
        const receivingSamples = chosen.some(number => telemetry[number]?.length);
        message = !receivingSamples && source.kind === 'live' && source.authenticated === false
          ? 'No car telemetry on this connection. Sign in to F1 TV to reconnect with telemetry access.'
          : receivingSamples ? `Waiting for enough lap data for ${pending.join(', ')}. Latest readings appear above.`
          : `Waiting for car telemetry from Formula 1 for ${pending.join(', ')}.`;
      }
    }
    updateTelemetryFrame($(page, 'traceCharts'), 'current', laps, message);
  }

  // ---------- canvases ----------
  function queueDraw() {
    if (drawQueued) return;
    drawQueued = true;
    requestAnimationFrame(() => {
      drawQueued = false;
      if (!active) return;
      const workspace = page.querySelector('.live-grid').dataset.workspace;
      if (workspace !== 'laps') drawMap();
      if (workspace === 'laps') drawCompare();
      if (workspace === 'telemetry') drawTrace();
    });
  }
  function sized(canvas) {
    const ratio = Math.min(3, Math.max(2, devicePixelRatio || 1)), w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return null;
    if (canvas.width !== Math.round(w * ratio) || canvas.height !== Math.round(h * ratio)) { canvas.width = Math.round(w * ratio); canvas.height = Math.round(h * ratio); }
    const ctx = canvas.getContext('2d'); ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, w, h);
    return {ctx, w, h};
  }
  const css = name => getComputedStyle(page).getPropertyValue(name).trim();
  // The road as the main site's circuit guide draws it: a 7 px line per timing sector (S1 pink, S2 yellow, S3 blue),
  // a start/finish mark, and numbered corner beads placed with the guide's own helper (session-map.js).
  const SECTOR_COLOURS = ['#ff4081', '#e6bc24', '#40a9ed'];
  const guides = new Map();
  function circuitGuide() {
    const key = state?.session?.circuit_key, year = state?.session?.year;
    if (!key || !year) return null;
    const id = `${key}/${year}`;
    if (!guides.has(id)) {
      guides.set(id, null);
      fetch(`${base}/api/circuit-guide?key=${encodeURIComponent(key)}&year=${encodeURIComponent(year)}`).then(r => (r.ok ? r.json() : null))
        .then(data => { guides.set(id, data); queueDraw(); }).catch(() => {});
    }
    return guides.get(id);
  }
  function drawRoad(ctx, road, {w, h, px, py}) {
    const light = document.documentElement.dataset.theme === 'light';
    const nearest = (x, y) => { let best = 0, dist = Infinity; road.forEach((p, i) => { const d = Math.hypot(p.x - px(x), p.y - py(y)); if (d < dist) { dist = d; best = i; } }); return best; };
    const closed = outline.complete, n = road.length;
    const path = (from, count) => { ctx.beginPath(); for (let k = 0; k <= count; k++) { const p = road[(from + k) % n]; k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); } };
    ctx.lineJoin = 'round'; ctx.lineWidth = 7;
    const marks = closed && outline.line && outline.sectors?.every(Boolean) ? [outline.line, ...outline.sectors].map(([x, y]) => nearest(x, y)) : null;
    if (marks) {
      // Runs go forward from the line: line -> sector 1 end -> sector 2 end -> line.
      marks.forEach((from, k) => {
        const to = marks[(k + 1) % 3], count = (to - from + n) % n || n;
        ctx.lineCap = 'butt'; path(from, count); ctx.strokeStyle = SECTOR_COLOURS[k]; ctx.stroke();
      });
      // Sector changes: a short break in the page colour, as on the guide.
      ctx.lineCap = 'butt';
      marks.slice(1).forEach(i => { const a = road[(i - 1 + n) % n], b = road[(i + 1) % n], c = road[i], l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        ctx.beginPath(); ctx.moveTo(c.x - (b.x - a.x) / l * 1.2, c.y - (b.y - a.y) / l * 1.2); ctx.lineTo(c.x + (b.x - a.x) / l * 1.2, c.y + (b.y - a.y) / l * 1.2);
        ctx.strokeStyle = getComputedStyle(page).getPropertyValue('--lin-card').trim() || (light ? '#fff' : '#191a1b'); ctx.lineWidth = 9; ctx.stroke(); ctx.lineWidth = 7; });
      // Start/finish: a chequered bar across the road.
      const i = marks[0], a = road[(i - 1 + n) % n], b = road[(i + 1) % n], c = road[i], l = Math.hypot(b.x - a.x, b.y - a.y) || 1, nx = -(b.y - a.y) / l, ny = (b.x - a.x) / l;
      ctx.beginPath(); ctx.moveTo(c.x - nx * 8, c.y - ny * 8); ctx.lineTo(c.x + nx * 8, c.y + ny * 8);
      ctx.strokeStyle = light ? '#1d1d1f' : '#f2f2f4'; ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.stroke();
    } else {
      ctx.lineCap = 'round'; path(0, closed ? n : n - 1); ctx.strokeStyle = light ? '#9a9aa2' : '#d0d0d6'; ctx.globalAlpha = .55; ctx.stroke(); ctx.globalAlpha = 1;
    }
    // Corner numbers from the circuit guide's data, in the same coordinates as the live car positions.
    const guide = circuitGuide();
    if (closed && guide?.corners?.length && typeof window.placeRoadBeads === 'function') {
      const lengths = [0]; for (let i = 1; i < n; i++) lengths.push(lengths[i - 1] + Math.hypot(road[i].x - road[i - 1].x, road[i].y - road[i - 1].y));
      const total = lengths[n - 1] || 1, centre = road.reduce((acc, p) => ({x: acc.x + p.x / n, y: acc.y + p.y / n}), {x: 0, y: 0});
      const pointAt = fraction => { const target = Math.max(0, Math.min(1, fraction)) * total; let i = 1; while (i < n - 1 && lengths[i] < target) i++;
        const a = road[i - 1], b = road[i], t = (target - lengths[i - 1]) / ((lengths[i] - lengths[i - 1]) || 1); return {x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t}; };
      const items = guide.corners.filter(c => Number.isFinite(Number(c.trackPosition?.x))).map(c => {
        const index = nearest(Number(c.trackPosition.x), Number(c.trackPosition.y)), anchor = road[index];
        return {fraction: lengths[index] / total, label: `${c.number}${c.letter || ''}`, outward: {x: anchor.x - centre.x, y: anchor.y - centre.y}};
      });
      ctx.font = window.canvasFont?.(9, 600) || '600 10px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const beads = window.placeRoadBeads(ctx, items, {road, pointAt, width: w, height: h, roadHalf: 3.5});
      for (const {x, y, radius, point} of beads) {
        if (Math.hypot(point.x - x, point.y - y) <= radius + 3.5 + 14) continue;
        ctx.beginPath(); ctx.moveTo(point.x, point.y); ctx.lineTo(x, y); ctx.strokeStyle = light ? 'rgba(29,29,31,.6)' : 'rgba(229,229,234,.65)'; ctx.lineWidth = 1; ctx.stroke();
      }
      for (const {x, y, radius, label} of beads) {
        ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fillStyle = getComputedStyle(page).getPropertyValue('--lin-card').trim() || (light ? '#ffffff' : '#191a1b'); ctx.fill(); ctx.strokeStyle = light ? '#1d1d1f' : '#e5e5ea'; ctx.lineWidth = 1.1; ctx.stroke();
        ctx.fillStyle = light ? '#1d1d1f' : '#f2f2f4'; ctx.fillText(label, x, y + .5);
      }
      ctx.textAlign = 'left';
    }
  }
  function drawMap() {
    const canvas = $(page, 'map'), frame = sized(canvas); if (!frame) return;
    const {ctx, w, h} = frame, points = outline?.points || [], cars = Object.entries(state?.positions || {}).filter(([, p]) => p.x || p.y);
    if (!bounds || !outline?.complete) {
      const xs = [...points.map(p => p[0]), ...cars.map(([, p]) => p.x)], ys = [...points.map(p => p[1]), ...cars.map(([, p]) => p.y)];
      if (!xs.length) { ctx.fillStyle = css('--ui-tertiary') || '#888'; ctx.font = canvasFont(12); ctx.textAlign = 'center'; ctx.fillText('No car positions yet', w / 2, h / 2); return; }
      bounds = {x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys)};
    }
    const pad = 22, scale = Math.min((w - pad * 2) / Math.max(1, bounds.x1 - bounds.x0), (h - pad * 2) / Math.max(1, bounds.y1 - bounds.y0));
    const ox = (w - (bounds.x1 - bounds.x0) * scale) / 2, oy = (h - (bounds.y1 - bounds.y0) * scale) / 2;
    const px = x => ox + (x - bounds.x0) * scale, py = y => h - (oy + (y - bounds.y0) * scale);
    if (points.length > 2) drawRoad(ctx, points.map(([x, y]) => ({x: px(x), y: py(y)})), {w, h, px, py});
    const order = new Map((state?.drivers || []).map(d => [d.number, d]));
    // Leader drawn last, on top.
    cars.sort(([a], [b]) => (order.get(b)?.position ?? 99) - (order.get(a)?.position ?? 99));
    ctx.font = window.canvasFont?.(10, 600) || '600 11px system-ui'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    const labels = [];
    // Cars on track sit on the drawn road (their line differs a little from the learned one); cars in the pit lane are
    // hollow, dimmed rings at their real position, beside the road.
    const road = outline?.complete ? points.map(([rx, ry]) => [px(rx), py(ry)]) : [];
    const onRoad = (x, y) => {
      let best = null, dist = Infinity;
      for (let i = 0; i < road.length; i++) {
        const [ax, ay] = road[i], [bx, by] = road[(i + 1) % road.length], dx = bx - ax, dy = by - ay;
        const f = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1))), cx = ax + f * dx, cy = ay + f * dy, gap = Math.hypot(cx - x, cy - y);
        if (gap < dist) { dist = gap; best = [cx, cy]; }
      }
      return dist <= 12 ? best : null;
    };
    for (const [number, p] of cars) {
      const d = order.get(number) || {code: number}, picked = chosen.includes(number);
      const pit = d.in_pit || d.pit_out && false || (p.status && p.status !== 'OnTrack');
      let x = px(p.x), y = py(p.y);
      if (!pit) { const snapped = onRoad(x, y); if (snapped) [x, y] = snapped; }
      ctx.beginPath(); ctx.arc(x, y, picked ? 6.5 : 5, 0, Math.PI * 2);
      if (pit) {
        ctx.globalAlpha = .7; ctx.lineWidth = 2; ctx.strokeStyle = colour(d); ctx.stroke();
      } else {
        ctx.fillStyle = colour(d); ctx.fill();
        ctx.lineWidth = picked ? 2 : 1.2; ctx.strokeStyle = picked ? (css('--ui-label') || '#fff') : '#000000aa'; ctx.stroke();
        // A battle: within a second of the car ahead on the road.
        const gapAhead = parseFloat(String(d.interval || '').replace('+', ''));
        if (d.position > 1 && Number.isFinite(gapAhead) && gapAhead < 1 && !/L/i.test(String(d.interval))) {
          ctx.beginPath(); ctx.arc(x, y, (picked ? 6.5 : 5) + 3.5, 0, Math.PI * 2); ctx.lineWidth = 1.5; ctx.strokeStyle = '#ffd60a'; ctx.globalAlpha = .9; ctx.stroke(); ctx.globalAlpha = 1;
        }
      }
      if (picked || (d.position && d.position <= 3)) {
        // Labels never sit on each other: nudge down (then up) until the box is free.
        const text = d.code || number, width = ctx.measureText(text).width + 4;
        let ly = y, tries = 0;
        const hits = yy => labels.some(b => x + 8 < b.x + b.w && x + 8 + width > b.x && yy - 6 < b.y + 12 && yy + 6 > b.y);
        while (hits(ly) && tries < 8) { tries++; ly = y + (tries % 2 ? 1 : -1) * Math.ceil(tries / 2) * 12; }
        labels.push({x: x + 8, y: ly - 6, w: width});
        if (Math.abs(ly - y) > 4) { ctx.beginPath(); ctx.moveTo(x + 5, y); ctx.lineTo(x + 8, ly); ctx.strokeStyle = css('--ui-tertiary') || '#888'; ctx.lineWidth = 1; ctx.stroke(); }
        ctx.fillStyle = css('--ui-label') || '#fff'; ctx.fillText(text, x + 9, ly);
      }
      ctx.globalAlpha = 1;
    }
    // Wind: an arrow in the corner pointing where the wind blows to, with its speed.
    const wind = state?.weather || {}, from = Number(wind.wind_direction), speedMs = Number(wind.wind_speed);
    if (Number.isFinite(from) && Number.isFinite(speedMs)) {
      const cx = w - 28, cy = 28, a = (from + 180 - 90) * Math.PI / 180, r = 11;
      ctx.save(); ctx.strokeStyle = css('--ui-tertiary') || '#888'; ctx.fillStyle = css('--ui-tertiary') || '#888'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(cx, cy, r + 5, 0, Math.PI * 2); ctx.globalAlpha = .35; ctx.stroke(); ctx.globalAlpha = 1;
      const tx = cx + Math.cos(a) * r, ty = cy + Math.sin(a) * r, bx = cx - Math.cos(a) * r, by = cy - Math.sin(a) * r;
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(tx, ty); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tx - Math.cos(a - .5) * 5, ty - Math.sin(a - .5) * 5); ctx.lineTo(tx - Math.cos(a + .5) * 5, ty - Math.sin(a + .5) * 5); ctx.closePath(); ctx.fill();
      ctx.font = window.canvasFont?.(10, 500) || '500 10px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText(`${speedMs} m/s`, cx, cy + r + 9);
      ctx.restore();
    }
  }
  // ---------- start ----------
  function poll() {
    clearInterval(statusTimer);
    // The red dot stays current while another view is open; inside the view the stream keeps it current.
    statusTimer = setInterval(() => { if (!active && !document.hidden) api('status').then(status => { source = status.source; syncDot(); }).catch(() => {}); }, 15000);
  }
  const boot = () => {
    build(); buildButton(); place(); poll();
    api('status').then(applyStatus).catch(() => {});
  };
  // On the published site this runs after the PC connects, when the page has long finished loading.
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', boot); else boot();
  addEventListener('apex-skin', () => button && place());
  addEventListener('apex-theme', queueDraw);
  window.ApexLive = Object.freeze({enter, leave});
})();
