/* Live timing view: local compute only. The page talks to this PC's live service (/api/live/*),
   which reads F1's live feed with the user's own F1 TV sign-in, or replays a cached session through the same pipeline.
   Nothing here runs on the published site. All data-derived text is set with textContent. */
(() => {
  if (!window.APEX_LOCAL_MODE) return;
  // Its stylesheet ships separately (the published page never loads it), with this script's version.
  {
    const version = document.currentScript?.src.match(/\?v=[^&#]+/)?.[0] || '';
    for (const sheet of ['live.css', 'live-linear.css']) {
      const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = sheet + version;
      document.head.append(link);
    }
  }
  const root = document.documentElement;
  const $ = (scope, name) => scope.querySelector(`[data-live="${name}"]`);
  const SPEEDS = [1, 2, 5, 10, 30, 60];
  const TYRES = {SOFT: ['S', '#ff3b30'], MEDIUM: ['M', '#ffd60a'], HARD: ['H', '#f2f2f7'], INTERMEDIATE: ['I', '#34c759'], WET: ['W', '#0a84ff']};
  const FLAGS = {'2': 'yellow', '4': 'sc', '5': 'red', '6': 'vsc', '7': 'vsc'};
  let page, button, stream, statusTimer, active = false;
  let state = null, source = null, outline = null, telemetry = {}, bounds = null;
  const chosen = [];   // up to two driver numbers for the telemetry trace
  let lapLists = {}, compareTraces = [], lapsFetchedAt = 0, compareKey = '', currentLaps = null;
  // The laps being compared: [{driver, lap}] where lap is 'latest', 'fastest', 'last' or a lap number. The first is the reference.
  let picks = [], picksTouched = false;
  const MAX_PICKS = 4;
  let drawQueued = false;

  const api = (path, options = {}) => fetch('/api/live/' + path, {cache: 'no-store', ...options}).then(async r => {
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
            <span class="live-group-label">Live</span>
            <button type="button" class="live-button live-primary" data-live="connect">Connect</button>
            <span class="live-auth" data-live="auth"></span>
            <button type="button" class="live-button" data-live="signin" aria-expanded="false" aria-controls="liveSignin">Sign in to F1 TV</button>
            <button type="button" class="live-button live-quiet" data-live="signout" hidden>Sign out</button>
          </div>
          <div class="live-source-group live-replay" role="group" aria-label="Replay">
            <span class="live-group-label">Replay</span>
            <select id="liveReplay" data-live="replay" aria-label="Session to replay"></select>
            <select id="liveSpeed" data-live="speed" aria-label="Replay speed"></select>
            <label class="live-from">from <input data-live="from" type="number" min="0" step="5" value="0" inputmode="numeric" aria-label="Start minutes into the session"> min</label>
            <button type="button" class="live-button" data-live="play">Play</button>
            <button type="button" class="live-button" data-live="stop" hidden>Stop</button>
          </div>
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
        <div class="live-progress" data-live="progress" hidden><span></span></div>
      </section>
      <div class="live-grid">
        <div class="live-col live-col-main">
          <section class="dashboard-card live-tower" aria-label="Timing tower">
            <div class="live-card-head"><h2>Timing</h2><small>Select up to two drivers for telemetry</small></div>
            <div class="live-table-wrap"><table class="live-table">
              <thead><tr><th scope="col">P</th><th scope="col">Driver</th><th scope="col">Gap</th><th scope="col">Int</th><th scope="col">Last</th><th scope="col">S1</th><th scope="col">S2</th><th scope="col">S3</th><th scope="col">Best</th><th scope="col">Tyre</th><th scope="col">Pit</th></tr></thead>
              <tbody data-live="tower"><tr><td colspan="11" class="live-empty">Waiting for timing data.</td></tr></tbody>
            </table></div>
          </section>
        <section class="dashboard-card live-compare" aria-label="Compare completed laps">
          <div class="live-card-head">
            <div class="live-card-title"><h2>Compare laps</h2><small data-live="lapsNote">Completed laps from this session · aligned by track position</small></div>
            <div class="live-card-actions">
              <button type="button" class="live-button" data-live="quickLatest" title="The two leading drivers' latest push laps">Latest 2</button>
              <button type="button" class="live-button" data-live="quickFastest" title="The session's two fastest drivers, fastest laps">Fastest 2</button>
              <button type="button" class="live-button" data-live="backfill" title="Load the laps Formula 1 has published for this session, including those from before you connected">Reload laps</button>
            </div>
          </div>
          <div class="live-lap-chips" data-live="lapChips" role="list" aria-label="Laps being compared"></div>
          <div class="live-sector-table" data-live="sectorTable"></div>
          <div class="live-lap-picker" id="liveLapPicker" data-live="lapPicker" popover="auto" aria-label="Choose a lap">
            <div class="live-picker-head"><strong data-live="pickerTitle">Add a lap</strong><button type="button" class="live-picker-close" data-live="pickerClose" aria-label="Close">×</button></div>
            <div class="live-picker-drivers" data-live="pickerDrivers" role="group" aria-label="Driver"></div>
            <div class="live-picker-laps" data-live="pickerLaps" role="group" aria-label="Lap"></div>
          </div>
          <div class="live-charts" data-live="compareCharts" role="img" aria-label="Speed, time delta, throttle, brake and gear over the lap for the chosen laps"></div>
        </section>
        </div>
        <div class="live-col live-col-side">
          <section class="dashboard-card live-map-card" aria-label="Track map">
            <div class="live-card-head"><h2>Track</h2><small data-live="mapnote">Learning the circuit from car positions</small></div>
            <canvas data-live="map" role="img" aria-label="Car positions on track"></canvas>
          </section>
          <section class="dashboard-card live-telemetry-card" aria-label="Live telemetry">
            <div class="live-card-head"><h2>Telemetry</h2><small data-live="telenote">Current lap</small></div>
            <div class="live-readouts" data-live="readouts"></div>
            <div class="live-charts" data-live="traceCharts" role="img" aria-label="Speed, throttle and brake over the last 20 seconds"></div>
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
    $(page, 'play').addEventListener('click', () => {
      const path = $(page, 'replay').value; if (!path) return;
      start({mode: 'replay', path, speed: Number(speed.value), start: Math.max(0, Number($(page, 'from').value) || 0) * 60});
    });
    $(page, 'stop').addEventListener('click', () => post('stop').then(applyStatus).catch(showError));
    $(page, 'tower').addEventListener('click', event => {
      const row = event.target.closest('tr[data-number]'); if (!row) return;
      toggleDriver(row.dataset.number);
    });
    $(page, 'tower').addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const row = event.target.closest('tr[data-number]'); if (!row) return;
      event.preventDefault(); toggleDriver(row.dataset.number);
    });
    new ResizeObserver(() => queueDraw()).observe(page);
    $(page, 'quickFastest').addEventListener('click', () => quickPicks('fastest'));
    $(page, 'quickLatest').addEventListener('click', () => quickPicks('latest'));
    $(page, 'pickerClose').addEventListener('click', () => $(page, 'lapPicker').hidePopover?.());
    $(page, 'lapChips').addEventListener('click', event => {
      const remove = event.target.closest('[data-remove]');
      if (remove) { picks.splice(Number(remove.dataset.remove), 1); picksTouched = true; renderChips(); loadCompare(); return; }
      const chip = event.target.closest('[data-pick]');
      if (chip) openPicker(chip, chip.dataset.pick === 'add' ? null : Number(chip.dataset.pick));
    });
  }

  function buildButton() {
    button = document.createElement('button');
    button.type = 'button'; button.id = 'liveViewButton'; button.className = 'live-view-button';
    button.setAttribute('aria-pressed', 'false'); button.title = 'Live timing';
    button.innerHTML = '<span class="live-dot" aria-hidden="true"></span><span class="live-view-label">Live</span>';
    button.addEventListener('click', () => (active ? null : enter()));
  }

  // macOS look: a pill beside the view tabs. Linear look: a row in the rail's Analysis section.
  function place() {
    const rail = root.dataset.skin === 'linear' && document.querySelector('#linearWorkspace .linear-navigation');
    if (rail) rail.append(button);
    // macOS look: the third segment of the view tabs (Session analysis · Car performance · Live), not a separate pill.
    else (document.querySelector('.site-header .performance-tabs') || document.querySelector('.site-header .header-actions'))?.append(button);
  }

  // ---------- entering and leaving the view ----------
  function enter() {
    active = true;
    document.querySelectorAll('[data-analysis-view]').forEach(tab => tab.setAttribute('aria-selected', 'false'));
    document.body.classList.add('live-view');
    page.hidden = false; button.setAttribute('aria-pressed', 'true');
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
    page.hidden = true; button.setAttribute('aria-pressed', 'false');
    disconnect();
  }
  // Any of the existing view tabs takes the page back; their own handlers then show their view.
  document.addEventListener('click', event => { if (event.target.closest?.('[data-analysis-view]')) leave(); }, true);

  // ---------- data ----------
  function connect() {
    disconnect();
    stream = new EventSource('/api/live/stream' + (chosen.length ? '?drivers=' + chosen.join(',') : ''));
    stream.onmessage = event => {
      let payload; try { payload = JSON.parse(event.data); } catch { return; }
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
      help.hidden = true;
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
      state = null; outline = null; telemetry = {}; bounds = null; lapLists = {}; compareTraces = []; compareKey = ''; picks = []; picksTouched = false;
      applyStatus({...(await post('start', body)), replays: null});
      connect(); render();
    } catch (error) { showError(error); help.hidden = false; }
  }
  function showError(error) {
    const help = $(page, 'help'); help.hidden = false; help.textContent = error.message || String(error);
  }
  function toggleDriver(number) {
    const at = chosen.indexOf(number);
    if (at >= 0) chosen.splice(at, 1); else { chosen.push(number); if (chosen.length > 2) chosen.shift(); }
    telemetry = {}; currentLaps = null; renderTower(); renderReadouts(); queueDraw();
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
    $(page, 'stop').textContent = source?.kind === 'live' ? 'Disconnect' : 'Stop';
    $(page, 'connect').textContent = running && source.kind === 'live' ? (source.connected === false ? 'Reconnecting…' : 'Connected') : 'Connect';
    $(page, 'connect').disabled = running && source.kind === 'live';
    if (running && source.kind === 'replay') {
      const speed = $(page, 'speed');
      if ([...speed.options].some(o => Number(o.value) === Number(source.speed)) && Number(speed.value) !== Number(source.speed)) { speed.value = String(source.speed); window.syncSelectUI?.(speed); }
    }
    if (source?.waiting) { const help = $(page, 'help'); help.hidden = false; help.textContent = source.waiting; }
    if (source?.error) showError({message: source.error});
    const progress = $(page, 'progress');
    progress.hidden = !(source?.kind === 'replay' && source.duration);
    if (!progress.hidden) progress.firstElementChild.style.width = Math.min(100, 100 * (source.position || 0) / source.duration) + '%';
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
    renderTower(); renderWeather(); renderRaceControl(); renderReadouts(); queueDraw();
    if (Date.now() - lapsFetchedAt > 2000) refreshLaps();
    backfill();
  }
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
      label.append(bar, el('strong', null, d.code), el('small', null, d.number)); name.append(label); row.append(name);
      row.append(el('td', 'live-gap', d.position === 1 ? (state.session?.type === 'Race' ? 'Leader' : '') : d.gap || ''));
      row.append(el('td', 'live-gap', d.position === 1 ? '' : d.interval || ''));
      timeCell(row, d.last?.time, d.last);
      for (let i = 0; i < 3; i++) timeCell(row, d.sectors?.[i]?.time, d.sectors?.[i] || {});
      timeCell(row, d.best);
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
    body.replaceChildren(...rows);
  }
  function renderWeather() {
    const w = state.weather || {}, list = $(page, 'weather'), items = [];
    const add = (label, value) => { if (value == null || value === '') return; items.push(el('dt', null, label), el('dd', null, value)); };
    add('Air', w.air && `${w.air} °C`); add('Track', w.track && `${w.track} °C`); add('Humidity', w.humidity && `${w.humidity}%`);
    add('Wind', w.wind_speed && `${w.wind_speed} m/s${w.wind_direction ? ' · ' + w.wind_direction + '°' : ''}`);
    add('Rain', w.rain == null ? null : (String(w.rain) === '1' || w.rain === true ? 'Yes' : 'No'));
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
          note.textContent = status.error || `Completed laps from this session · ${status.laps} loaded from Formula 1 · aligned by lap distance`;
          lapsFetchedAt = 0; refreshLaps();
          return;
        }
      }
    } catch (error) { note.textContent = error.message || String(error); }
  }

  // ---------- completed lap comparison: up to four laps, the first is the reference ----------
  async function refreshLaps() {
    lapsFetchedAt = Date.now();
    if (refreshLaps.busy) return;
    refreshLaps.busy = true;
    try { lapLists = await api('laps'); } catch { return; } finally { refreshLaps.busy = false; }
    if (!picksTouched) defaultPicks();
    picks = picks.filter(p => (lapLists[p.driver] || []).length);
    // Colours follow the session as it runs: a new session or personal best elsewhere recolours these laps at once.
    renderChips(); renderSectorTable(); loadCompare();
    if ($(page, 'lapPicker').matches?.(':popover-open')) renderPicker();
  }
  const lapMode = () => (source?.kind === 'live' ? 'latest' : 'fastest');
  const driversWithLaps = () => (state?.drivers || []).filter(d => (lapLists[d.number] || []).length);
  function defaultPicks() {
    let drivers = driversWithLaps();
    if (lapMode() === 'fastest') drivers = drivers.slice().sort((a, b) => (resolve({driver: a.number, lap: 'fastest'})?.seconds || Infinity) - (resolve({driver: b.number, lap: 'fastest'})?.seconds || Infinity));
    picks = drivers.slice(0, 2).map(d => ({driver: d.number, lap: lapMode()}));
  }
  function quickPicks(mode) {
    // Fastest 2: the two quickest drivers by their fastest captured lap; Latest 2: the two leading drivers' latest push laps.
    let drivers = driversWithLaps();
    if (mode === 'fastest') drivers = drivers.slice().sort((a, b) => (resolve({driver: a.number, lap: 'fastest'})?.seconds || Infinity) - (resolve({driver: b.number, lap: 'fastest'})?.seconds || Infinity));
    picks = drivers.slice(0, 2).map(d => ({driver: d.number, lap: mode}));
    picksTouched = true; renderChips(); loadCompare();
  }
  // The lap a pick points at now ('latest' and 'fastest' move on as laps complete).
  function resolve(pick) {
    const laps = lapLists[pick.driver] || [];
    if (pick.lap === 'latest') return laps.filter(l => l.push).at(-1) || null;
    if (pick.lap === 'fastest') return laps.find(l => l.fastest) || null;
    if (pick.lap === 'last') return laps.at(-1) || null;
    return laps.find(l => l.lap === Number(pick.lap)) || null;
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
    const chips = picks.map((pick, i) => {
      const lap = resolve(pick), d = driverFor(pick.driver);
      const chip = el('div', 'live-lap-chip'); chip.setAttribute('role', 'listitem'); chip.style.setProperty('--team', colours[i]);
      const body = el('button', 'live-lap-chip-body'); body.type = 'button'; body.dataset.pick = String(i);
      body.setAttribute('aria-label', `Change lap ${i + 1}: ${d.code} ${lap ? 'lap ' + lap.lap : ''}`);
      body.append(el('i'), el('strong', null, d.code), el('span', null, lap ? `L${lap.lap}` : '—'), el('b', null, lap?.time || 'no lap yet'));
      if (typeof pick.lap === 'string') body.append(el('small', 'live-lap-mode', MODE_NAMES[pick.lap]));
      body.append(el('small', i ? 'live-lap-gap' : 'live-lap-ref', i ? (lap?.seconds && ref?.seconds ? formatGap(lap.seconds - ref.seconds) : '') : 'Reference'));
      const remove = el('button', 'live-lap-chip-remove', '×'); remove.type = 'button'; remove.dataset.remove = String(i);
      remove.setAttribute('aria-label', `Remove ${d.code} lap from the comparison`);
      chip.append(body, remove);
      return chip;
    });
    if (picks.length < MAX_PICKS) {
      const add = el('button', 'live-lap-add', '+ Add lap'); add.type = 'button'; add.dataset.pick = 'add';
      add.disabled = !driversWithLaps().length; chips.push(add);
    }
    if (!driversWithLaps().length) chips.unshift(el('p', 'live-empty', 'Laps appear here as drivers complete them.'));
    box.replaceChildren(...chips);
  }
  // The picker: drivers in running order, then the chosen driver's laps.
  let pickerTarget = null, pickerDriver = null;
  function openPicker(anchor, index) {
    pickerTarget = index; pickerDriver = index == null ? (driversWithLaps().find(d => !picks.some(p => p.driver === d.number)) || driversWithLaps()[0])?.number : picks[index].driver;
    const picker = $(page, 'lapPicker');
    $(page, 'pickerTitle').textContent = index == null ? 'Add a lap' : `Change lap ${index + 1}`;
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
    const drivers = driversWithLaps(), current = pickerTarget == null ? null : picks[pickerTarget];
    $(page, 'pickerDrivers').replaceChildren(...drivers.map(d => {
      const b = el('button', 'live-picker-driver'); b.type = 'button';
      b.setAttribute('aria-pressed', String(d.number === pickerDriver)); b.style.setProperty('--team', colour(d));
      b.append(el('i'), el('strong', null, d.code), el('small', null, d.position ? `P${d.position}` : ''));
      b.addEventListener('click', () => { pickerDriver = d.number; renderPicker(); });
      return b;
    }));
    const laps = lapLists[pickerDriver] || [], best = driverFor(pickerDriver).best;
    const row = (value, title, lap, extra = '') => {
      const b = el('button', 'live-picker-lap'); b.type = 'button';
      const selected = current && current.driver === pickerDriver && String(current.lap) === String(value);
      b.setAttribute('aria-pressed', String(!!selected));
      b.append(el('span', null, title), el('b', null, lap?.time || '—'));
      if (extra) b.append(el('small', null, extra));
      if (lap?.fastest) b.classList.add('is-fastest');
      if (lap?.pit) b.classList.add('is-pit');
      b.disabled = !lap;
      b.addEventListener('click', () => choose(value));
      return b;
    };
    const latest = laps.filter(l => l.push).at(-1), fastest = laps.find(l => l.fastest);
    const missed = best && fastest?.time && fastest.time !== best && lapSecondsOf(best) < (fastest.seconds || Infinity);
    const rows = [
      row('latest', latest ? `Latest push · L${latest.lap}` : 'Latest push lap', latest, 'follows new laps'),
      row('fastest', fastest ? `Fastest · L${fastest.lap}` : 'Fastest lap', fastest, missed ? `best ${best} loads after the session` : 'follows new bests'),
      el('div', 'live-picker-rule'),
      ...laps.slice().reverse().map(l => row(l.lap, `Lap ${l.lap}`, l, l.pit ? 'pit lap' : l.push ? '' : 'not a push lap')),
    ];
    $(page, 'pickerLaps').replaceChildren(...rows);
  }
  function choose(value) {
    if (!$(page, 'lapPicker').matches?.(':popover-open') || (pickerTarget == null && picks.length >= MAX_PICKS)) return;
    const pick = {driver: pickerDriver, lap: value};
    if (pickerTarget == null) picks.push(pick); else picks[pickerTarget] = pick;
    picksTouched = true;
    $(page, 'lapPicker').hidePopover?.();
    renderChips(); loadCompare();
  }
  async function loadCompare() {
    // Fetch again only when a pick changed, or the lap a moving pick points at moved on (or got its time).
    const key = picks.map(p => { const lap = resolve(p); return `${p.driver}:${p.lap}:${lap?.lap}:${lap?.time || ''}`; }).join('|');
    if (key === compareKey) return;
    compareKey = key;
    compareTraces = await Promise.all(picks.map(p => {
      const lap = resolve(p);
      return lap ? api(`lap?driver=${encodeURIComponent(p.driver)}&lap=${lap.lap}`).catch(() => null) : null;
    }));
    renderChips(); renderSectorTable(); queueDraw();
  }
  // Sector times of the compared laps in F1's colours for the session: purple the session's fastest, green the driver's
  // personal best, yellow neither. The bests come from every lap of the session the app holds (F1's own flags are only
  // true at the moment a lap finishes). The gap to the reference sits underneath in neutral grey.
  function sessionBests() {
    const overall = [Infinity, Infinity, Infinity, Infinity], personal = {};
    for (const [number, laps] of Object.entries(lapLists)) {
      const mine = personal[number] = [Infinity, Infinity, Infinity, Infinity];
      for (const lap of laps) {
        const values = [...(lap.sectors || []).slice(0, 3).map(sector => sector?.seconds), lap.pit ? null : lap.seconds];
        values.forEach((v, k) => { if (v) { mine[k] = Math.min(mine[k], v); overall[k] = Math.min(overall[k], v); } });
      }
    }
    return {overall, personal};
  }
  function renderSectorTable() {
    const box = $(page, 'sectorTable'), colours = pickColours();
    const rows = compareTraces.map((trace, i) => trace && {trace, colour: colours[i]}).filter(Boolean);
    if (!rows.length || !rows.some(r => r.trace.sectors?.length === 3)) { box.replaceChildren(); return; }
    const value = (r, k) => (k < 3 ? r.trace.sectors?.[k]?.seconds : r.trace.seconds) ?? null;
    const text = (r, k) => (k < 3 ? r.trace.sectors?.[k]?.time : r.trace.time) || null;
    const bests = sessionBests(), close = (a, b) => Math.abs(a - b) < 0.0005;
    const grid = el('div', 'live-sectors'); grid.setAttribute('role', 'table'); grid.setAttribute('aria-label', 'Sector times of the compared laps');
    const head = el('div', 'live-sectors-row is-head'); head.setAttribute('role', 'row');
    ['Lap', 'Sector 1', 'Sector 2', 'Sector 3', 'Lap time'].forEach((label, k) => { const c = el('span', null, label); c.setAttribute('role', k ? 'columnheader' : 'rowheader'); head.append(c); });
    grid.append(head);
    rows.forEach((r, i) => {
      const row = el('div', 'live-sectors-row'); row.setAttribute('role', 'row');
      const who = el('div', 'live-sectors-who'); who.setAttribute('role', 'rowheader'); who.style.setProperty('--team', r.colour);
      who.append(el('i'), el('strong', null, driverFor(r.trace.driver).code), el('small', null, `L${r.trace.lap}`));
      row.append(who);
      for (let k = 0; k < 4; k++) {
        const v = value(r, k), ref = value(rows[0], k), cell = el('div', 'live-sectors-cell'); cell.setAttribute('role', 'cell');
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
    [['#bf5af2', 'Session best'], ['#30d158', 'Personal best'], ['#ffd60a', 'Neither'], [null, 'Gaps against the first lap: − faster, + slower']].forEach(([tone, label]) => {
      const item = el('span'); if (tone) { const bar = el('i'); bar.style.setProperty('--tone', tone); item.append(bar); } item.append(label); legend.append(item);
    });
    box.replaceChildren(grid, legend);
  }

  // Time at a given distance along a lap (linear interpolation).
  function timeAt(trace, x) {
    const xs = trace.x; let lo = 0, hi = xs.length - 1;
    // Before the first or after the last sample (a lap's samples start a few metres either side of the line): carry on at
    // that sample's speed rather than holding its time.
    if (x <= xs[0]) return trace.t[0] - (xs[0] - x) / Math.max(5, (trace.speed?.[0] || 0) / 3.6);
    if (x >= xs[hi]) return trace.t[hi] + (x - xs[hi]) / Math.max(5, (trace.speed?.[hi] || 0) / 3.6);
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (xs[mid] < x) lo = mid; else hi = mid; }
    const f = (x - xs[lo]) / ((xs[hi] - xs[lo]) || 1);
    return trace.t[lo] + f * (trace.t[hi] - trace.t[lo]);
  }
  // ---------- charts in the main site's style: one panel per channel, theme colours, tinted speed, crosshair ----------
  const theme = () => window.canvasTheme?.() || {text: '#8a8f98', textStrong: '#f7f8f8', grid: 'rgba(255,255,255,.06)', gridStrong: 'rgba(255,255,255,.18)', crosshair: 'rgba(255,255,255,.4)', labelStroke: '#0f1011'};
  const font = (size, weight) => window.canvasFont?.(size, weight) || `${weight || 400} ${size + 1}px system-ui, sans-serif`;
  const rgba = (hex, alpha) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
    if (!m) return hex;
    const n = parseInt(m[1], 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${alpha})`;
  };
  // The feed holds a value until it changes; drawing every held repeat makes stairs. Keep the first sample of each run.
  function changes(xs, ys) {
    const out = [];
    for (let i = 0; i < xs.length; i++) {
      if (ys[i] == null) { out.push([xs[i], null]); continue; }
      if (i && ys[i] === ys[i - 1] && i < xs.length - 1 && ys[i + 1] === ys[i]) continue;
      out.push([xs[i], ys[i]]);
    }
    return out;
  }
  const PANEL_HEIGHTS = {speed: 210, delta: 104, throttle: 96, brake: 58, gear: 96};
  function panels(container, specs) {
    // One canvas per channel, created once per layout, like the main site's chart cards.
    const key = specs.map(p => p.id).join(',');
    if (container.dataset.layout !== key) {
      container.dataset.layout = key;
      container.replaceChildren(...specs.map(spec => {
        const figure = el('figure', 'live-chart'); figure.dataset.panel = spec.id;
        const head = el('figcaption'); head.append(el('strong', null, spec.title), el('small', null, spec.unit || ''));
        const canvas = el('canvas'); canvas.style.height = (spec.height || PANEL_HEIGHTS[spec.id] || 96) + 'px';
        figure.append(head, canvas);
        return figure;
      }));
    }
    return specs.map(spec => [spec, container.querySelector(`[data-panel="${spec.id}"] canvas`)]);
  }
  const PLOT = {left: 46, right: 12, top: 8, bottom: 8};
  function drawPanel(canvas, spec, series, view, hover) {
    const frame = sized(canvas); if (!frame) return;
    const {ctx, w, h} = frame, t = theme(), last = spec.axis;
    const bottom = PLOT.bottom + (last ? 16 : 0), plotW = w - PLOT.left - PLOT.right, plotH = h - PLOT.top - bottom;
    const X = x => PLOT.left + (x - view.min) / ((view.max - view.min) || 1) * plotW;
    const Y = v => PLOT.top + (spec.max - v) / ((spec.max - spec.min) || 1) * plotH;
    // grid and tick labels
    ctx.font = font(11); ctx.textBaseline = 'middle'; ctx.textAlign = 'right';
    for (const tick of spec.ticks) {
      const y = Y(tick.value);
      ctx.beginPath(); ctx.moveTo(PLOT.left, y); ctx.lineTo(w - PLOT.right, y);
      ctx.strokeStyle = tick.strong ? t.gridStrong : t.grid; ctx.lineWidth = tick.strong ? 1.2 : 1; ctx.stroke();
      ctx.fillStyle = tick.strong ? t.textStrong : t.text; ctx.fillText(tick.label, PLOT.left - 8, y);
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    for (const mark of view.marks) {
      const x = X(mark.value);
      ctx.beginPath(); ctx.moveTo(x, PLOT.top); ctx.lineTo(x, PLOT.top + plotH); ctx.strokeStyle = t.grid; ctx.lineWidth = 1; ctx.stroke();
      if (last) { ctx.fillStyle = t.text; ctx.fillText(mark.label, x, h - 6); }
    }
    if (view.sectors?.length === 2) {
      ctx.save(); ctx.setLineDash([4, 4]); ctx.strokeStyle = t.gridStrong; ctx.lineWidth = 1;
      for (const at of view.sectors) { const x = X(at); ctx.beginPath(); ctx.moveTo(x, PLOT.top); ctx.lineTo(x, PLOT.top + plotH); ctx.stroke(); }
      ctx.restore();
      if (spec.id === 'speed') {
        const edges = [view.min, ...view.sectors, view.max];
        ctx.font = font(10, 600); ctx.fillStyle = t.text; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        for (let k = 0; k < 3; k++) ctx.fillText(`SECTOR ${k + 1}`, X((edges[k] + edges[k + 1]) / 2), PLOT.top + 2);
        ctx.font = font(11); ctx.textBaseline = 'alphabetic';
      }
    }
    ctx.save(); ctx.beginPath(); ctx.rect(PLOT.left, PLOT.top - 2, plotW, plotH + 4); ctx.clip();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    series.forEach((line, index) => {
      const points = line.points.filter(([x]) => x >= view.min - 1 && x <= view.max + 1);
      if (points.length < 2) return;
      const path = () => {
        ctx.beginPath(); let previous = null;
        for (const [x, v] of points) {
          if (v == null) { previous = null; continue; }
          const px = X(x), py = Y(Math.max(spec.min, Math.min(spec.max, v)));
          if (!previous) ctx.moveTo(px, py);
          else { if (spec.steps) ctx.lineTo(px, previous[1]); ctx.lineTo(px, py); }
          previous = [px, py];
        }
      };
      if (spec.tint) {
        path(); ctx.lineTo(X(points.at(-1)[0]), PLOT.top + plotH); ctx.lineTo(X(points[0][0]), PLOT.top + plotH); ctx.closePath();
        const gradient = ctx.createLinearGradient(0, PLOT.top, 0, PLOT.top + plotH);
        gradient.addColorStop(0, rgba(line.colour, .14 / Math.sqrt(series.length))); gradient.addColorStop(1, rgba(line.colour, 0));
        ctx.fillStyle = gradient; ctx.fill();
      }
      path(); ctx.strokeStyle = line.colour; ctx.lineWidth = (index ? 1.12 : 1.44) * (spec.id === 'speed' ? 1.15 : 1); ctx.stroke();
    });
    ctx.restore();
    if (spec.id === 'speed') {
      ctx.save(); ctx.translate(11, PLOT.top + plotH / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center';
      ctx.font = font(10, 500); ctx.fillStyle = t.text; ctx.fillText('Speed [km/h]', 0, 0); ctx.restore();
    }
    // crosshair with each line's value
    if (hover != null && hover >= view.min && hover <= view.max) {
      const x = X(hover);
      ctx.beginPath(); ctx.moveTo(x, PLOT.top); ctx.lineTo(x, PLOT.top + plotH); ctx.strokeStyle = t.crosshair || t.gridStrong; ctx.lineWidth = 1; ctx.stroke();
      const labels = [];
      series.forEach(line => {
        const v = valueAt(line.points, hover, spec.steps); if (v == null) return;
        ctx.beginPath(); ctx.arc(x, Y(Math.max(spec.min, Math.min(spec.max, v))), 3, 0, Math.PI * 2);
        ctx.fillStyle = line.colour; ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = t.labelStroke || '#000'; ctx.stroke();
        labels.push([line.colour, spec.format(v)]);
      });
      ctx.font = font(11, 600); ctx.textBaseline = 'top';
      let lx = x + 8; const widths = labels.map(([, text]) => ctx.measureText(text).width + 14);
      if (lx + widths.reduce((a, b) => a + b, 0) > w - PLOT.right) lx = x - 8 - widths.reduce((a, b) => a + b, 0);
      labels.forEach(([colour, text], i) => {
        ctx.fillStyle = colour; ctx.fillRect(lx, PLOT.top + 4, 3, 12);
        ctx.fillStyle = t.textStrong; ctx.textAlign = 'left'; ctx.fillText(text, lx + 6, PLOT.top + 4);
        lx += widths[i];
      });
    }
  }
  function valueAt(points, x, steps) {
    let lo = 0, hi = points.length - 1;
    if (hi < 0 || x < points[0][0] || x > points[hi][0]) return null;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (points[mid][0] <= x) lo = mid; else hi = mid; }
    const [x0, v0] = points[lo], [x1, v1] = points[hi];
    if (v0 == null || v1 == null || steps) return v0;
    return v0 + (v1 - v0) * ((x - x0) / ((x1 - x0) || 1));
  }
  const SPECS = {
    speed: {id: 'speed', title: 'Speed', unit: 'km/h', min: 0, max: 350, tint: true, ticks: [100, 200, 300].map(v => ({value: v, label: v})), format: v => `${Math.round(v)} km/h`},
    delta: {id: 'delta', title: 'Time delta', unit: 'seconds, second lap against the first', steps: false, format: v => `${v > 0 ? '+' : ''}${v.toFixed(3)} s`},
    throttle: {id: 'throttle', title: 'Throttle', unit: '%', min: 0, max: 100, ticks: [0, 50, 100].map(v => ({value: v, label: v})), format: v => `${Math.round(v)}%`},
    brake: {id: 'brake', title: 'Brake', unit: 'on / off', min: 0, max: 100, steps: true, ticks: [{value: 0, label: 'OFF'}, {value: 100, label: 'ON'}], format: v => (v ? 'ON' : 'OFF')},
    gear: {id: 'gear', title: 'Gear', unit: '', min: 1, max: 8, steps: true, ticks: [2, 4, 6, 8].map(v => ({value: v, label: v})), format: v => `Gear ${Math.round(v)}`},
  };
  let compareHover = null, traceHover = null;
  function bindHover(container, toValue, set) {
    if (container.dataset.hover) return;
    container.dataset.hover = '1';
    container.addEventListener('pointermove', event => {
      const canvas = event.target.closest('canvas'); if (!canvas) return;
      const r = canvas.getBoundingClientRect(), f = (event.clientX - r.left - PLOT.left) / (r.width - PLOT.left - PLOT.right);
      set(f < 0 || f > 1 ? null : toValue(f)); queueDraw();
    });
    container.addEventListener('pointerleave', () => { set(null); queueDraw(); });
  }
  function drawCompare() {
    const container = $(page, 'compareCharts'), colours = pickColours();
    const traces = compareTraces.map((t, i) => t && {trace: t, colour: colours[i]}).filter(Boolean);
    if (!traces.length) { container.replaceChildren(el('p', 'live-empty', 'Add laps to compare their telemetry.')); container.dataset.layout = ''; return; }
    const length = Math.max(...traces.map(({trace}) => trace.x.at(-1) || 0));
    const view = {min: 0, max: length, marks: [], sectors: (compareTraces.find(Boolean) || {}).sector_marks || null};
    for (let m = 1000; m < length; m += 1000) view.marks.push({value: m, label: `${m / 1000} km`});
    const ids = traces.length > 1 ? ['speed', 'delta', 'throttle', 'brake', 'gear'] : ['speed', 'throttle', 'brake', 'gear'];
    const list = panels(container, ids.map(id => ({...SPECS[id], unit: id === 'delta' ? `seconds against ${driverFor(traces[0].trace.driver).code} L${traces[0].trace.lap}` : SPECS[id].unit, axis: id === 'gear'})));
    bindHover(container, f => f * length, v => { compareHover = v; });
    // Captions are created once per layout; keep the reference named in the delta caption current.
    const deltaCaption = container.querySelector('[data-panel="delta"] figcaption small');
    if (deltaCaption) deltaCaption.textContent = `seconds against ${driverFor(traces[0].trace.driver).code} L${traces[0].trace.lap}`;
    for (const [spec, canvas] of list) {
      let series;
      if (spec.id === 'delta') {
        // Each lap's clock starts at the timing line and is scaled to its official lap time, so each line ends on the
        // official gap to the reference; a short moving average removes the position feed's sampling jitter.
        const span = Math.min(...traces.map(({trace}) => trace.x.at(-1)));
        const clock = trace => {
          const t0 = timeAt(trace, 0), tEnd = timeAt(trace, span), scale = trace.seconds && tEnd > t0 ? trace.seconds / (tEnd - t0) : 1;
          return x => (timeAt(trace, x) - t0) * scale;
        };
        const reference = clock(traces[0].trace);
        series = traces.slice(1).map(({trace, colour: c}) => {
          const other = clock(trace), raw = [];
          for (let k = 0; k <= 400; k++) { const x = span * k / 400; raw.push([x, other(x) - reference(x)]); }
          return {colour: c, points: raw.map(([x], k) => {
            const reach = Math.min(k, raw.length - 1 - k, 4);
            let sum = 0; for (let j = k - reach; j <= k + reach; j++) sum += raw[j][1];
            return [x, sum / (2 * reach + 1)];
          })};
        });
        const range = Math.max(.1, ...series.flatMap(line => line.points.map(([, d]) => Math.abs(d))));
        const step = [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5].find(st => range / st <= 2.5) || 5;
        const top = Math.ceil(range / step) * step;
        // Finer steps: a labelled gridline every half step either side of zero.
        Object.assign(spec, {min: -top, max: top, ticks: [-top, -top / 2, 0, top / 2, top].map(v => ({value: v, label: v ? `${v > 0 ? '+' : ''}${v.toFixed(step <= .1 ? 2 : step < 1 ? 2 : 1)}` : '0', strong: !v}))});
      } else {
        series = traces.map(({trace, colour: c}) => ({colour: c, points: spec.id === 'brake' || spec.id === 'gear' ? trace.x.map((x, i) => [x, trace[spec.id][i]]) : changes(trace.x, trace[spec.id])}));
      }
      drawPanel(canvas, spec, series, view, compareHover);
    }
  }
  // The chosen cars' current laps over the full lap distance (line to line), filling in as they go round.
  function drawTrace() {
    const container = $(page, 'traceCharts');
    const laps = currentLaps?.laps || {};
    const series = chosen.map(n => [n, laps[n]]).filter(([, lap]) => lap?.x?.length > 1);
    if (!series.length) {
      container.replaceChildren(el('p', 'live-empty', chosen.length ? 'Waiting for this lap\'s telemetry (it starts at the line).' : 'Select a driver in the timing tower.')); container.dataset.layout = '';
      return;
    }
    const length = currentLaps.length || Math.max(...series.map(([, lap]) => lap.x.at(-1)));
    const view = {min: 0, max: length, marks: [], sectors: currentLaps?.sector_marks || null};
    for (let m = 1000; m < length; m += 1000) view.marks.push({value: m, label: `${m / 1000} km`});
    $(page, 'telenote').textContent = `Current lap · ${series.map(([n, lap]) => `${driverFor(n).code} L${lap.lap}`).join(' · ')}`;
    const list = panels(container, ['speed', 'throttle', 'brake'].map(id => ({...SPECS[id], height: id === 'speed' ? 150 : id === 'brake' ? 48 : 72, axis: id === 'brake'})));
    bindHover(container, f => f * length, v => { traceHover = v; });
    for (const [spec, canvas] of list) {
      const lines = series.map(([number, lap]) => ({colour: colour(driverFor(number)),
        points: spec.id === 'brake' ? lap.x.map((x, i) => [x, lap.brake[i]]) : changes(lap.x, lap[spec.id])}));
      drawPanel(canvas, spec, lines, view, traceHover);
    }
  }

  // ---------- canvases ----------
  function queueDraw() { if (drawQueued) return; drawQueued = true; requestAnimationFrame(() => { drawQueued = false; if (active) { drawMap(); drawTrace(); drawCompare(); } }); }
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
      fetch(`/api/circuit-guide?key=${encodeURIComponent(key)}&year=${encodeURIComponent(year)}`).then(r => (r.ok ? r.json() : null))
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
        ctx.strokeStyle = getComputedStyle(page).getPropertyValue('--ui-panel').trim() || (light ? '#fff' : '#161618'); ctx.lineWidth = 9; ctx.stroke(); ctx.lineWidth = 7; });
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
        ctx.fillStyle = light ? '#ffffff' : '#1c1c1e'; ctx.fill(); ctx.strokeStyle = light ? '#1d1d1f' : '#e5e5ea'; ctx.lineWidth = 1.1; ctx.stroke();
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
      if (!xs.length) { ctx.fillStyle = css('--ui-tertiary') || '#888'; ctx.font = '13px var(--ui-font, system-ui)'; ctx.textAlign = 'center'; ctx.fillText('No car positions yet', w / 2, h / 2); return; }
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
  }
  // ---------- start ----------
  function poll() {
    clearInterval(statusTimer);
    // The red dot stays current while another view is open; inside the view the stream keeps it current.
    statusTimer = setInterval(() => { if (!active && !document.hidden) api('status').then(status => { source = status.source; syncDot(); }).catch(() => {}); }, 15000);
  }
  addEventListener('DOMContentLoaded', () => {
    build(); buildButton(); place(); poll();
    api('status').then(applyStatus).catch(() => {});
  });
  addEventListener('apex-skin', () => button && place());
  window.ApexLive = Object.freeze({enter, leave});
})();
