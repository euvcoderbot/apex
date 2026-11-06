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
  let lapLists = {}, compareTraces = [null, null], lapsFetchedAt = 0, compareKey = '', currentLaps = null;
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
          <div class="live-source-group">
            <button type="button" class="live-button live-primary" data-live="connect">Connect to live timing</button>
            <span class="live-auth" data-live="auth"></span>
            <button type="button" class="live-button" data-live="signin" aria-expanded="false" aria-controls="liveSignin">Sign in to F1 TV</button>
            <button type="button" class="live-button live-quiet" data-live="signout" hidden>Sign out</button>
          </div>
          <div class="live-source-group live-replay">
            <label>Replay <select id="liveReplay" data-live="replay" aria-label="Session to replay"></select></label>
            <label>Speed <select id="liveSpeed" data-live="speed" aria-label="Replay speed"></select></label>
            <label>From <input data-live="from" type="number" min="0" step="5" value="0" inputmode="numeric" aria-label="Start minutes into the session"> min</label>
            <button type="button" class="live-button" data-live="play">Replay</button>
          </div>
          <button type="button" class="live-button" data-live="stop" hidden>Stop</button>
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
          <div class="live-card-head"><h2>Compare laps</h2><small data-live="lapsNote">Completed laps from this session · aligned by lap distance</small></div>
          <div class="live-compare-pickers">
            <div class="live-compare-pick"><span class="live-compare-key"></span>
              <label>Driver <select id="liveCompareDriverA" data-live="driverA" aria-label="First driver"></select></label>
              <label>Lap <select id="liveCompareLapA" data-live="lapA" aria-label="First driver's lap"></select></label></div>
            <div class="live-compare-pick"><span class="live-compare-key is-second"></span>
              <label>Driver <select id="liveCompareDriverB" data-live="driverB" aria-label="Second driver"></select></label>
              <label>Lap <select id="liveCompareLapB" data-live="lapB" aria-label="Second driver's lap"></select></label></div>
            <button type="button" class="live-button" data-live="bothFastest">Both fastest laps</button>
          <button type="button" class="live-button" data-live="backfill" title="Load the laps Formula 1 has published for this session, including those from before you connected">Reload laps</button>
          </div>
          <div class="live-compare-summary" data-live="compareSummary"><p class="live-empty">Laps appear here as drivers complete them.</p></div>
          <div class="live-charts" data-live="compareCharts" role="img" aria-label="Speed, time delta, throttle, brake and gear over the lap for the two chosen laps"></div>
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
    for (const name of ['driverA', 'driverB']) $(page, name).addEventListener('change', () => { syncLapOptions(); loadCompare(); });
    for (const name of ['lapA', 'lapB']) $(page, name).addEventListener('change', loadCompare);
    $(page, 'backfill').addEventListener('click', () => backfill(true));
    $(page, 'bothFastest').addEventListener('click', () => { for (const name of ['lapA', 'lapB']) setSelect($(page, name), 'fastest'); loadCompare(); });
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
    else document.querySelector('.site-header .header-actions')?.append(button);
  }

  // ---------- entering and leaving the view ----------
  function enter() {
    active = true;
    document.querySelectorAll('[data-analysis-view]').forEach(tab => tab.setAttribute('aria-selected', 'false'));
    document.body.classList.add('live-view');
    page.hidden = false; button.setAttribute('aria-pressed', 'true');
    const title = document.getElementById('windowTitle'), subtitle = document.getElementById('windowSubtitle');
    if (title) title.textContent = 'Live timing';
    if (subtitle) subtitle.textContent = 'This PC · F1 live feed';
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
      authText.textContent = 'Signed in to F1 TV' + (auth.subscription ? ` (${auth.subscription})` : '') + (until && !Number.isNaN(until.getTime()) ? ` · until ${until.toLocaleString([], {weekday: 'short', hour: '2-digit', minute: '2-digit'})}` : '');
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
      state = null; outline = null; telemetry = {}; bounds = null; lapLists = {}; compareTraces = [null, null]; compareKey = '';
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
    if (source?.error) showError({message: source.error});
    const progress = $(page, 'progress');
    progress.hidden = !(source?.kind === 'replay' && source.duration);
    if (!progress.hidden) progress.firstElementChild.style.width = Math.min(100, 100 * (source.position || 0) / source.duration) + '%';
  }
  function render() {
    if (!active || !state) { syncSource(); syncDot(); return; }
    const s = state.session || {};
    $(page, 'title').textContent = s.meeting ? `${s.meeting} · ${s.name || ''}` : 'Waiting for session data';
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
    if (Date.now() - lapsFetchedAt > 5000) refreshLaps();
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
        const [letter, hue] = TYRES[d.stint.compound] || ['?', '#8e8e93'];
        const badge = el('b', null, letter); badge.style.setProperty('--tyre', hue); badge.title = d.stint.compound.toLowerCase() + (d.stint.new ? ', new' : ', used');
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
    if (!chosen.length) { box.replaceChildren(el('p', 'live-empty', 'Select a driver in the timing tower.')); return; }
    box.replaceChildren(...chosen.map((number, index) => {
      const d = driverFor(number), last = (telemetry[number] || []).at(-1) || {};
      const card = el('div', 'live-readout'); card.style.setProperty('--team', colour(d)); if (index) card.classList.add('is-second');
      card.append(el('strong', null, d.code),
        el('span', null, last.speed != null ? `${last.speed} km/h` : '—'),
        el('span', null, last.gear != null ? `Gear ${last.gear}` : ''),
        el('span', null, last.throttle != null ? `Throttle ${last.throttle}%` : ''),
        el('span', last.brake ? 'is-braking' : null, last.brake ? 'Brake' : ''));
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

  // ---------- completed lap comparison ----------
  function setSelect(select, value) { select.value = value; window.syncSelectUI?.(select); }
  async function refreshLaps() {
    lapsFetchedAt = Date.now();
    try { lapLists = await api('laps'); } catch { return; }
    syncDriverOptions(); syncLapOptions(); loadCompare();
  }
  function syncDriverOptions() {
    const drivers = (state?.drivers || []).filter(d => (lapLists[d.number] || []).length);
    const signature = drivers.map(d => d.number).join(',');
    ['driverA', 'driverB'].forEach((name, slot) => {
      const select = $(page, name), current = select.value;
      if (select.dataset.signature !== signature) {
        select.dataset.signature = signature;
        select.replaceChildren(...drivers.map(d => new Option(`${d.code} · ${d.team || d.number}`, d.number)));
        if (!drivers.length) select.append(new Option('No completed laps yet', ''));
      }
      const fallback = drivers[slot]?.number || drivers[0]?.number || '';
      setSelect(select, current && drivers.some(d => d.number === current) ? current : fallback);
    });
  }
  function syncLapOptions() {
    [['driverA', 'lapA'], ['driverB', 'lapB']].forEach(([driverName, lapName]) => {
      const laps = lapLists[$(page, driverName).value] || [], select = $(page, lapName), current = select.value || 'fastest';
      const fastest = laps.find(l => l.fastest), best = driverFor($(page, driverName).value).best;
      // The driver's best lap may predate the connection; it loads once Formula 1 publishes the session.
      const missed = best && fastest?.time && fastest.time !== best && lapSecondsOf(best) < (fastest.seconds || Infinity);
      const label = !fastest ? 'Fastest' : missed ? `Fastest captured · L${fastest.lap} ${fastest.time} · best ${best} loads after the session` : `Fastest · L${fastest.lap} ${fastest.time || ''}`;
      const options = [new Option(label, 'fastest'), new Option('Last completed', 'last'),
        ...laps.slice().reverse().map(l => new Option(`Lap ${l.lap}${l.time ? ' · ' + l.time : ''}${l.pit ? ' · pit' : ''}`, String(l.lap)))];
      select.replaceChildren(...options);
      setSelect(select, options.some(o => o.value === current) ? current : 'fastest');
    });
  }
  async function loadCompare() {
    const picks = [['driverA', 'lapA'], ['driverB', 'lapB']].map(([d, l]) => [$(page, d).value, $(page, l).value]);
    // Fetch again only when the choice changed, or the lap that "fastest" / "last" points at moved on.
    const key = picks.map(([d, l]) => `${d}:${l}:${l === 'fastest' ? lapLists[d]?.find(x => x.fastest)?.lap : l === 'last' ? lapLists[d]?.at(-1)?.lap : ''}`).join('|');
    if (key === compareKey) return;
    compareKey = key;
    compareTraces = await Promise.all(picks.map(([driver, lap]) => driver ? api(`lap?driver=${encodeURIComponent(driver)}&lap=${encodeURIComponent(lap)}`).catch(() => null) : null));
    renderCompareSummary(); queueDraw();
  }
  function compareColours() {
    const [a, b] = compareTraces.map(t => t && colour(driverFor(t.driver)));
    // Two laps from one team (or one driver) still need two colours.
    return [a || '#8e8e93', b && b !== a ? b : css('--ui-label') || '#fff'];
  }
  function renderCompareSummary() {
    const box = $(page, 'compareSummary'), [a, b] = compareTraces, colours = compareColours();
    page.querySelectorAll('.live-compare-key').forEach((key, i) => key.style.setProperty('--team', colours[i]));
    if (!a && !b) { box.replaceChildren(el('p', 'live-empty', 'Laps appear here as drivers complete them.')); return; }
    const parts = [a, b].map((t, i) => {
      if (!t) return el('span', 'live-compare-lap', '—');
      const item = el('span', 'live-compare-lap'); item.style.setProperty('--team', colours[i]); if (i) item.classList.add('is-second');
      item.append(el('strong', null, driverFor(t.driver).code), el('span', null, `Lap ${t.lap}`), el('b', null, t.time || '—'));
      if (t.pit) item.append(el('small', null, 'pit lap'));
      return item;
    });
    if (a?.seconds && b?.seconds) {
      const gap = b.seconds - a.seconds;
      parts.push(el('span', 'live-compare-gap', `${gap > 0 ? '+' : gap < 0 ? '−' : '±'}${Math.abs(gap).toFixed(3)} s`));
    }
    box.replaceChildren(...parts);
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
    const container = $(page, 'compareCharts'), [a, b] = compareTraces, colours = compareColours();
    const traces = [a, b].map((t, i) => t && {trace: t, colour: colours[i]}).filter(Boolean);
    if (!traces.length) { container.replaceChildren(el('p', 'live-empty', 'Choose two completed laps.')); container.dataset.layout = ''; return; }
    const length = Math.max(...traces.map(({trace}) => trace.x.at(-1) || 0));
    const view = {min: 0, max: length, marks: []};
    for (let m = 1000; m < length; m += 1000) view.marks.push({value: m, label: `${m / 1000} km`});
    const ids = a && b ? ['speed', 'delta', 'throttle', 'brake', 'gear'] : ['speed', 'throttle', 'brake', 'gear'];
    const list = panels(container, ids.map(id => ({...SPECS[id], axis: id === 'gear'})));
    bindHover(container, f => f * length, v => { compareHover = v; });
    for (const [spec, canvas] of list) {
      let series;
      if (spec.id === 'delta') {
        // Each lap's clock starts at the timing line and is scaled to its official lap time, so the line ends on the
        // official gap; a short moving average removes the position feed's sampling jitter.
        const span = Math.min(a.x.at(-1), b.x.at(-1));
        const clock = trace => {
          const t0 = timeAt(trace, 0), tEnd = timeAt(trace, span), scale = trace.seconds && tEnd > t0 ? trace.seconds / (tEnd - t0) : 1;
          return x => (timeAt(trace, x) - t0) * scale;
        };
        const ta = clock(a), tb = clock(b), raw = [];
        for (let k = 0; k <= 400; k++) { const x = span * k / 400; raw.push([x, tb(x) - ta(x)]); }
        const deltas = raw.map(([x], k) => {
          const lo = Math.max(0, k - 4), hi = Math.min(raw.length - 1, k + 4), reach = Math.min(k - lo, hi - k);
          let sum = 0; for (let j = k - reach; j <= k + reach; j++) sum += raw[j][1];
          return [x, sum / (2 * reach + 1)];
        });
        const range = Math.max(.1, ...deltas.map(([, d]) => Math.abs(d)));
        const step = [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5].find(s => range / s <= 2.5) || 5;
        const top = Math.ceil(range / step) * step;
        Object.assign(spec, {min: -top, max: top, ticks: [-top, 0, top].map(v => ({value: v, label: v ? `${v > 0 ? '+' : ''}${v.toFixed(step < .1 ? 2 : 1)}` : '0', strong: !v}))});
        series = [{colour: colours[1], points: deltas}];
      } else {
        series = traces.map(({trace, colour}) => ({colour, points: spec.id === 'brake' || spec.id === 'gear' ? trace.x.map((x, i) => [x, trace[spec.id][i]]) : changes(trace.x, trace[spec.id])}));
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
    const view = {min: 0, max: length, marks: []};
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
    ctx.font = '600 10px var(--ui-font, system-ui)'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    for (const [number, p] of cars) {
      const d = order.get(number) || {code: number}, x = px(p.x), y = py(p.y), picked = chosen.includes(number);
      if (p.status && p.status !== 'OnTrack') ctx.globalAlpha = .35;
      ctx.beginPath(); ctx.arc(x, y, picked ? 6.5 : 5, 0, Math.PI * 2);
      ctx.fillStyle = colour(d); ctx.fill();
      ctx.lineWidth = picked ? 2 : 1.2; ctx.strokeStyle = picked ? (css('--ui-label') || '#fff') : '#000000aa'; ctx.stroke();
      if (picked || (d.position && d.position <= 3)) { ctx.fillStyle = css('--ui-label') || '#fff'; ctx.fillText(d.code || number, x + 8, y); }
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
