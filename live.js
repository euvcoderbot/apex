/* Live timing view: local compute only. The page talks to this PC's live service (/api/live/*),
   which reads F1's live feed with the user's own F1 TV sign-in, or replays a cached session through the same pipeline.
   Nothing here runs on the published site. All data-derived text is set with textContent. */
(() => {
  if (!window.APEX_LOCAL_MODE) return;
  // Its stylesheet ships separately (the published page never loads it), with this script's version.
  {
    const link = document.createElement('link'); link.rel = 'stylesheet';
    link.href = 'live.css' + (document.currentScript?.src.match(/\?v=[^&#]+/)?.[0] || '');
    document.head.append(link);
  }
  const root = document.documentElement;
  const $ = (scope, name) => scope.querySelector(`[data-live="${name}"]`);
  const SPEEDS = [1, 2, 5, 10, 30, 60];
  const TYRES = {SOFT: ['S', '#ff3b30'], MEDIUM: ['M', '#ffd60a'], HARD: ['H', '#f2f2f7'], INTERMEDIATE: ['I', '#34c759'], WET: ['W', '#0a84ff']};
  const FLAGS = {'2': 'yellow', '4': 'sc', '5': 'red', '6': 'vsc', '7': 'vsc'};
  let page, button, stream, statusTimer, active = false;
  let state = null, source = null, outline = null, telemetry = {}, bounds = null;
  const chosen = [];   // up to two driver numbers for the telemetry trace
  let lapLists = {}, compareTraces = [null, null], lapsFetchedAt = 0, compareKey = '';
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
            <button type="button" class="live-button" data-live="signin">Sign in to F1 TV</button>
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
        <p class="live-help" data-live="help" hidden></p>
        <div class="live-progress" data-live="progress" hidden><span></span></div>
      </section>
      <div class="live-grid">
        <section class="dashboard-card live-tower" aria-label="Timing tower">
          <div class="live-card-head"><h2>Timing</h2><small>Select up to two drivers for telemetry</small></div>
          <div class="live-table-wrap"><table class="live-table">
            <thead><tr><th scope="col">P</th><th scope="col">Driver</th><th scope="col">Gap</th><th scope="col">Int</th><th scope="col">Last</th><th scope="col">S1</th><th scope="col">S2</th><th scope="col">S3</th><th scope="col">Best</th><th scope="col">Tyre</th><th scope="col">Pit</th></tr></thead>
            <tbody data-live="tower"><tr><td colspan="11" class="live-empty">Waiting for timing data.</td></tr></tbody>
          </table></div>
        </section>
        <section class="dashboard-card live-map-card" aria-label="Track map">
          <div class="live-card-head"><h2>Track</h2><small data-live="mapnote">Learning the circuit from car positions</small></div>
          <canvas data-live="map" role="img" aria-label="Car positions on track"></canvas>
        </section>
        <section class="dashboard-card live-telemetry-card" aria-label="Live telemetry">
          <div class="live-card-head"><h2>Telemetry</h2><small data-live="telenote">Last 20 seconds</small></div>
          <div class="live-readouts" data-live="readouts"></div>
          <canvas data-live="trace" role="img" aria-label="Speed, throttle and brake trace"></canvas>
        </section>
        <section class="dashboard-card live-side" aria-label="Race control and weather">
          <div class="live-card-head"><h2>Conditions</h2></div>
          <dl class="live-weather" data-live="weather"></dl>
          <div class="live-card-head"><h2>Race control</h2></div>
          <ol class="live-rc" data-live="rc"><li class="live-empty">No messages yet.</li></ol>
        </section>
      </div>
      <section class="dashboard-card live-compare" aria-label="Compare completed laps">
        <div class="live-card-head"><h2>Compare laps</h2><small>Completed laps from this session · aligned by lap distance (approximate: the feed sends about four telemetry samples a second)</small></div>
        <div class="live-compare-pickers">
          <div class="live-compare-pick"><span class="live-compare-key"></span>
            <label>Driver <select id="liveCompareDriverA" data-live="driverA" aria-label="First driver"></select></label>
            <label>Lap <select id="liveCompareLapA" data-live="lapA" aria-label="First driver's lap"></select></label></div>
          <div class="live-compare-pick"><span class="live-compare-key is-second"></span>
            <label>Driver <select id="liveCompareDriverB" data-live="driverB" aria-label="Second driver"></select></label>
            <label>Lap <select id="liveCompareLapB" data-live="lapB" aria-label="Second driver's lap"></select></label></div>
          <button type="button" class="live-button" data-live="bothFastest">Both fastest laps</button>
        </div>
        <div class="live-compare-summary" data-live="compareSummary"><p class="live-empty">Laps appear here as drivers complete them.</p></div>
        <canvas data-live="compare" role="img" aria-label="Speed, time delta, throttle and brake over the lap for the two chosen laps"></canvas>
      </section>`;
    const anchor = document.getElementById('carPerformance');
    (anchor || document.querySelector('main#top')).after(page);
    const speed = $(page, 'speed');
    for (const value of SPEEDS) speed.append(new Option(value + '×', value, value === 10, value === 10));
    $(page, 'connect').addEventListener('click', () => start({mode: 'live'}));
    $(page, 'signin').addEventListener('click', signIn);
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
      if (payload.outline) { outline = payload.outline; bounds = null; }
      render();
    };
  }
  function disconnect() { stream?.close(); stream = null; }
  async function refreshOutline() {
    try { outline = await api('outline'); bounds = null; queueDraw(); } catch { /* next update retries */ }
  }
  async function refreshStatus() {
    try { applyStatus(await api('status')); } catch (error) { showError(error); }
  }
  // ---------- F1 TV sign-in ----------
  let signinWaiting = false, signinTimer = null;
  function signedIn(yes) {
    $(page, 'signin').hidden = yes; $(page, 'signout').hidden = !yes;
    $(page, 'signin').textContent = signinWaiting && !yes ? 'Waiting for sign-in…' : 'Sign in to F1 TV';
    if (yes && signinWaiting) { signinWaiting = false; clearInterval(signinTimer); }
  }
  async function signIn() {
    try {
      await post('signin');
      signinWaiting = true; refreshStatus();
      clearInterval(signinTimer);
      const started = Date.now();
      // Watch for the stored sign-in for ten minutes; the person may take a while in the window.
      signinTimer = setInterval(() => {
        if (Date.now() - started > 600000) { signinWaiting = false; clearInterval(signinTimer); }
        refreshStatus();
      }, 3000);
    } catch (error) { showError(error); }
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
      help.textContent = signinWaiting
        ? 'A sign-in window is open on this PC. Enter your F1 TV email and password there; this page updates by itself once you are signed in.'
        : 'Live timing needs your F1 TV account. Press Sign in: a window opens on this PC where you enter your F1 TV details (they go straight to Formula 1, not to this page). The sign-in lasts a few days. Replays need no sign-in.';
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
    telemetry = {}; renderTower(); renderReadouts(); queueDraw();
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
    $(page, 'mapnote').textContent = outline?.complete ? (s.circuit || 'Circuit') : 'Learning the circuit from car positions';
    syncSource(); syncDot();
    renderTower(); renderWeather(); renderRaceControl(); renderReadouts(); queueDraw();
    if (Date.now() - lapsFetchedAt > 5000) refreshLaps();
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
        tyre.append(badge, el('span', null, d.stint.laps ?? ''));
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
      const fastest = laps.find(l => l.fastest);
      const options = [new Option(fastest ? `Fastest · L${fastest.lap} ${fastest.time || ''}` : 'Fastest', 'fastest'), new Option('Last completed', 'last'),
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
    if (x <= xs[0]) return trace.t[0];
    if (x >= xs[hi]) return trace.t[hi];
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (xs[mid] < x) lo = mid; else hi = mid; }
    const f = (x - xs[lo]) / ((xs[hi] - xs[lo]) || 1);
    return trace.t[lo] + f * (trace.t[hi] - trace.t[lo]);
  }
  function drawCompare() {
    const canvas = $(page, 'compare'), frame = sized(canvas); if (!frame) return;
    const {ctx, w, h} = frame, traces = compareTraces.filter(Boolean), colours = compareColours();
    const muted = css('--ui-tertiary') || '#888', grid = css('--ui-border') || '#ffffff14';
    ctx.font = '10px var(--ui-font, system-ui)'; ctx.fillStyle = muted; ctx.textBaseline = 'middle';
    if (!traces.length) { ctx.textAlign = 'center'; ctx.fillText('Choose two completed laps', w / 2, h / 2); return; }
    const left = 40, right = 10, top = 8, length = Math.max(...traces.map(t => t.x.at(-1)));
    const speedH = h * .5, deltaTop = top + speedH + 12, deltaH = h * .2, pedalTop = deltaTop + deltaH + 10, pedalH = Math.max(10, (h - pedalTop - 18) / 2);
    const X = x => left + x / length * (w - left - right);
    ctx.strokeStyle = grid; ctx.lineWidth = 1; ctx.textAlign = 'right';
    for (const v of [100, 200, 300]) { const y = top + speedH - v / 350 * speedH; ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(w - right, y); ctx.stroke(); ctx.fillText(v, left - 6, y); }
    ctx.fillText('Δ s', left - 6, deltaTop + deltaH / 2);
    ctx.fillText('Thr', left - 6, pedalTop + pedalH / 2); ctx.fillText('Brk', left - 6, pedalTop + pedalH + 3 + pedalH / 2);
    ctx.textAlign = 'center';
    for (let m = 1000; m < length; m += 1000) { const x = X(m); ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, h - 14); ctx.stroke(); ctx.fillText(m / 1000 + ' km', x, h - 6); }
    compareTraces.forEach((t, i) => {
      if (!t) return;
      ctx.strokeStyle = colours[i]; ctx.setLineDash(i ? [6, 3] : []); ctx.lineWidth = 1.7;
      ctx.beginPath(); t.x.forEach((x, j) => { const y = top + speedH - Math.min(350, t.speed[j] || 0) / 350 * speedH; j ? ctx.lineTo(X(x), y) : ctx.moveTo(X(x), y); }); ctx.stroke();
      ctx.lineWidth = 1.3;
      ctx.beginPath(); t.x.forEach((x, j) => { const y = pedalTop + pedalH - (t.throttle[j] ?? 0) / 100 * pedalH; j ? ctx.lineTo(X(x), y) : ctx.moveTo(X(x), y); }); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = colours[i]; ctx.globalAlpha = i ? .5 : .85;
      const by = pedalTop + pedalH + 3 + (i ? pedalH / 2 : 0);
      for (let j = 1; j < t.x.length; j++) if (t.brake[j - 1]) ctx.fillRect(X(t.x[j - 1]), by, Math.max(1, X(t.x[j]) - X(t.x[j - 1])), pedalH / 2 - 1);
      ctx.globalAlpha = 1;
    });
    const [a, b] = compareTraces;
    if (a && b) {
      // Above the line: the second lap is behind the first at that point of the lap.
      const steps = 240, deltas = [];
      for (let k = 0; k <= steps; k++) { const x = length * k / steps; deltas.push([x, timeAt(b, x) - timeAt(a, x)]); }
      const range = Math.max(.2, ...deltas.map(([, d]) => Math.abs(d))), mid = deltaTop + deltaH / 2;
      ctx.strokeStyle = grid; ctx.beginPath(); ctx.moveTo(left, mid); ctx.lineTo(w - right, mid); ctx.stroke();
      ctx.strokeStyle = colours[1]; ctx.lineWidth = 1.6; ctx.beginPath();
      deltas.forEach(([x, d], k) => { const y = mid - d / range * deltaH / 2; k ? ctx.lineTo(X(x), y) : ctx.moveTo(X(x), y); }); ctx.stroke();
      ctx.fillStyle = muted; ctx.textAlign = 'left'; ctx.fillText(`±${range.toFixed(2)} s`, left + 4, deltaTop + 4);
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
    if (points.length > 2) {
      ctx.beginPath(); points.forEach(([x, y], i) => (i ? ctx.lineTo(px(x), py(y)) : ctx.moveTo(px(x), py(y))));
      if (outline.complete) ctx.closePath();
      ctx.lineJoin = ctx.lineCap = 'round';
      ctx.strokeStyle = css('--ui-border-strong') || '#ffffff30'; ctx.lineWidth = 9; ctx.stroke();
      ctx.strokeStyle = css('--ui-well') || '#00000040'; ctx.lineWidth = 5; ctx.stroke();
    }
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
  function drawTrace() {
    const canvas = $(page, 'trace'), frame = sized(canvas); if (!frame) return;
    const {ctx, w, h} = frame, series = chosen.map(n => [n, telemetry[n] || []]).filter(([, s]) => s.length > 1);
    const muted = css('--ui-tertiary') || '#888', grid = css('--ui-border') || '#ffffff14';
    const left = 34, right = 8, top = 8, speedH = Math.max(40, h * .62), pedalTop = top + speedH + 10, pedalH = Math.max(14, (h - pedalTop - 16) / 2);
    ctx.font = '10px var(--ui-font, system-ui)'; ctx.fillStyle = muted; ctx.textBaseline = 'middle'; ctx.textAlign = 'right';
    ctx.strokeStyle = grid; ctx.lineWidth = 1;
    for (const v of [100, 200, 300]) { const y = top + speedH - v / 350 * speedH; ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(w - right, y); ctx.stroke(); ctx.fillText(v, left - 6, y); }
    ctx.fillText('Thr', left - 6, pedalTop + pedalH / 2); ctx.fillText('Brk', left - 6, pedalTop + pedalH + 4 + pedalH / 2);
    if (!series.length) { ctx.textAlign = 'center'; ctx.fillText(chosen.length ? 'Waiting for telemetry' : 'Select a driver to trace', (w + left) / 2, top + speedH / 2); return; }
    const end = Math.max(...series.map(([, s]) => s.at(-1).t)), span = 20, x = t => left + (1 - (end - t) / span) * (w - left - right);
    series.forEach(([number, samples], index) => {
      const c = colour(driverFor(number)), visible = samples.filter(s => end - s.t <= span);
      ctx.setLineDash(index ? [5, 3] : []);
      ctx.strokeStyle = c; ctx.lineWidth = 1.8; ctx.beginPath();
      visible.forEach((s, i) => { const y = top + speedH - Math.min(350, s.speed || 0) / 350 * speedH; i ? ctx.lineTo(x(s.t), y) : ctx.moveTo(x(s.t), y); }); ctx.stroke();
      ctx.lineWidth = 1.4; ctx.beginPath();
      visible.forEach((s, i) => { const y = pedalTop + pedalH - (s.throttle ?? 0) / 100 * pedalH; i ? ctx.lineTo(x(s.t), y) : ctx.moveTo(x(s.t), y); }); ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = index ? .45 : .8; ctx.fillStyle = c;
      const by = pedalTop + pedalH + 4 + (index ? pedalH / 2 : 0);
      for (let i = 1; i < visible.length; i++) if (visible[i - 1].brake) ctx.fillRect(x(visible[i - 1].t), by, Math.max(1, x(visible[i].t) - x(visible[i - 1].t)), pedalH / 2 - 1);
      ctx.globalAlpha = 1;
    });
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
