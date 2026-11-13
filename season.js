/* Season hub: schedule, results, standings, driver stats, head-to-heads, car upgrades and power-unit usage.
   Data: /api/season (Jolpica classifications plus our calculations), /api/season/upgrades and /api/season/power-units
   (parsed FIA documents), fetched through the same cached data path as the other views. Loaded after the page
   (lazy module), so it never delays the session view. Text from data is always set as text or escaped. */
(() => {
  const TABS = [['schedule', 'Schedule'], ['results', 'Results'], ['standings', 'Standings'], ['form', 'Form'], ['drivers', 'Driver stats'],
    ['h2h', 'Head-to-head'], ['upgrades', 'Upgrades'], ['units', 'Power units']];
  // Teams' formula1.com colours (team-colours.js maps the feed's shades to these and handles light mode).
  const TEAM_HEX = {mercedes: '#27f4d2', ferrari: '#e8002d', red_bull: '#3671c6', mclaren: '#ff8000', rb: '#6692ff', alpine: '#00a1e8',
    aston_martin: '#229971', williams: '#1868db', haas: '#dee1e2', audi: '#ff2d00', sauber: '#52e252', cadillac: '#aaaaad'};
  const ELEMENT_NAMES = {ICE: 'Internal combustion engine', TC: 'Turbocharger', EXH: 'Exhaust set', 'MGU-K': 'Motor generator unit, kinetic',
    ES: 'Energy store', 'PU-CE': 'Control electronics', 'PU-ANC': 'Ancillary components',
    'MGU-H': 'Motor generator unit, heat', CE: 'Control electronics', EX: 'Exhaust system'};
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]);
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const teamColour = id => window.apexTeamColour?.(TEAM_HEX[id] || '#8e8e93') || TEAM_HEX[id] || '#8e8e93';
  const now = () => new Date();

  // ---------- imagery: driver photos and avatars, team marks and circuit outlines ----------
  // Driver photos are Wikimedia Commons files under free licences (CC BY, CC BY-SA, CC0, OGL), credited on every page that shows
  // them (assets/drivers/credits.json). Without a photo the avatar is the driver's code on the team colour. Team marks are drawn by
  // team-marks.js; circuit outlines are bacinger/f1-circuits (MIT, assets/circuits/LICENSE.md).
  const imagery = {circuits: null, photos: {}, shown: new Set(), pendingCircuits: new Map()};
  let circuitRequest = null, photoRequest = null;
  function loadPhotos() {
    photoRequest ||= fetch('assets/drivers/credits.json').then(r => (r.ok ? r.json() : {}))
      .then(list => { imagery.photos = list?.photos || {}; }).catch(() => { imagery.photos = {}; });
    return photoRequest;
  }
  const safeUrl = url => (/^https:\/\//.test(url || '') ? url : null);
  function link(text, url) {
    const href = safeUrl(url);
    if (!href) return el('span', null, text);
    const a = el('a', null, text); a.href = href; a.target = '_blank'; a.rel = 'noopener';
    return a;
  }
  // "Photo: <author>, <licence>", linked to the file's Commons page and the licence, as the licences ask.
  function photoCredit(id) {
    const c = imagery.photos[id];
    if (!c) return null;
    const p = el('p', 'season-photo-credit');
    // The licence requires saying the photo was changed: these are cropped cut-outs with the background removed.
    p.append('Photo: ', link(c.author || 'Wikimedia Commons', c.page), ', ', link(c.licence, c.licence_url), c.changes ? `; ${c.changes}` : '');
    return p;
  }
  function photoCredits() {
    const ids = [...imagery.shown].filter(id => imagery.photos[id]).sort();
    if (!ids.length) return null;
    const box = el('details', 'season-credits');
    box.append(el('summary', null, 'Photo credits'));
    const list = el('ul');
    for (const id of ids) { const li = el('li'); li.append(el('b', null, imagery.photos[id].name + ': ')); li.append(...photoCredit(id).childNodes); list.append(li); }
    box.append(list, el('p', 'season-muted', 'Driver photos from Wikimedia Commons, cropped to a headshot.'));
    return box;
  }
  function loadCircuits() {
    circuitRequest ||= fetch('assets/circuits/f1-circuits.geojson').then(r => (r.ok ? r.json() : null))
      .then(geo => { imagery.circuits = geo?.features || []; }).catch(() => { imagery.circuits = []; });
    return circuitRequest;
  }
  function avatar(data, id, size = 'sm') {
    const span = el('span', `season-avatar is-${size}`);
    span.dataset.seasonDriver = id;
    span.setAttribute('aria-hidden', 'true');
    span.style.setProperty('--team', teamColour(data.drivers[id]?.team));
    // Without a photo: the car number on the team colour (the code when a season's data has no number).
    const number = String(data.drivers[id]?.number || '').match(/^\d{1,3}$/)?.[0];
    span.append(el('b', number ? 'is-number' : null, number || (data.drivers[id]?.code || '').slice(0, 3)));
    addAvatarPhoto(span, id);
    return span;
  }
  function addAvatarPhoto(span, id) {
    if (imagery.photos[id] && !span.querySelector('img')) {
      // The number stays underneath: if the photo fails to load, removing it shows the number.
      const img = el('img'); img.src = `assets/drivers/${encodeURIComponent(id)}.webp`; img.alt = ''; img.decoding = 'async'; img.loading = 'lazy';
      img.addEventListener('error', () => img.remove(), {once: true});
      span.append(img); imagery.shown.add(id);
    }
  }
  function hydrateImagery() {
    if (!body || !active) return;
    for (const span of body.querySelectorAll('.season-avatar[data-season-driver]')) addAvatarPhoto(span, span.dataset.seasonDriver);
    if (imagery.circuits !== null) for (const [slot, round] of imagery.pendingCircuits) {
      if (slot.isConnected) {
        const outline = circuitOutline(round, slot.className);
        if (outline) slot.replaceWith(outline); else slot.remove();
      }
      imagery.pendingCircuits.delete(slot);
    }
    const credits = photoCredits(), previous = body.querySelector(':scope > .season-credits');
    if (credits) { if (previous) previous.replaceWith(credits); else body.append(credits); }
  }
  function teamMark(data, id) {
    // The same marks as the session view (colour, white and black, swapped by appearance).
    const markup = typeof window.teamLogoMarkup === 'function' ? window.teamLogoMarkup(teamName(data, id)) : '';
    const node = markup ? htmlNode(markup) : null;
    if (node && !node.querySelector('.team-logo-fallback')) { node.classList.add('season-team-mark'); return node; }
    const dot = el('i'); dot.style.setProperty('--team', teamColour(id));
    return dot;
  }

  // The circuit whose centre is nearest the round's coordinates (within 30 km).
  function circuitFeature(round) {
    if (!imagery.circuits?.length || !Number.isFinite(round.lat) || (!round.lat && !round.lon)) return null;
    let best = null, bestKm = 30;
    for (const feature of imagery.circuits) {
      const pts = feature.geometry?.coordinates || [];
      if (pts.length < 3) continue;
      const lon = pts.reduce((a, p) => a + p[0], 0) / pts.length, lat = pts.reduce((a, p) => a + p[1], 0) / pts.length;
      const km = Math.hypot((lat - round.lat) * 111, (lon - round.lon) * 111 * Math.cos(lat * Math.PI / 180));
      if (km < bestKm) { best = feature; bestKm = km; }
    }
    return best;
  }
  // Its outline, drawn in a 100 x 100 box.
  function circuitOutline(round, cls = 'season-track') {
    const best = circuitFeature(round)?.geometry.coordinates;
    if (!best) {
      if (imagery.circuits !== null) return null;
      const slot = el('span', cls); slot.setAttribute('aria-hidden', 'true');
      imagery.pendingCircuits.set(slot, round);
      return slot;
    }
    const k = Math.cos(best[0][1] * Math.PI / 180);
    const xs = best.map(p => p[0] * k), ys = best.map(p => -p[1]);
    const minX = Math.min(...xs), minY = Math.min(...ys), span = Math.max(Math.max(...xs) - minX, Math.max(...ys) - minY) || 1;
    const offX = (span - (Math.max(...xs) - minX)) / 2, offY = (span - (Math.max(...ys) - minY)) / 2;
    const d = xs.map((x, i) => `${i ? 'L' : 'M'}${(4 + (x - minX + offX) / span * 92).toFixed(1)} ${(4 + (ys[i] - minY + offY) / span * 92).toFixed(1)}`).join('') + 'Z';
    return htmlNode(`<svg class="${cls}" viewBox="0 0 100 100" aria-hidden="true" focusable="false"><path d="${d}"/></svg>`);
  }

  let page, body, tabsNav, yearSelect, button, railSection, active = false;
  const state = {year: new Date().getFullYear(), tab: 'schedule', driver: null, a: null, b: null, team: null, standings: 'drivers', matrix: 'position', updatesView: 'grid', type: null, expanded: null};
  const cache = {};   // `${kind}:${year}` -> Promise of data

  // ---------- data ----------
  // Saved snapshots (scripts/snapshot-season.mjs, assets/data/season) come first wherever the live API cannot do
  // better: always on the hosted site, which has no backend for new data, and for finished seasons everywhere. The
  // local app keeps the current season live and falls back to the snapshot only if the API fails.
  let snapshotIndex = null;
  async function savedSeason(path) {
    if (typeof DecompressionStream === 'undefined') return null;
    // On a season page index.html has already started the index and this year's file (ApexSeasonEarly): use them once.
    const early = window.ApexSeasonEarly;
    snapshotIndex ||= early?.index || fetch('assets/data/season/index.json', {cache: 'no-cache'}).then(r => (r.ok ? r.json() : null)).catch(() => null);
    const entry = (await snapshotIndex)?.entries?.[path];
    if (!entry || !/^[a-f0-9]{24}\.json\.gz$/.test(entry.file || '')) return null;
    try {
      let buffer = null;
      if (early && early.path === path) { early.path = null; buffer = await early.bytes; }
      if (!buffer) {
        const response = await fetch(`assets/data/season/${entry.file}`);
        if (!response.ok) return null;
        buffer = await response.arrayBuffer();
      }
      const bytes = new Uint8Array(buffer);
      // Some hosts send .json.gz already decoded (Content-Encoding: gzip); others deliver the gzip bytes.
      const data = bytes[0] === 0x1f && bytes[1] === 0x8b
        ? await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).json()
        : JSON.parse(new TextDecoder().decode(bytes));
      return data && typeof data === 'object' ? Object.assign(data, {saved_at: entry.saved_at}) : null;
    } catch { return null; }
  }
  function liveSeason(kind, path) {
    const url = (typeof apiUrl === 'function' ? apiUrl(path) : path);
    const request = typeof fetchSessionData === 'function' ? fetchSessionData(url) : fetch(url);
    return request.then(async response => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || `Could not load ${kind} (${response.status}).`);
      return data;
    });
  }
  function load(kind, year) {
    const key = `${kind}:${year}`;
    if (!cache[key]) {
      const path = `${{season: '/api/season', upgrades: '/api/season/upgrades', units: '/api/season/power-units'}[kind]}?year=${year}`;
      // The current season is read live wherever something can compute it: the local app, or the published site once
      // this PC's compute is connected ("Use this PC"). Otherwise, and for finished seasons, the saved snapshot comes first.
      cache[key] = Promise.resolve(window.apexComputeReady).then(() => {
        const live = window.APEX_LOCAL_MODE || Boolean(window.APEX_COMPUTE_ORIGIN);
        const savedFirst = !live || year < new Date().getFullYear();
        return (savedFirst ? savedSeason(path) : Promise.resolve(null))
          .then(saved => saved || liveSeason(kind, path).catch(async error => (savedFirst ? null : await savedSeason(path)) || Promise.reject(error)));
      });
      cache[key].catch(() => { delete cache[key]; });
    }
    return cache[key];
  }
  // How old saved data is, for the note under the page header ('' when the data is live).
  const savedNote = data => {
    if (!data?.saved_at) return '';
    const at = new Date(data.saved_at);
    return Number.isFinite(at.getTime()) ? `Data saved ${at.toLocaleString([], {day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'})}` : '';
  };

  // ---------- small shared pieces ----------
  const driverName = (data, id) => data.drivers[id]?.name || id;
  const driverCode = (data, id) => data.drivers[id]?.code || id;
  const teamName = (data, id) => data.teams[id]?.name || id;
  function flag(round) {
    const code = window.grandPrixCountryCode?.({name: round.name, country: round.country});
    if (!/^[A-Z]{2}$/.test(code || '')) return null;
    const img = el('img', 'season-flag'); img.src = `assets/flags/${code.toLowerCase()}.svg`; img.alt = ''; img.width = 20; img.height = 15; img.loading = 'lazy';
    return img;
  }
  // A round's label everywhere rounds are listed: its flag above its three-letter code (code alone when there is no flag).
  function roundMark(round) {
    const mark = el('span', 'season-round-mark'); mark.title = round.name || '';
    const f = flag(round); if (f) mark.append(f);
    mark.append(el('small', null, code(round.round)));
    return mark;
  }
  // Rounds still to run (no race result yet) stay in every round-by-round grid as empty boxes, so each shows the whole calendar.
  const notRun = r => !r.race.length;
  // Sprint pole: the driver who started the sprint from P1 (the sprint's own grid, set by sprint qualifying).
  const sprintPole = r => r.sprint?.find(x => x.grid === 1)?.driver;
  const notRunNote = r => `${r.name}: ${r.status === 'awaiting' ? 'awaiting results' : 'not run yet'}`;
  function upcomingCell(r, tag = 'td', cls = 'num') { const c = el(tag, `${cls} is-upcoming`); c.title = notRunNote(r); return c; }
  function who(data, id, {code = false, team = true, family = false} = {}) {
    const span = el('span', 'season-who');
    const t = data.drivers[id]?.team;
    span.append(avatar(data, id));
    span.append(el('strong', null, code ? driverCode(data, id) : family ? (data.drivers[id]?.family || driverName(data, id)) : driverName(data, id)));
    if (team && t) span.append(el('small', null, teamName(data, t)));
    return span;
  }
  function teamTag(data, id) {
    const span = el('span', 'season-who');
    span.classList.add('is-team'); span.append(teamMark(data, id), el('strong', null, teamName(data, id)));
    return span;
  }
  const dateRange = round => {
    const first = new Date(round.sessions[0]?.start || round.start), last = new Date(round.start);
    const day = d => d.toLocaleDateString([], {day: 'numeric'}), month = d => d.toLocaleDateString([], {month: 'short'});
    return month(first) === month(last) ? `${day(first)}–${day(last)} ${month(last)}` : `${day(first)} ${month(first)} – ${day(last)} ${month(last)}`;
  };
  const card = (title, ...children) => {
    const c = el('section', 'season-card');
    if (title) c.append(el('h3', null, title));
    c.append(...children.filter(Boolean));
    // Tables are page sections; chart widgets retain the elevated card surface.
    if (children.some(node => node?.matches?.('.season-table-wrap'))) c.classList.add('season-data-section');
    return c;
  };
  const empty = text => el('p', 'season-empty', text);

  // ---------- page ----------
  function build() {
    page = document.createElement('section');
    queueMicrotask(() => bindTips(page));
    page.id = 'seasonHub'; page.className = 'season-page'; page.hidden = true; page.tabIndex = -1; page.setAttribute('aria-label', 'Season');
    const head = el('header', 'season-head');
    const title = el('div', 'season-title');
    title.append(el('h1', null, 'Season'));
    yearSelect = el('select'); yearSelect.id = 'seasonYear'; yearSelect.setAttribute('aria-label', 'Season');
    for (let y = new Date().getFullYear(); y >= 2018; y--) yearSelect.append(new Option(String(y), String(y)));
    const shell = el('div', 'select-shell season-year'); shell.append(yearSelect);
    title.append(shell, el('span', 'season-saved'));
    tabsNav = el('nav', 'season-tabs'); tabsNav.setAttribute('aria-label', 'Season pages');
    for (const [id, label] of TABS) {
      const b = el('button', null, label); b.type = 'button'; b.dataset.seasonTab = id; b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', () => show(id));
      tabsNav.append(b);
    }
    head.append(title, tabsNav);
    body = el('div', 'season-body');
    page.append(head, body);
    yearSelect.addEventListener('change', () => { state.year = Number(yearSelect.value); state.driver = state.a = state.b = null; show(state.tab); });
    (document.getElementById('liveTiming') || document.getElementById('carPerformance') || document.querySelector('main#top')).after(page);
  }

  function buildButton() {
    button = el('button', 'season-view-button'); button.type = 'button'; button.id = 'seasonViewButton';
    button.setAttribute('aria-pressed', 'false'); button.title = 'Season: schedule, results, standings and more';
    // Static authored markup: a small calendar glyph.
    button.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><rect x="2.5" y="3.5" width="11" height="10" rx="2"/><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3"/></svg><span class="season-view-label">Season</span>';
    button.addEventListener('click', () => (active ? null : show(state.tab)));
  }
  // In the header's tab list the button is one more tab (aria-selected); in the Linear rail it is a toggle (aria-pressed).
  function mark(on) {
    if (button.closest('.performance-tabs')) {
      button.setAttribute('role', 'tab'); button.removeAttribute('aria-pressed'); button.setAttribute('aria-selected', String(on));
    } else {
      button.removeAttribute('role'); button.removeAttribute('aria-selected'); button.setAttribute('aria-pressed', String(on));
    }
  }
  // Linear look: a row in the rail's Analysis section, with the season's pages listed underneath while it is open.
  function place() {
    const rail = document.querySelector('#linearWorkspace .linear-navigation');
    if (rail) {
      rail.append(button);
      if (!railSection) {
        railSection = el('div', 'season-rail-pages');
        for (const [id, label] of TABS) {
          const b = el('button', null, label); b.type = 'button'; b.dataset.seasonTab = id;
          b.addEventListener('click', () => show(id));
          railSection.append(b);
        }
      }
      button.after(railSection);
    } else {
      railSection?.remove();
      (document.querySelector('.site-header .performance-tabs') || document.querySelector('.site-header .header-actions'))?.append(button);
    }
    mark(active);
  }

  // ---------- entering and leaving ----------
  function show(tab, params = {}, fromHistory = false) {
    window.ApexLive?.leave?.();
    state.tab = TABS.some(([id]) => id === tab) ? tab : 'schedule';
    if (params.year && Number(params.year) !== state.year) { state.year = Number(params.year); }
    for (const key of ['driver', 'a', 'b', 'team']) if (params[key]) state[key] = params[key];
    yearSelect.value = String(state.year); window.syncSelectUI?.(yearSelect);
    if (!active) {
      active = true;
      document.querySelectorAll('[data-analysis-view]').forEach(t => t.setAttribute('aria-selected', 'false'));
      document.body.classList.add('season-view');
      page.hidden = false; mark(true);
      document.body.dataset.view = 'season';
    }
    for (const b of document.querySelectorAll('[data-season-tab]')) b.setAttribute('aria-pressed', String(b.dataset.seasonTab === state.tab));
    const label = TABS.find(([id]) => id === state.tab)[1];
    page.querySelector('.season-title h1').textContent = label;
    const crumb = document.getElementById('windowTitle'), sub = document.getElementById('windowSubtitle');
    if (crumb) crumb.textContent = label;
    if (sub) sub.textContent = `Season ${state.year}`;
    if (!fromHistory) window.ApexUrl?.write('season', urlParams());
    else document.title = window.ApexUrl?.titleFor('season', urlParams()) || document.title;
    render();
  }
  const urlParams = () => ({year: state.year, tab: state.tab, ...(state.tab === 'drivers' && state.driver ? {driver: state.driver} : {}),
    ...(state.tab === 'h2h' && state.a ? {a: state.a, b: state.b} : {}), ...(state.tab === 'upgrades' && state.team ? {team: state.team} : {})});
  function leave() {
    hideChartTip();
    if (!active) return;
    active = false;
    document.body.classList.remove('season-view');
    page.hidden = true; mark(false);
  }
  document.addEventListener('click', event => { if (event.target.closest?.('[data-analysis-view], #liveViewButton')) leave(); }, true);

  // ---------- rendering ----------
  // A page's views, then the credits for the driver photos those views showed.
  function paint(views) {
    const focused = body.contains(document.activeElement) ? document.activeElement : null;
    const segment = focused?.closest('.season-segment button'), segmentGroup = segment?.closest('.season-segment');
    const segmentIndex = segmentGroup ? [...body.querySelectorAll('.season-segment')].indexOf(segmentGroup) : -1;
    const segmentName = segment && (segment.getAttribute('aria-label') || segment.textContent.trim());
    const field = focused?.closest('.select-shell')?.querySelector('select') || (focused?.matches('select') ? focused : null);
    const fieldName = field?.getAttribute('aria-label');
    hideChartTip();
    imagery.shown.clear();
    const nodes = views(), credits = photoCredits();
    body.replaceChildren(...nodes, ...(credits ? [credits] : []));
    body.setAttribute('aria-busy', 'false');
    markTips(body);
    for (const slot of imagery.pendingCircuits.keys()) if (!slot.isConnected) imagery.pendingCircuits.delete(slot);
    window.ApexUI?.decorate?.(body);
    if (segmentIndex >= 0) [...(body.querySelectorAll('.season-segment')[segmentIndex]?.querySelectorAll('button') || [])]
      .find(node => (node.getAttribute('aria-label') || node.textContent.trim()) === segmentName)?.focus({preventScroll: true});
    if (fieldName) {
      const replacement = [...body.querySelectorAll('select')].find(node => node.getAttribute('aria-label') === fieldName);
      (replacement?.closest('.select-shell')?.querySelector('.select-trigger') || replacement)?.focus({preventScroll: true});
    }
  }
  let renderToken = 0;
  async function render() {
    hideChartTip();
    const token = ++renderToken, tab = state.tab, year = state.year;
    body.setAttribute('aria-busy', 'true');
    const loading = el('p', 'season-loading', tab === 'upgrades' ? 'Reading the FIA car presentation documents… the first time takes up to a minute.' : 'Loading…');
    loading.setAttribute('role', 'status'); body.replaceChildren(loading);
    try {
      // Decorative assets hydrate existing nodes; they must not delay the season's numbers or reset interactions.
      void loadPhotos().then(hydrateImagery);
      if (tab === 'schedule') void loadCircuits().then(hydrateImagery);
      const [data, extra] = await Promise.all([load('season', year),
        tab === 'upgrades' ? load('upgrades', year) : tab === 'units' ? load('units', year) : null]);
      // Form also reads each finished race's pace analysis (the published Car performance results), once per season.
      const form = tab === 'form' ? await loadForm(year, data) : null;
      if (token !== renderToken) return;
      const view = {schedule: renderSchedule, results: renderResults, standings: renderStandings, form: renderForm, drivers: renderDrivers,
        h2h: renderH2H, upgrades: renderUpgrades, units: renderUnits}[tab];
      setCodes(data);
      const note = savedNote(extra?.saved_at ? extra : data), saved = page.querySelector('.season-saved');
      if (saved) { saved.textContent = note; saved.hidden = !note; }
      paint(() => view(data, tab === 'form' ? form : extra));
    } catch (error) {
      if (token !== renderToken) return;
      const message = empty(error.message || String(error)); message.setAttribute('role', 'alert');
      body.setAttribute('aria-busy', 'false'); body.replaceChildren(message);
    }
  }

  // ----- circuit profile and records (Schedule, the next race) -----
  // From every saved season since 2018 (the same snapshots the Season pages read): how the circuit's races have gone,
  // each measure ranked against every circuit raced at least twice in that time, and the circuit's records.
  const FIRST_HISTORY_YEAR = 2018;
  function circuitProfile(data, next) {
    const box = card('Circuit profile', el('p', 'season-muted', 'Reading past seasons…'));
    box.classList.add('season-circuit-profile');
    const years = []; for (let y = FIRST_HISTORY_YEAR; y <= data.year; y++) years.push(y);
    Promise.all(years.map(y => (y === data.year ? Promise.resolve(data) : load('season', y).catch(() => null)))).then(seasons => {
      const races = [];
      for (const season of seasons.filter(Boolean)) for (const r of season.rounds) {
        if (!r.race?.length) continue;
        races.push({year: season.year, circuit: r.circuit_id, round: r, drivers: season.drivers});
      }
      const byCircuit = new Map();
      for (const x of races) { if (!byCircuit.has(x.circuit)) byCircuit.set(x.circuit, []); byCircuit.get(x.circuit).push(x); }
      // Per circuit: share of races won from pole and from the front row, places gained per classified finisher (how much
      // the order changes), and the share of starters not classified.
      const measure = list => {
        let pole = 0, front = 0, gained = 0, finishers = 0, starters = 0, out = 0;
        for (const {round: r} of list) {
          const win = r.race.find(x => x.position === 1);
          if (win?.grid === 1) pole++;
          if (win && win.grid >= 1 && win.grid <= 2) front++;
          for (const x of r.race) {
            if (x.status === 'Did not start') continue;
            starters++;
            if (x.position) { finishers++; if (x.grid > 0) gained += Math.abs(x.grid - x.position); } else out++;
          }
        }
        return {held: list.length, pole: pole / list.length, front: front / list.length, gained: finishers ? gained / finishers : null, out: starters ? out / starters : null};
      };
      const all = [...byCircuit].filter(([, list]) => list.length >= 2).map(([id, list]) => [id, measure(list)]);
      const here = byCircuit.get(next.circuit_id);
      if (!here?.length) { box.replaceChildren(el('h3', null, 'Circuit profile'), el('p', 'season-muted', `No race here since ${FIRST_HISTORY_YEAR}.`)); return; }
      const mine = measure(here);
      const rank = (key, high = true) => {
        const values = all.map(([, m]) => m[key]).filter(Number.isFinite).sort((a, b) => (high ? b - a : a - b));
        return Number.isFinite(mine[key]) && here.length >= 2 ? `${values.findIndex(v => (high ? v <= mine[key] + 1e-9 : v >= mine[key] - 1e-9)) + 1} of ${values.length}` : null;
      };
      const rows = el('div', 'season-profile-rows');
      const row = (label, value, ranked, note) => {
        const line = el('div');
        line.append(el('span', 'season-muted', label), el('b', null, value), el('small', 'season-muted', ranked ? `${ranked}${note ? ' · ' + note : ''}` : note || ''));
        rows.append(line);
      };
      const pct = v => `${Math.round(v * 100)}%`;
      row('Won from pole', pct(mine.pole), rank('pole'), 'highest first');
      row('Won from the front row', pct(mine.front), rank('front'));
      if (mine.gained != null) row('Places changed per finisher', mine.gained.toFixed(1), rank('gained'), 'grid to flag, most first');
      if (mine.out != null) row('Starters not classified', pct(mine.out), rank('out'), 'most first');
      // Records: the most wins, poles, podiums and fastest laps here.
      const tally = pick => {
        const count = new Map();
        for (const x of here) for (const id of pick(x.round)) count.set(id, (count.get(id) || 0) + 1);
        return [...count].sort((a, b) => b[1] - a[1]).slice(0, 3);
      };
      const names = Object.assign({}, ...here.map(x => x.drivers), data.drivers);
      const records = el('div', 'season-records');
      for (const [label, pick] of [['Most wins', r => r.race.filter(x => x.position === 1).map(x => x.driver)],
        ['Most poles', r => r.qualifying.filter(q => q.position === 1).map(q => q.driver)],
        ['Most podiums', r => r.race.filter(x => x.position && x.position <= 3).map(x => x.driver)],
        ['Most fastest laps', r => r.race.filter(x => x.fastest_lap_rank === 1).map(x => x.driver)]]) {
        const top = tally(pick); if (!top.length) continue;
        const list = el('ol', 'season-record'); list.append(el('li', 'season-record-title', label));
        for (const [id, n] of top) {
          const li = el('li');
          li.append(data.drivers[id] ? who(data, id, {code: true, team: false}) : el('strong', null, names[id]?.code || names[id]?.name || id), el('b', null, String(n)));
          list.append(li);
        }
        records.append(list);
      }
      const span = `${Math.min(...here.map(x => x.year))}–${Math.max(...here.map(x => x.year))}`;
      box.replaceChildren(el('h3', null, `Circuit profile · ${here.length} race${here.length === 1 ? '' : 's'} here, ${span}`), rows,
        el('h4', 'season-report-title', `Records here since ${FIRST_HISTORY_YEAR}`), records,
        el('p', 'season-footnote', `From every race classification since ${FIRST_HISTORY_YEAR}. Ranks compare the ${all.length} circuits raced at least twice in that time. Places changed per finisher sums each classified car’s grid-to-flag movement: a rough measure of how much the order changes.`));
    });
    return box;
  }

  // ----- schedule -----
  function renderSchedule(data) {
    const out = [];
    const next = data.rounds.find(r => r.status === 'next');
    if (next) out.push(nextRaceHero(data, next), circuitProfile(data, next));
    const done = data.rounds.filter(r => r.status === 'done').length;
    const progress = el('div', 'season-progress');
    const track = el('div', 'season-progress-track');
    for (const r of data.rounds) { const i = el('i'); i.dataset.status = r.status; i.title = `R${r.round} · ${r.name}`; track.append(i); }
    progress.append(el('span', null, `${done} of ${data.rounds.length} Grands Prix`), track,
      el('span', 'season-muted', `${data.rounds.filter(r => r.sprint_weekend).length} sprint weekends`));
    out.push(progress);
    const grid = el('div', 'season-rounds');
    for (const r of data.rounds) {
      const item = el('article', 'season-round'); item.dataset.status = r.status;
      // Header: round, flag and a quiet Sprint label; status on the right as Linear writes it (a small icon and a word).
      const head = el('div', 'season-round-head');
      head.append(el('span', 'season-round-no', `R${r.round}`));
      const f = flag(r); if (f) head.append(f);
      if (r.sprint_weekend) head.append(el('span', 'season-chip is-quiet', 'Sprint'));
      const status = el('span', 'season-status', {done: 'Done', next: 'Next', upcoming: 'Upcoming', awaiting: 'Awaiting results'}[r.status] || r.status); status.dataset.status = r.status;
      status.prepend(htmlNode(r.status === 'done'
        ? '<svg viewBox="0 0 14 14" width="12" height="12" aria-hidden="true"><circle cx="7" cy="7" r="6" fill="currentColor"/><path d="M4.4 7.2l1.8 1.8 3.4-3.6" fill="none" stroke="var(--ui-panel)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'
        : r.status === 'next' ? '<svg viewBox="0 0 14 14" width="12" height="12" aria-hidden="true"><circle cx="7" cy="7" r="5.75" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M7 3.5a3.5 3.5 0 0 1 0 7z" fill="currentColor"/></svg>'
        : '<svg viewBox="0 0 14 14" width="12" height="12" aria-hidden="true"><circle cx="7" cy="7" r="5.75" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="2.2 2"/></svg>'));
      head.append(status);
      // Title and dates beside the circuit, in one row with a fixed slot for the outline, so it never runs into the results.
      const titleRow = el('div', 'season-round-title');
      const text = el('div'); text.append(el('h3', null, r.name), el('p', 'season-muted', `${r.locality} · ${dateRange(r)}`));
      titleRow.append(text);
      const outline = circuitOutline(r); if (outline) titleRow.append(outline);
      item.append(head, titleRow);
      if (r.status === 'done') {
        // Results as one aligned list: the podium, then pole, fastest lap and the sprint winner, each a 24 px row.
        const rows = el('dl', 'season-round-rows');
        const row = (label, id, cls) => {
          if (!id) { const line = el('div', `${cls || ''} is-empty`.trim()); line.append(el('dt', null, label), el('dd', null, /^Sprint/.test(label) && !r.sprint_weekend ? 'No sprint' : '—')); rows.append(line); return; }
          const line = el('div', cls); line.title = `${label}: ${driverName(data, id)}`;
          const dd = el('dd'); dd.append(avatar(data, id), el('b', null, driverCode(data, id)));
          line.append(el('dt', null, label), dd); rows.append(line);
        };
        for (const x of r.race.filter(x => x.position && x.position <= 3).sort((a, b) => a.position - b.position)) row(`P${x.position}`, x.driver, x.position === 1 ? 'is-winner' : '');
        const w = data.winners.find(x => x.round === r.round);
        const fastest = r.race.find(x => x.fastest_lap_rank === 1);
        row('Pole', w?.pole, 'is-first-extra');
        row('Fastest lap', fastest?.driver);
        // Always seven rows (the sprint rows say "No sprint" when there was none), so every card lines up and its link sits
        // in the same place.
        row('Sprint pole', sprintPole(r));
        row('Sprint', w?.sprint_winner);
        const link = el('a', 'season-round-link');
        link.append(el('span', null, 'Analyse race'), htmlNode('<svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true"><path d="M2.5 6h7M6.5 3l3 3-3 3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>'));
        link.href = window.ApexUrl?.href('session', {year: data.year, round: r.round, session: 'Race'}) || `./?year=${data.year}&round=${r.round}&session=Race`;
        item.append(rows, link);
      } else {
        const race = new Date(r.start);
        item.append(el('p', 'season-round-when', `Race ${race.toLocaleString([], {weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'})}`));
      }
      grid.append(item);
    }
    out.push(grid);
    return out;
  }
  // Weather glyphs by WMO code family: sun, sun and cloud, cloud, fog, drizzle or rain, snow, thunder.
  function weatherIcon(code) {
    const cloud = '<path d="M7 18h10a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 7.1 9.2 4.4 4.4 0 0 0 7 18z"/>';
    const sun = '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>';
    const small = '<circle cx="8.5" cy="8" r="3"/><path d="M8.5 2.5v1.2M3 8h1.2M4.6 4.1l.9.9M12.4 4.1l-.9.9"/>';
    const body = code == null ? cloud : code === 0 ? sun : code <= 2 ? small + '<path d="M9 19h8.5a3.5 3.5 0 0 0 .5-6.96A4.8 4.8 0 0 0 9.1 12 3.6 3.6 0 0 0 9 19z"/>'
      : code === 3 ? cloud : code <= 48 ? '<path d="M4 9h16M6 13h12M4 17h16"/>'
      : code <= 67 || (code >= 80 && code <= 82) ? '<path d="M7 14h10a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 7.1 5.2 4.4 4.4 0 0 0 7 14z"/><path d="M8 17l-1 3M12 17l-1 3M16 17l-1 3"/>'
      : code <= 77 ? '<path d="M7 14h10a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 7.1 5.2 4.4 4.4 0 0 0 7 14z"/><path d="M8 18h.01M12 19h.01M16 18h.01"/>'
      : '<path d="M7 14h10a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 7.1 5.2 4.4 4.4 0 0 0 7 14z"/><path d="M12.5 15l-2 3.5h3l-2 3.5"/>';
    return htmlNode(`<svg class="season-weather-icon" viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`);
  }
  const fmtLeft = ms => { const d = Math.floor(ms / 86400000), h = Math.floor(ms % 86400000 / 3600000), m = Math.floor(ms % 3600000 / 60000); return `${d ? d + 'd ' : ''}${h}h ${String(m).padStart(2, '0')}m`; };
  function nextRaceHero(data, next) {
    const hero = el('section', 'season-card season-next');
    const top = el('div', 'season-next-top');
    const titleRow = el('div', 'season-next-title'); const f = flag(next); if (f) titleRow.append(f);
    titleRow.append(el('h2', null, next.name));
    const meta = el('p', 'season-muted', `Round ${next.round} · ${next.circuit} · ${next.locality}, ${next.country}${next.sprint_weekend ? ' · Sprint weekend' : ''}`);
    const count = el('div', 'season-countdown'); count.setAttribute('aria-live', 'off');
    const countLabel = el('span', 'season-muted'), countValue = el('b');
    count.append(countLabel, countValue);
    let shown = false;
    const tick = () => {
      if (shown && !count.isConnected) return clearInterval(timer);   // the page moved on
      shown = true;
      const upcoming = next.sessions.find(x => new Date(x.start) > now());
      if (!upcoming) { countLabel.textContent = 'Race'; countValue.textContent = 'under way'; return; }
      countLabel.textContent = upcoming.name === 'Race' ? 'Race in' : `${upcoming.name} in`;
      countValue.textContent = fmtLeft(new Date(upcoming.start) - now());
    };
    const timer = setInterval(tick, 30000); tick();
    const title = el('div'); title.append(titleRow, meta);
    top.append(title, count);
    const list = el('ol', 'season-sessions');
    const upcoming = next.sessions.find(x => new Date(x.start) > now());
    // Your time or the circuit's (its UTC offset comes with the forecast). The choice is remembered on this device.
    const offset = Number.isFinite(next.utc_offset) ? next.utc_offset : null;
    let trackTime = false;
    try { trackTime = offset != null && localStorage.getItem('apex-season-track-time') === '1'; } catch { /* storage blocked */ }
    const clock = x => {
      const at = new Date(x.start);
      if (!trackTime) return at.toLocaleString([], {weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'});
      return new Date(at.getTime() + offset * 1000).toLocaleString([], {weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC'});
    };
    for (const x of next.sessions) {
      const at = new Date(x.start), li = el('li'); li.dataset.state = x === upcoming ? 'next' : at < now() ? 'done' : 'ahead';
      const name = el('span', null, x.name);
      if (li.dataset.state === 'done') name.prepend(htmlNode('<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7"/></svg>'));
      if (li.dataset.state === 'next') name.append(el('em', null, 'Next'));
      const stamp = el('time', null, clock(x)); stamp.dateTime = x.start;
      li.append(name, stamp);
      list.append(li);
    }
    let zoneToggle = null;
    if (offset != null) {
      zoneToggle = el('div', 'season-segment season-zone-toggle'); zoneToggle.setAttribute('role', 'group'); zoneToggle.setAttribute('aria-label', 'Session times');
      const paint = () => {
        list.querySelectorAll('time').forEach((t, i) => { t.textContent = clock(next.sessions[i]); });
        zoneToggle.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String((b.dataset.zone === 'track') === trackTime)));
        note.textContent = trackTime ? `Times at the circuit (UTC${offset >= 0 ? '+' : '−'}${Math.abs(offset / 3600)}).` : 'Times in your time zone.';
      };
      for (const [zone, label] of [['mine', 'Your time'], ['track', 'Track time']]) {
        const b = el('button', null, label); b.type = 'button'; b.dataset.zone = zone;
        b.addEventListener('click', () => { trackTime = zone === 'track'; try { localStorage.setItem('apex-season-track-time', trackTime ? '1' : '0'); } catch { /* storage blocked */ } paint(); });
        zoneToggle.append(b);
      }
      queueMicrotask(paint);
    }
    // The circuit (outline and facts) and its history.
    const body = el('div', 'season-next-body');
    const circuit = el('div', 'season-next-circuit');
    const outline = circuitOutline(next, 'season-track is-hero'); if (outline) circuit.append(outline);
    const props = circuitFeature(next)?.properties;
    const hist = data.next_history;
    const facts = el('dl', 'season-facts-list');
    const fact = (k, v, note) => { if (v == null || v === '') return; const d = el('div'), dd = el('dd', null, String(v)); if (note) dd.append(el('small', null, note)); d.append(el('dt', null, k), dd); facts.append(d); };
    circuit.prepend(el('h3', null, next.circuit));
    if (props) {
      fact('Lap length', props.length ? `${(props.length / 1000).toFixed(3)} km` : null);
      fact('Altitude', props.altitude != null ? `${props.altitude} m` : null);
      fact('Opened', props.opened);
      fact('First Grand Prix', props.firstgp);
    }
    if (hist?.held) {
      fact('Grands Prix here', hist.held);
      fact('Won from pole', `${Math.round(hist.won_from_pole / hist.held * 100)}%`, `${hist.won_from_pole} of ${hist.held}`);
    }
    circuit.append(facts);
    body.append(circuit);
    if (hist?.races?.length) {
      const past = el('div', 'season-history');
      past.append(el('h3', null, 'Recent winners here'));
      const summary = hist.most_wins ? `Most wins here: ${hist.most_wins.driver} (${hist.most_wins.wins}). First held ${hist.first}.` : `First held ${hist.first}.`;
      past.append(el('p', 'season-footnote season-history-sum', summary));
      const ol = el('ol');
      for (const r of hist.races) {
        const li = el('li');
        // A Linear list row: the driver's face where this season has their photo, otherwise the team's colour swatch.
        const face = data.drivers[r.winner_id] ? avatar(data, r.winner_id) : (typeof window.teamLogoMarkup === 'function' ? htmlNode(window.teamLogoMarkup(r.team)) : null);
        if (face) face.classList.add('season-history-face');
        const name = el('span', 'season-who'); if (face) name.append(face); name.append(el('strong', null, r.winner), el('small', null, r.team));
        li.append(el('span', 'season-history-year', String(r.year)), name, el('span', 'season-muted', r.grid === 1 ? 'from pole' : r.grid ? `from P${r.grid}` : 'from the pit lane'));
        ol.append(li);
      }
      past.append(ol);
      body.append(past);
    }
    // A forecast saved more than a day ago is out of date: leave it out rather than show old weather.
    const forecastFresh = !data.saved_at || Date.now() - Date.parse(data.saved_at) < 86400000;
    if (data.next_weather?.length && forecastFresh) {
      const sky = code => code == null ? '' : code === 0 ? 'Clear' : code <= 2 ? 'Partly cloudy' : code === 3 ? 'Cloudy' : code <= 48 ? 'Fog' : code <= 57 ? 'Drizzle' : code <= 67 ? 'Rain' : code <= 77 ? 'Snow' : code <= 82 ? 'Showers' : 'Thunderstorms';
      const forecast = el('div', 'season-weather');
      forecast.append(el('h3', null, 'Weekend forecast'));
      // Beyond about a week a forecast is a rough guide: say so rather than show it with the same confidence as tomorrow's.
      const daysAhead = (Date.parse(`${data.next_weather[0].date}T12:00:00`) - Date.now()) / 86400000;
      if (daysAhead > 7) forecast.append(el('p', 'season-muted season-weather-range', 'Long-range forecast: likely to change.'));
      // One Linear list row per day under quiet column labels: day, sky, high and low, chance of rain, wind.
      const list = el('div', 'season-forecast');
      const header = el('div', 'season-forecast-head');
      header.append(el('span', null, 'Day'), el('span'), el('span', null, 'High / low'), el('span', null, 'Rain'), el('span', null, 'Wind'));
      list.append(header);
      for (const d of data.next_weather) {
        const row = el('div', 'season-forecast-row'); row.dataset.wet = String(d.rain >= 50);
        row.title = `${sky(d.code)} \u00b7 ${Math.round(d.max)}\u00b0 / ${Math.round(d.min)}\u00b0 \u00b7 ${d.rain ?? 0}% chance of rain \u00b7 wind ${Math.round(d.wind)} km/h`;
        const icon = weatherIcon(d.code); icon.dataset.kind = d.code >= 95 ? 'storm' : d.rain >= 50 ? 'wet' : d.code <= 2 ? 'sun' : 'cloud';
        const temp = el('span', 'season-forecast-temp'); temp.append(el('b', null, `${Math.round(d.max)}\u00b0`), el('span', null, `${Math.round(d.min)}\u00b0`));
        row.append(el('span', 'season-forecast-day', new Date(`${d.date}T12:00:00`).toLocaleDateString([], {weekday: 'short'})), icon, temp,
          el('span', 'season-forecast-rain', `${d.rain ?? 0}%`), el('span', 'season-forecast-wind', `${Math.round(d.wind)} km/h`));
        list.append(row);
      }
      forecast.append(list);
      body.append(forecast);
    }
    const note = el('span', null, 'Times in your time zone.');
    const foot = el('p', 'season-footnote'); foot.append(note, ' Circuit outline and facts: f1-circuits (MIT); history: Jolpica; forecast: Open-Meteo.');
    hero.append(top, ...(zoneToggle ? [zoneToggle] : []), list, body, foot);
    return hero;
  }

  // ----- results -----
  function stat(data, title, entry, render) {
    const c = el('section', 'season-card season-stat');
    c.append(el('h3', null, title));
    if (!entry) { c.append(empty('Not enough races yet.')); return c; }
    c.append(...render(entry));
    return c;
  }
  function renderResults(data) {
    const cards = data.cards, out = [];
    const grid = el('div', 'season-stats');
    const pair = (title, key, unit) => stat(data, title, cards[key], e => {
      const row = el('div', 'season-stat-pair');
      for (const [side, label] of [['driver', 'Driver'], ['team', 'Constructor']]) {
        const box = el('div');
        box.append(el('span', 'season-muted', label));
        const v = e[side];
        if (!v) { box.append(el('b', null, '—')); row.append(box); continue; }
        const value = el('div', 'season-value'); value.append(el('b', 'season-big', `${v.value}`), el('small', 'season-muted', unit)); box.append(value);
        for (const id of v.ids) box.append(side === 'driver' ? who(data, id, {team: false, family: true}) : teamTag(data, id));
        row.append(box);
      }
      return [row];
    });
    grid.append(pair('Most wins', 'wins', 'wins'), pair('Most podiums', 'podiums', 'podiums'), pair('Most poles', 'poles', 'poles'));
    grid.append(stat(data, 'Best average finish', cards.average_finish, e => [el('b', 'season-big', e.value.toFixed(2)), who(data, e.ids[0]), el('p', 'season-footnote', `Over ${e.races} classified finishes; drivers classified in at least half the races. Retirements are not in this average: Driver stats shows each driver\u2019s finish rate and an average that counts them.`)]));
    grid.append(stat(data, 'Most places gained', cards.positions_gained, e => [el('b', 'season-big', `+${e.value}`), who(data, e.ids[0]), el('p', 'season-footnote', 'Grid to finish, classified finishes only; places lost are not subtracted.')]));
    const roundName = n => data.rounds.find(r => r.round === n)?.name || `Round ${n}`;
    grid.append(stat(data, 'Largest winning margin', cards.largest_margin, e => [el('b', 'season-big', `${e.value.toFixed(3)} s`), who(data, e.ids[0]), el('p', 'season-footnote', roundName(e.round))]));
    grid.append(stat(data, 'Closest winning margin', cards.closest_margin, e => [el('b', 'season-big', `${e.value.toFixed(3)} s`), who(data, e.ids[0]), el('p', 'season-footnote', roundName(e.round))]));
    grid.append(stat(data, 'Biggest climb', cards.comeback, e => [el('b', 'season-big', `+${e.gain}`), who(data, e.driver), el('p', 'season-footnote', `${e.pit_lane ? 'Pit lane' : `P${e.grid}`} → P${e.finish} · ${roundName(e.round)}`)]));
    const retirements = stat(data, 'Retirements by team', cards.retirements, e => {
      const max = Math.max(1, ...Object.values(e.by_team));
      const list = el('div', 'season-bars');
      for (const [t, n] of Object.entries(e.by_team)) {
        const row = el('div', 'season-bar-row'); row.append(teamTag(data, t));
        const bar = el('span', 'season-bar'); const fill = el('i'); fill.style.width = `${n / max * 100}%`; fill.style.background = teamColour(t); bar.append(fill);
        row.append(bar, el('b', null, String(n))); list.append(row);
      }
      const dns = Object.values(e.did_not_start || {}).reduce((a, b) => a + b, 0);
      return [list, el('p', 'season-footnote', `Cars that started and were not classified.${dns ? ` ${dns} more did not start, and are not counted.` : ''}`)];
    });
    out.push(seasonNumbers(data), grid);
    // Two columns of stacked cards, paired so the columns come out about the same length (the last card in each
    // stretches to meet the other), rather than side-by-side pairs of very different heights.
    const [crews, quickest] = data.pit_stops?.teams?.length ? pitStops(data) : [];
    const breakdown = columns([retirements, winsCard(data)], [crews, quickest]);
    // Grand Prix table: straight after the season's numbers, before the team breakdowns.
    out.push(gpResults(data), breakdown);
    return out;
  }
  // The season in a row of numbers.
  function seasonNumbers(data) {
    const done = data.rounds.filter(r => r.race.length);
    const at = (r, p) => r.race.find(x => x.position === p);
    const distinct = list => new Set(list.filter(Boolean)).size;
    const poleWins = done.filter(r => { const pole = r.qualifying.find(x => x.position === 1)?.driver; return pole && at(r, 1)?.driver === pole; }).length;
    const fastest = {}; for (const r of done) { const f = r.race.find(x => x.fastest_lap_rank === 1); if (f) fastest[f.driver] = (fastest[f.driver] || 0) + 1; }
    const [flId, flCount] = Object.entries(fastest).sort((x, y) => y[1] - x[1])[0] || [];
    const items = [
      ['Grands Prix', `${done.length}/${data.rounds.length}`, `${data.rounds.length - done.length} to go`],
      ['Different winners', distinct(done.map(r => at(r, 1)?.driver)), `${distinct(done.map(r => at(r, 1)?.team))} teams`],
      ['Different pole sitters', distinct(done.map(r => r.qualifying.find(x => x.position === 1)?.driver)), null],
      ['Podium finishers', distinct(done.flatMap(r => r.race.filter(x => x.position && x.position <= 3).map(x => x.driver))), null],
      ['Won from pole', done.length ? `${Math.round(poleWins / done.length * 100)}%` : '—', `${poleWins} of ${done.length}`],
      ['Retirements', done.reduce((n, r) => n + r.race.filter(x => !x.position && !notStarted(x)).length, 0), 'started, not classified'],
      ['Most fastest laps', flId ? family(data, flId) : '—', flId ? `${flCount} of ${done.length}` : null],
    ];
    const row = el('div', 'season-numbers');
    for (const [label, value, note] of items) { const d = el('div'); d.append(el('span', 'season-muted', label), el('b', null, String(value))); if (note) d.append(el('small', 'season-muted', note)); row.append(d); }
    const c = card(null, row); c.classList.add('season-numbers-card');
    return c;
  }
  function pitStops(data) {
    const ps = data.pit_stops;
    const max = Math.max(.2, ...ps.teams.map(t => Math.abs(t.vs_field)));
    const list = el('div', 'season-bars season-diverging');
    for (const t of ps.teams) {
      const row = el('div', 'season-bar-row'); row.append(teamTag(data, t.team));
      const bar = el('span', 'season-bar is-diverging'); const fill = el('i');
      const share = Math.abs(t.vs_field) / max * 50;
      fill.style.width = `${share}%`; fill.style.left = t.vs_field < 0 ? `${50 - share}%` : '50%'; fill.style.background = teamColour(t.team);
      fill.title = `${t.stops} stops · median ${t.median.toFixed(1)} s in the pit lane · best ${t.best.toFixed(1)} s`;
      bar.append(fill);
      row.append(bar, el('b', null, signed(t.vs_field, 2, ' s')));
      list.append(row);
    }
    const fastest = el('ol', 'season-ranked');
    for (const x of ps.fastest.slice(0, 8)) {
      const li = el('li'), r = data.rounds.find(y => y.round === x.round);
      const name = who(data, x.driver, {team: false}); li.append(name, el('b', null, `${x.seconds.toFixed(3)} s`));
      li.title = `${r?.name || 'Round ' + x.round}, lap ${x.lap}`;
      fastest.append(li);
    }
    return [card('Pit crews against the field', list, el('p', 'season-footnote', `Median of each team\u2019s stops against the median stop at the same Grand Prix: left of centre is quicker. ${ps.count} stops; pit lane time from entry to exit, stops over a minute left out.`)),
      card('Quickest pit lane times', fastest, el('p', 'season-footnote', 'Entry to exit, so short pit lanes (Zandvoort, Monaco) rank high. Hover a row for the Grand Prix.'))];
  }
  function winsCard(data) {
    const rows = Object.entries(data.driver_stats).filter(([, s]) => s.wins || s.sprint_wins).sort((x, y) => y[1].wins - x[1].wins || y[1].sprint_wins - x[1].sprint_wins);
    const max = Math.max(1, ...rows.map(([, s]) => s.wins + s.sprint_wins));
    const list = el('div', 'season-bars');
    for (const [id, st] of rows) {
      const row = el('div', 'season-bar-row'); row.append(who(data, id, {team: false, family: true}));
      const bar = el('span', 'season-bar is-stacked'), colour = teamColour(data.drivers[id]?.team);
      const g = el('i'); g.style.width = `${st.wins / max * 100}%`; g.style.background = colour; g.title = `${st.wins} Grand Prix wins`;
      const sp = el('i', 'is-light'); sp.style.width = `${st.sprint_wins / max * 100}%`; sp.style.background = colour; sp.title = `${st.sprint_wins} sprint wins`;
      bar.append(g, sp);
      const value = el('b', null, String(st.wins)); if (st.sprint_wins) value.append(el('small', 'season-muted', ` +${st.sprint_wins}`)); row.append(bar, value);
      list.append(row);
    }
    const legend = el('div', 'season-legend'); legend.append(el('span', null, 'Solid: Grand Prix wins'), el('span', null, 'Light: sprint wins'));
    return card('Wins', rows.length ? list : empty('No wins yet.'), legend);
  }
  function columns(...lists) {
    const row = el('div', 'season-columns');
    for (const list of lists) { const stack = el('div', 'season-column'); stack.append(...list.filter(Boolean)); if (stack.childElementCount) row.append(stack); }
    return row;
  }
  const wrap = node => { const w = el('div', 'season-table-wrap'); w.append(node); return w; };
  // Grand Prix results in two views: Race (podium, fastest lap, sprint winner, margin) and Qualifying (the front row,
  // pole lap, gaps, the Q3 cut and sprint pole). A row opens that session's full classification.
  function gpResults(data) {
    const session = state.resultsSession === 'qualifying' ? 'qualifying' : 'race';
    const rows = data.winners.map(w => [w, data.rounds.find(x => x.round === w.round)])
      .filter(([, r]) => r?.status === 'done' && (session === 'race' || r.qualifying.length));
    const heads = session === 'race'
      ? ['Winner', 'Second', 'Third', 'Fastest lap', 'Sprint', ['Margin', 'num']]
      : ['Pole', 'Second', 'Third', ['Pole lap', 'num'], ['Gap to P2', 'num'], ['Q3 cut', 'num'], 'Sprint pole'];
    const table = el('table', 'season-table');
    const head = el('tr'); head.append(el('th', 'num', 'Round'), el('th', null, 'Grand Prix'));
    for (const h of heads) { const [label, cls] = Array.isArray(h) ? h : [h, null]; head.append(el('th', cls, label)); }
    head.querySelectorAll('th').forEach(th => { th.scope = 'col'; });
    const thead = el('thead'); thead.append(head); table.append(thead);
    const tbody = el('tbody');
    const cell = id => { const td = el('td'); if (id) td.append(who(data, id, {code: true, team: false})); else td.textContent = '—'; return td; };
    for (const [w, r] of rows) {
      // The row opens on a click anywhere; keyboard and screen readers use the Grand Prix name, a real disclosure button.
      const tr = el('tr', 'season-row-expand');
      const gp = el('td'), gpName = el('button', 'season-gp season-row-toggle'); gpName.type = 'button'; gpName.setAttribute('aria-expanded', String(state.expanded === r.round));
      const f = flag(r); if (f) gpName.append(f); gpName.append(el('span', null, r.name)); gp.append(gpName);
      tr.append(el('td', 'num', String(r.round)), gp);
      if (session === 'race') {
        const at = p => r.race.find(x => x.position === p)?.driver;
        tr.append(cell(w.race_winner), cell(at(2)), cell(at(3)), cell(r.race.find(x => x.fastest_lap_rank === 1)?.driver), cell(w.sprint_winner),
          el('td', 'num', w.margin != null ? `${w.margin.toFixed(3)} s` : '—'));
      } else {
        const at = p => r.qualifying.find(x => x.position === p);
        const pole = at(1), second = at(2);
        const poleLap = Number.isFinite(pole?.q3) ? pole.q3 : null;
        const gap2 = Number.isFinite(second?.q3) && poleLap != null ? second.q3 - poleLap : null;
        // The cut into Q3: the slowest Q2 time that still reached Q3.
        const cut = r.qualifying.filter(x => x.reached === 3 && Number.isFinite(x.q2)).reduce((m, x) => Math.max(m, x.q2), -Infinity);
        tr.append(cell(pole?.driver), cell(second?.driver), cell(at(3)?.driver), el('td', 'num', poleLap != null ? lapTime(poleLap) : '—'),
          el('td', 'num', gap2 != null ? `+${gap2.toFixed(3)} s` : '—'), el('td', 'num', Number.isFinite(cut) ? lapTime(cut) : '—'), cell(sprintPole(r)));
      }
      const toggle = () => { state.expanded = state.expanded === r.round ? null : r.round; paint(() => renderResults(data)); };
      tr.addEventListener('click', toggle);  // the button's click (also Enter/Space) bubbles here
      tbody.append(tr);
      if (state.expanded === r.round) {
        const detail = el('tr', 'season-detail'); const td = el('td'); td.colSpan = heads.length + 2;
        td.append(session === 'qualifying' ? qualifyingClassification(data, r) : classification(data, r));
        if (session !== 'qualifying') td.append(raceReport(data, r));
        detail.append(td); tbody.append(detail);
      }
    }
    table.append(tbody);
    const pills = el('div', 'season-segment season-zone-toggle'); pills.setAttribute('role', 'group'); pills.setAttribute('aria-label', 'Session');
    for (const [id, label] of [['race', 'Race'], ['qualifying', 'Qualifying']]) {
      const b = el('button', null, label); b.type = 'button'; b.setAttribute('aria-pressed', String(session === id));
      b.addEventListener('click', () => { if (session === id) return; state.resultsSession = id; state.expanded = null; paint(() => renderResults(data)); });
      pills.append(b);
    }
    const note = session === 'race' ? 'Select a race for its classification.' : 'Select a round for the full qualifying result, Q1 to Q3. Q3 cut: the slowest Q2 lap that still reached Q3.';
    return card('Grand Prix results', pills, el('p', 'season-footnote', note), wrap(table));
  }
  const lapTime = t => { const m = Math.floor(t / 60); return `${m}:${(t - m * 60).toFixed(3).padStart(6, '0')}`; };
  // Full qualifying result: each driver's time in every part they ran, and the gap to pole in the last part they reached.
  function qualifyingClassification(data, r) {
    const t = el('table', 'season-table season-mini');
    t.innerHTML = '<thead><tr><th scope="col" class="num">Pos</th><th scope="col">Driver</th><th scope="col" class="num">Q1</th><th scope="col" class="num">Q2</th><th scope="col" class="num">Q3</th><th scope="col" class="num">Gap</th></tr></thead>';
    const tb = el('tbody');
    const pole = r.qualifying.find(x => x.position === 1);
    for (const q of [...r.qualifying].sort((a, b) => a.position - b.position)) {
      const tr = el('tr'), d = el('td'); d.append(who(data, q.driver));
      const part = Number.isFinite(q.q3) ? 'q3' : Number.isFinite(q.q2) ? 'q2' : 'q1';
      const gap = q.position !== 1 && Number.isFinite(q[part]) && Number.isFinite(pole?.[part]) ? `+${(q[part] - pole[part]).toFixed(3)}` : '';
      tr.append(el('td', 'num', String(q.position)), d, ...['q1', 'q2', 'q3'].map(k => el('td', 'num', Number.isFinite(q[k]) ? lapTime(q[k]) : '')), el('td', 'num season-muted', gap));
      tb.append(tr);
    }
    t.append(tb);
    return wrap(t);
  }
  // ----- race report: what happened, stints and pit stops (Results, an opened race row) -----
  // From the race's own lap data (/api/session, the Race laps the session view reads) and its pit stops
  // (/api/performance/pits, DHL stationary times), both published per race; loaded only when a row is opened.
  const eventsCache = {};
  const seasonEvents = year => {
    const request = window.apexDataRequest;
    if (typeof request !== 'function') return Promise.resolve([]);
    eventsCache[year] ||= request(`/api/events?year=${year}`).then(e => (Array.isArray(e) ? e : [])).catch(() => []);
    return eventsCache[year];
  };
  const reportCache = {};
  const TYRE = {SOFT: '#ff493e', MEDIUM: '#ffd735', HARD: '#f5f5f7', INTERMEDIATE: '#43cf79', WET: '#3395ff'};
  function loadReport(year, round) {
    const key = `${year}:${round}`;
    if (reportCache[key]) return reportCache[key];
    reportCache[key] = (async () => {
      const request = window.apexDataRequest, event = (await seasonEvents(year)).find(e => e.round === round);
      if (!event || typeof request !== 'function') return null;
      const [session, pits] = await Promise.all([
        request('/api/session?' + new URLSearchParams({year, gp: event.name, session: 'Race', round})).catch(() => null),
        request('/api/performance/pits?' + new URLSearchParams({year, gp: event.name, source: 'dhl-fallback-v2'}) + '&schema=3').catch(() => null)]);
      return session?.drivers?.length ? {session, pits} : null;
    })();
    reportCache[key].then(v => { if (!v) delete reportCache[key]; }, () => { delete reportCache[key]; });
    return reportCache[key];
  }
  function raceReport(data, r) {
    const box = el('div', 'season-report'); box.append(el('p', 'season-muted season-report-loading', 'Loading the race report…'));
    const byCode = {};
    for (const [id, d] of Object.entries(data.drivers)) if (d.code) byCode[d.code] = id;
    loadReport(state.year, r.round).then(report => {
      if (!report) { box.replaceChildren(el('p', 'season-muted', 'No lap data for this race yet.')); return; }
      const drivers = report.session.drivers.filter(d => d.laps?.length);
      // Stints: consecutive laps on one stint number, with their compound and length.
      const stintsOf = d => {
        const out = [];
        for (const lap of d.laps) { const last = out.at(-1); if (last && last.stint === lap.stint) last.laps++; else out.push({stint: lap.stint, compound: String(lap.compound || '').toUpperCase(), laps: 1, from: lap.lap}); }
        return out;
      };
      // Laps led: whoever starts the next lap first led the lap before it (the race end for the final lap).
      const starts = {};
      for (const d of drivers) for (const lap of d.laps) if (lap.date_start) (starts[lap.lap] ||= []).push([d.code, Date.parse(lap.date_start)]);
      const led = {};
      const maxLap = Math.max(...drivers.map(d => d.laps.at(-1).lap));
      for (let n = 1; n <= maxLap; n++) {
        const next = starts[n + 1];
        const leader = next?.length ? next.reduce((a, b) => (b[1] < a[1] ? b : a))[0] : (n === maxLap ? r.race.find(x => x.position === 1) && data.drivers[r.race.find(x => x.position === 1).driver]?.code : null);
        if (leader) led[leader] = (led[leader] || 0) + 1;
      }
      // Neutralisations along the leader's laps: separate SC / VSC periods and red flags.
      const leaderCode = data.drivers[r.race.find(x => x.position === 1)?.driver]?.code;
      const leaderLaps = (drivers.find(d => d.code === leaderCode) || drivers[0]).laps;
      const periods = kind => leaderLaps.reduce((n, lap, i) => n + (lap.neutralised === kind && leaderLaps[i - 1]?.neutralised !== kind ? 1 : 0), 0);
      const sc = periods('SC'), vsc = periods('VSC'), red = periods('RED');
      const visits = (report.pits?.visits || []).filter(v => v.visit_type === 'service');
      const best = (list, key) => list.reduce((a, b) => (a == null || b[key] < a[key] ? b : a), null);
      const fastestLap = best(drivers.flatMap(d => d.laps.filter(l => Number.isFinite(l.time) && !l.deleted).map(l => ({code: d.code, time: l.time, lap: l.lap}))), 'time');
      const longest = best(drivers.flatMap(d => stintsOf(d).map(s => ({code: d.code, laps: -s.laps, compound: s.compound}))), 'laps');
      const fastestStop = best(visits.filter(v => Number.isFinite(v.stop_duration)), 'stop_duration');
      const mover = best(r.race.filter(x => x.position && x.grid).map(x => ({id: x.driver, gain: -(x.grid - x.position)})), 'gain');
      const pole = r.qualifying.find(q => q.position === 1);
      const leadLeader = Object.entries(led).sort((a, b) => b[1] - a[1])[0];
      const retired = r.race.filter(x => !x.position && x.status !== 'Did not start').length;
      // What happened: one flat strip of facts (the Insight readout pattern), each a label, a driver and a number.
      const facts = el('div', 'season-report-facts');
      const fact = (label, id, value, note) => {
        const f = el('div'); f.append(el('span', 'season-muted', label));
        const line = el('b'); if (id && data.drivers[id]) line.append(who(data, id, {code: true, team: false})); else if (id) line.append(el('strong', null, id));
        if (value != null) line.append(el('span', null, value));
        f.append(line); if (note) f.append(el('small', 'season-muted', note)); facts.append(f);
      };
      if (pole) fact('Pole', pole.driver, Number.isFinite(pole.q3) ? lapTime(pole.q3) : null);
      if (fastestLap) fact('Fastest lap', byCode[fastestLap.code] || fastestLap.code, lapTime(fastestLap.time), `lap ${fastestLap.lap}`);
      if (leadLeader) fact('Most laps led', byCode[leadLeader[0]] || leadLeader[0], `${leadLeader[1]} laps`);
      if (longest) fact('Longest stint', byCode[longest.code] || longest.code, `${-longest.laps} laps`, longest.compound ? longest.compound.toLowerCase() : null);
      if (mover && mover.gain < 0) fact('Biggest mover', mover.id, `+${-mover.gain}`, 'places, grid to flag');
      if (fastestStop) fact('Fastest stop', byCode[fastestStop.driver] || fastestStop.driver, `${fastestStop.stop_duration.toFixed(2)} s`, 'stationary');
      const neutral = el('div'); neutral.append(el('span', 'season-muted', 'Interruptions'));
      neutral.append(el('b', null, sc + vsc + red ? [sc && `${sc} SC`, vsc && `${vsc} VSC`, red && `${red} red flag${red > 1 ? 's' : ''}`].filter(Boolean).join(' · ') : 'none'));
      neutral.append(el('small', 'season-muted', `${retired} retirement${retired === 1 ? '' : 's'}`)); facts.append(neutral);
      // Stints and pit stops, in finishing order: the tyre bar runs the race distance, one segment per stint.
      const order = r.race.map(x => data.drivers[x.driver]?.code).filter(Boolean);
      const rows = drivers.slice().sort((a, b) => (order.indexOf(a.code) + 1 || 99) - (order.indexOf(b.code) + 1 || 99));
      const t = el('table', 'season-table season-mini season-stints');
      const head = el('tr');
      head.append(el('th', 'num', 'Pos'), el('th', null, 'Driver'), el('th', 'num', 'Stops'), el('th', null, 'Tyres · laps per stint'), el('th', null, 'Stops, stationary'));
      const thead = el('thead'); thead.append(head); t.append(thead);
      const tb = el('tbody');
      for (const d of rows) {
        const res = r.race.find(x => data.drivers[x.driver]?.code === d.code), stints = stintsOf(d), mine = visits.filter(v => v.driver === d.code);
        const tr = el('tr'), bar = el('div', 'season-stint-bar');
        for (const s of stints) {
          const seg = el('span', null, s.laps >= 4 ? String(s.laps) : '');
          seg.style.flexGrow = String(s.laps); seg.style.setProperty('--tyre', TYRE[s.compound] || 'var(--ui-tertiary)');
          seg.title = `${s.compound.toLowerCase() || 'unknown'} · ${s.laps} laps from lap ${s.from}`; bar.append(seg);
        }
        bar.style.setProperty('--race', String(maxLap)); bar.style.width = `${(d.laps.at(-1).lap / maxLap * 100).toFixed(1)}%`;
        const name = el('td'); name.append(res ? who(data, res.driver, {code: true, team: false}) : el('strong', null, d.code));
        const stops = el('td', 'season-stop-times', mine.length ? mine.map(v => (Number.isFinite(v.stop_duration) ? `${v.stop_duration.toFixed(1)} s` : '—')).join(' · ') : '—');
        if (mine.length) stops.title = mine.map(v => `Lap ${v.lap}: ${Number.isFinite(v.lane_duration) ? v.lane_duration.toFixed(1) + ' s in the pit lane' : ''}${Number.isFinite(v.stop_duration) ? ', ' + v.stop_duration.toFixed(2) + ' s stationary' : ''}`).join('\n');
        const barCell = el('td'); barCell.append(bar);
        tr.append(el('td', 'num season-muted', res?.position ? String(res.position) : (res?.status === 'Did not start' ? 'DNS' : 'DNF')), name, el('td', 'num', String(mine.length || Math.max(0, stints.length - 1))), barCell, stops);
        tb.append(tr);
      }
      t.append(tb);
      const tyres = el('div', 'season-legend');
      for (const [k, c] of Object.entries(TYRE)) { if (!rows.some(d => stintsOf(d).some(s => s.compound === k))) continue; const s = el('span', null, k.charAt(0) + k.slice(1).toLowerCase()); s.dataset.tone = 'custom'; s.style.setProperty('--tone', c); tyres.append(s); }
      box.replaceChildren(el('h4', 'season-report-title', 'What happened'), facts, el('h4', 'season-report-title', 'Stints and pit stops'), wrap(t), tyres,
        el('p', 'season-footnote', 'From the race’s lap data and pit timing. Laps led: whoever starts the next lap first. Interruptions count separate safety car, virtual safety car and red-flag periods. Stop times are stationary (DHL); hover for the time in the pit lane. A tyre change during a red flag starts a stint without a stop.'));
    });
    return box;
  }

  function classification(data, r) {
    const t = el('table', 'season-table season-mini');
    t.innerHTML = '<thead><tr><th scope="col" class="num">Pos</th><th scope="col">Driver</th><th scope="col" class="num">Grid</th><th scope="col" class="num">+/-</th><th scope="col" class="num">Time / status</th><th scope="col" class="num">Pts</th></tr></thead>';
    const tb = el('tbody');
    for (const row of r.race) {
      const tr = el('tr'); const change = row.position && row.grid ? row.grid - row.position : null;
      const time = row.position === 1 && row.time_ms ? msTime(row.time_ms) : row.gap || row.status;
      const delta = el('td', `num ${change > 0 ? 'is-up' : change < 0 ? 'is-down' : ''}`, change == null ? '—' : change > 0 ? `+${change}` : String(change));
      const d = el('td'); d.append(who(data, row.driver));
      tr.append(el('td', 'num', row.position_text), d, el('td', 'num', row.grid ? String(row.grid) : 'Pit'), delta, el('td', 'num', time || ''), el('td', 'num', row.points ? String(row.points) : ''));
      tb.append(tr);
    }
    t.append(tb);
    return wrap(t);
  }
  const msTime = ms => { const s = ms / 1000, h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), r = (s % 60).toFixed(3).padStart(6, '0'); return `${h}:${String(m).padStart(2, '0')}:${r}`; };

  // ----- standings -----
  function renderStandings(data) {
    const drivers = state.standings === 'drivers', evo = data.standings[drivers ? 'drivers' : 'teams'];
    const toggle = el('div', 'season-segment');
    for (const [id, label] of [['drivers', 'Drivers'], ['teams', 'Constructors']]) {
      const b = el('button', null, label); b.type = 'button'; b.setAttribute('aria-pressed', String(state.standings === id));
      b.addEventListener('click', () => { state.standings = id; paint(() => renderStandings(data)); });
      toggle.append(b);
    }
    if (!evo.length) return [toggle, empty('No races yet this season.')];
    const last = evo.at(-1).table, previous = evo.length > 1 ? evo.at(-2).table : null;
    const colour = id => teamColour(drivers ? data.drivers[id]?.team : id);
    const label = id => drivers ? driverName(data, id) : teamName(data, id);
    const table = el('table', 'season-table season-standings');
    table.innerHTML = `<thead><tr><th scope="col" class="num">Pos</th><th scope="col"></th><th scope="col">${drivers ? 'Driver' : 'Constructor'}</th><th scope="col" class="num">Wins</th><th scope="col" class="num" title="Points from the last five rounds, sprints included">Last 5</th>${drivers ? '' : '<th scope="col">Split</th>'}<th scope="col" class="num season-points">Points</th><th scope="col" class="num">Gap</th></tr></thead>`;
    const tb = el('tbody');
    const leaderPoints = last[0].points;
    // Form: points over the last five completed rounds. Constructors: each driver's share of the team's points.
    const recent = data.rounds.filter(r => r.race.length).slice(-5);
    const form = id => recent.reduce((sum, r) => sum + roundPoints(r, drivers ? 'driver' : 'team', id), 0);
    const split = team => {
      const by = {};
      for (const r of data.rounds) for (const x of [...r.race, ...r.sprint]) if (x.team === team && x.points) by[x.driver] = (by[x.driver] || 0) + x.points;
      return Object.entries(by).sort((a, b) => b[1] - a[1]);
    };
    for (const e of last) {
      const before = previous?.find(x => x.id === e.id)?.position, change = before ? before - e.position : 0;
      const tr = el('tr'); tr.dataset.id = e.id;
      const name = el('td'); name.append(drivers ? who(data, e.id) : teamTag(data, e.id));
      tr.append(el('td', 'num season-pos', String(e.position)), el('td', `season-move ${change > 0 ? 'is-up' : change < 0 ? 'is-down' : ''}`, change > 0 ? `▲${change}` : change < 0 ? `▼${-change}` : ''),
        name, el('td', 'num', String(e.wins)), el('td', 'num season-muted', String(Math.round(form(e.id) * 10) / 10)));
      if (!drivers) {
        const parts = split(e.id), total = parts.reduce((a, [, v]) => a + v, 0), cell = el('td', 'season-split');
        const bar = el('span', 'season-split-bar');
        parts.forEach(([d, v], i) => { const seg = el('i'); seg.style.width = `${total ? v / total * 100 : 0}%`; seg.style.background = colour(e.id); seg.style.opacity = String(i ? .45 : 1); seg.title = `${driverName(data, d)}: ${v} points`; bar.append(seg); });
        cell.append(bar); cell.title = parts.map(([d, v]) => `${driverCode(data, d)} ${v}`).join(' · ');
        tr.append(cell);
      }
      tr.append(el('td', 'num season-strong season-points', String(e.points)), el('td', 'num season-muted', e.position === 1 ? '' : `−${(leaderPoints - e.points).toFixed(0)}`));
      tb.append(tr);
    }
    table.append(tb);
    const ids = last.map(e => e.id);
    const points = lineChart(evo.map(s => s.round), ids.map(id => ({id, colour: colour(id), label: label(id), short: drivers ? driverCode(data, id) : teamName(data, id),
      values: evo.map(s => s.table.find(x => x.id === id)?.points ?? 0)})), {title: 'Points after each round', endLabels: drivers ? 6 : 5, height: 400});
    const ranks = bumpChart(evo.map(s => s.round), ids.map(id => ({id, colour: colour(id), label: drivers ? driverCode(data, id) : teamName(data, id),
      values: evo.map(s => s.table.find(x => x.id === id)?.position ?? null)})));
    const layout = el('div', 'season-two season-standings-layout');
    layout.append(card('Championship order', wrap(table)), el('div', 'season-stack'));
    layout.lastChild.append(...[titleFight(data, drivers), card('Points evolution', points), card('Championship position', ranks)].filter(Boolean));
    linkHover(layout);
    // Drivers: finishing positions or points per round, switched in place (the choice is kept while the page is open).
    const showPoints = () => !drivers || state.matrix === 'points';
    const note = () => showPoints() ? 'Points scored at each Grand Prix weekend, sprint included; deeper colour means more points.'
      : 'Grand Prix finishing position; a small number is the sprint result when it scored. Purple win, green podium, light points, red not classified.';
    let grid = resultsMatrix(data, drivers, last, showPoints());
    const foot = el('p', 'season-footnote', note());
    let matrixToggle = null;
    if (drivers) {
      matrixToggle = el('div', 'season-segment season-zone-toggle'); matrixToggle.setAttribute('role', 'group'); matrixToggle.setAttribute('aria-label', 'Show by round');
      for (const [id, label] of [['position', 'Positions'], ['points', 'Points']]) {
        const b = el('button', null, label); b.type = 'button'; b.dataset.mode = id; b.setAttribute('aria-pressed', String(state.matrix === id));
        b.addEventListener('click', () => {
          if (state.matrix === id) return;
          state.matrix = id;
          matrixToggle.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.mode === id)));
          const next = resultsMatrix(data, drivers, last, showPoints()); grid.replaceWith(next); grid = next; foot.textContent = note();
        });
        matrixToggle.append(b);
      }
    }
    const matrix = card(drivers ? 'Results by round' : 'Points by round', ...[matrixToggle, grid, foot].filter(Boolean));
    return [toggle, layout, matrix, ...(drivers ? [] : [qualiPace(data)])].filter(Boolean);
  }
  // Who can still win: points scored (sprints included) against the most still available.
  function titleFight(data, drivers) {
    const key = drivers ? 'driver' : 'team';
    const points = {};
    for (const r of data.rounds) for (const row of [...r.race, ...r.sprint]) points[row[key]] = (points[row[key]] || 0) + row.points;
    const ranked = Object.entries(points).sort((x, y) => y[1] - x[1]);
    if (!ranked.length) return null;
    const racesLeft = data.rounds.filter(r => !r.race.length).length;
    const sprintsLeft = data.rounds.filter(r => !r.race.length && r.sprint_weekend && !r.sprint.length).length;
    const left = racesLeft * (drivers ? 25 : 43) + sprintsLeft * (drivers ? 8 : 15);
    const [leaderId, leaderPoints] = ranked[0];
    const table = data.standings[drivers ? 'drivers' : 'teams'].at(-1)?.table || [];
    const wins = id => table.find(e => e.id === id)?.wins || 0;
    // Level on points is settled on countback, first on wins: a rival who can only tie needs to be able to out-win the leader.
    const alive = ranked.filter(([id, p]) => p + left > leaderPoints || id === leaderId || (p + left === leaderPoints && wins(id) + racesLeft > wins(leaderId)));
    const name = id => (drivers ? driverName(data, id) : teamName(data, id));
    const lead = leaderPoints - (ranked[1]?.[1] || 0);
    const headline = !racesLeft ? `${name(leaderId)} won the ${drivers ? 'drivers\u2019' : 'constructors\u2019'} title.`
      : alive.length === 1 ? `${name(leaderId)} has the title won: a ${lead}-point lead with ${left} points left.`
      : `${alive.length} can still win it. ${left} points are left from ${racesLeft} Grand${racesLeft === 1 ? '' : 's'} Prix${sprintsLeft ? ` and ${sprintsLeft} sprint${sprintsLeft === 1 ? '' : 's'}` : ''}.`;
    const c = card(drivers ? 'Title fight' : 'Constructors\u2019 title fight');
    c.classList.add('season-title-fight');
    c.append(el('p', 'season-headline', headline));
    const shown = (alive.length > 1 ? alive : ranked.slice(0, 3)).slice(0, 6);
    const scale = Math.max(...shown.map(([, p]) => p + left), 1);
    const list = el('div', 'season-bars');
    for (const [id, p] of shown) {
      const row = el('div', 'season-bar-row'); row.append(drivers ? who(data, id, {team: false, family: true}) : teamTag(data, id));
      const bar = el('span', 'season-bar is-reach'); const colour = teamColour(drivers ? data.drivers[id]?.team : id);
      const now_ = el('i'); now_.style.width = `${p / scale * 100}%`; now_.style.background = colour;
      const reach = el('i', 'is-ghost'); reach.style.width = `${left / scale * 100}%`; reach.style.setProperty('--team', colour);
      const mark = el('b', 'season-bar-mark'); mark.style.left = `${leaderPoints / scale * 100}%`;
      bar.append(now_, reach, mark);
      row.append(bar, el('b', null, String(Math.round(p * 10) / 10)));
      list.append(row);
    }
    const legend = el('div', 'season-legend'); legend.append(el('span', null, 'Solid: points now'), el('span', null, 'Outline: the most still possible'), el('span', null, 'Line: the leader'));
    c.append(list, legend);
    return c;
  }
  function resultsMatrix(data, drivers, table, points = !drivers) {
    const key = drivers ? 'driver' : 'team';
    const rounds = data.rounds;
    const t = el('table', 'season-table season-matrix season-grid');
    const head = el('tr'); head.append(el('th', null, drivers ? 'Driver' : 'Constructor'));
    for (const r of rounds) { const th = el('th', 'num'); th.append(roundMark(r)); head.append(th); }
    head.append(el('th', 'num', 'Pts'));
    const thead = el('thead'); thead.append(head); t.append(thead);
    const tb = el('tbody');
    const maxPoints = points ? Math.max(1, ...rounds.flatMap(r => table.map(e => roundPoints(r, key, e.id)))) : 1;
    for (const e of table) {
      const tr = el('tr'); tr.dataset.id = e.id;
      const name = el('th'); name.append(drivers ? who(data, e.id, {code: true, team: false}) : teamTag(data, e.id)); tr.append(name);
      for (const r of rounds) {
        if (notRun(r)) { tr.append(upcomingCell(r)); continue; }
        const td = el('td', 'num');
        if (!points) {
          const row = r.race.find(x => x.driver === e.id), sprint = r.sprint.find(x => x.driver === e.id);
          if (row) {
            td.dataset.tone = !row.position ? 'out' : row.position === 1 ? 'win' : row.position <= 3 ? 'podium' : row.points > 0 ? 'points' : 'none';
            td.append(el('span', null, row.position ? String(row.position) : row.position_text === 'R' ? 'DNF' : row.position_text));
            if (sprint?.points) td.append(el('sup', null, String(sprint.position)));
            td.title = `${r.name}: ${row.position ? 'P' + row.position : row.status}${row.grid ? ' from P' + row.grid : ''}${sprint ? ` · sprint P${sprint.position_text}` : ''}`;
          }
        } else {
          const pts = roundPoints(r, key, e.id), ran = !drivers || r.race.some(x => x.driver === e.id) || r.sprint.some(x => x.driver === e.id);
          td.textContent = pts ? String(pts) : ran ? '0' : '';
          if (!pts && ran) td.classList.add('is-zero');
          if (pts) { td.classList.add('is-heat'); td.style.setProperty('--heat', String(.12 + .7 * pts / maxPoints)); td.style.setProperty('--team', teamColour(drivers ? data.drivers[e.id]?.team : e.id)); }
          td.title = `${r.name}: ${pts} point${pts === 1 ? '' : 's'}`;
        }
        tr.append(td);
      }
      tr.append(el('td', 'num season-strong', String(e.points)));
      tb.append(tr);
    }
    t.append(tb);
    return wrap(t);
  }
  // Each team's best qualifying lap against pole, per round.
  function qualiPace(data) {
    if (!data.rounds.some(r => r.qualifying.length)) return null;
    const rounds = data.rounds.filter(r => r.qualifying.length || notRun(r));
    const teams = Object.keys(data.teams);
    // The same definition as Car performance: each team's fastest lap in any part of qualifying against the fastest lap
    // anyone set (not necessarily the pole-sitter's), as % of that lap; across rounds, the median.
    const gaps = Object.fromEntries(teams.map(t => [t, rounds.map(r => {
      const fastest = Math.min(...r.qualifying.map(bestLap));
      const best = Math.min(...r.qualifying.filter(x => x.team === t).map(bestLap));
      return Number.isFinite(fastest) && Number.isFinite(best) ? (best - fastest) / fastest * 100 : null;
    })]));
    const avg = t => median(gaps[t]) ?? Infinity;
    const order = teams.filter(t => gaps[t].some(Number.isFinite)).sort((x, y) => avg(x) - avg(y));
    const worst = Math.max(.5, ...order.flatMap(t => gaps[t].filter(Number.isFinite)));
    const tbl = el('table', 'season-table season-matrix season-grid');
    const head = el('tr'); head.append(el('th', null, 'Constructor'));
    for (const r of rounds) { const th = el('th', 'num'); th.append(roundMark(r)); head.append(th); }
    head.append(el('th', 'num', 'Median'));
    const thead = el('thead'); thead.append(head); tbl.append(thead);
    const tb = el('tbody');
    for (const t of order) {
      const tr = el('tr'); const name = el('th'); name.append(teamTag(data, t)); tr.append(name);
      gaps[t].forEach((g, i) => {
        if (!rounds[i].qualifying.length) { tr.append(upcomingCell(rounds[i])); return; }
        const td = el('td', 'num');
        if (Number.isFinite(g)) {
          td.textContent = g < .0005 ? 'Best' : g.toFixed(2);
          td.classList.add('is-heat'); td.style.setProperty('--team', teamColour(t)); td.style.setProperty('--heat', String(.1 + .7 * (1 - Math.min(g / worst, 1))));
          td.title = `${rounds[i].name}: ${g < .0005 ? 'fastest lap of qualifying' : `+${g.toFixed(3)}% to the fastest lap`}`;
        }
        tr.append(td);
      });
      tr.append(el('td', 'num season-strong', `${avg(t).toFixed(2)}%`));
      tb.append(tr);
    }
    tbl.append(tb);
    return card('Qualifying pace: gap to the fastest lap', wrap(tbl), el('p', 'season-footnote', 'Each team’s fastest lap in any part of qualifying against the fastest lap anyone set, in % of that lap; deeper colour is closer. The median across rounds keeps one wet or red-flagged session from deciding the order. A team out in Q1 ran on a slower track than Q3, so its gap includes track evolution; Car performance can adjust for it.'));
  }
  // Hovering a row, a line or a legend entry highlights that entry everywhere in the layout.
  function linkHover(scope) {
    scope.addEventListener('pointerover', event => {
      const id = event.target.closest('[data-id]')?.dataset.id;
      scope.querySelectorAll('[data-id]').forEach(n => n.classList.toggle('is-dim', !!id && n.dataset.id !== id));
    });
    scope.addEventListener('pointerleave', () => scope.querySelectorAll('.is-dim').forEach(n => n.classList.remove('is-dim')));
  }

  // ---------- derived data ----------
  const notStarted = row => /did not start|withdr/i.test(row.status || '') || row.position_text === 'W';
  const bestLap = q => (q ? Math.min(...[q.q1, q.q2, q.q3].filter(Number.isFinite)) : Infinity);
  const roundPoints = (round, key, id) => [...round.race, ...round.sprint].filter(x => x[key] === id).reduce((sum, x) => sum + x.points, 0);
  const family = (data, id) => data.drivers[id]?.family || driverName(data, id);
  // Teammates' qualifying gap: the deepest session both set a time in, as a share of the second driver's lap.
  function qualiGap(round, a, b) {
    const qa = round.qualifying.find(x => x.driver === a), qb = round.qualifying.find(x => x.driver === b);
    if (!qa || !qb) return null;
    for (const k of ['q3', 'q2', 'q1']) {
      if (Number.isFinite(qa[k]) && Number.isFinite(qb[k])) return {session: k.toUpperCase(), seconds: qa[k] - qb[k], percent: (qa[k] - qb[k]) / qb[k] * 100};
    }
    return null;
  }
  const signed = (v, digits = 2, unit = '') => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(digits)}${unit}`;
  const median = values => { const v = values.filter(Number.isFinite).sort((x, y) => x - y); return v.length ? (v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : null; };

  // ---------- race codes: three letters per Grand Prix, as F1's own graphics use ----------
  const RACE_CODES = [['australia', 'AUS'], ['chin', 'CHN'], ['japan', 'JPN'], ['bahrain', 'BHR'], ['saudi', 'KSA'], ['miami', 'MIA'],
    ['emilia', 'EMI'], ['monaco', 'MON'], ['canad', 'CAN'], ['barcelona', 'BAR'], ['spanish', 'ESP'], ['madrid', 'MAD'], ['austria', 'AUT'],
    ['styria', 'STY'], ['70th', '70A'], ['british', 'GBR'], ['hungar', 'HUN'], ['belgi', 'BEL'], ['dutch', 'NED'], ['italian', 'ITA'],
    ['tuscan', 'TUS'], ['russian', 'RUS'], ['azerbaijan', 'AZE'], ['singapore', 'SIN'], ['turkish', 'TUR'], ['portug', 'POR'], ['eifel', 'EIF'],
    ['united states', 'USA'], ['mexic', 'MEX'], ['paulo', 'BRA'], ['brazil', 'BRA'], ['las vegas', 'LVG'], ['qatar', 'QAT'], ['abu dhabi', 'ABU'],
    ['sakhir', 'SKH'], ['french', 'FRA'], ['german', 'GER'], ['malaysia', 'MAL']];
  let codes = {}, roundNames = {};
  const flags = {};   // round -> ISO country code, for the flag above each round label in charts
  function setCodes(data) {
    codes = {}; roundNames = {};
    const used = new Set();
    for (const r of data.rounds) {
      const name = String(r.name || '').toLowerCase();
      let c = (RACE_CODES.find(([k]) => name.includes(k)) || [])[1] || String(r.name || `R${r.round}`).replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase();
      if (used.has(c)) c = c.slice(0, 2) + (r.round % 10);   // a second race in one country that year
      used.add(c); codes[r.round] = c; roundNames[r.round] = r.name;
      const cc = window.grandPrixCountryCode?.({name: r.name, country: r.country}); if (/^[A-Z]{2}$/.test(cc || '')) flags[r.round] = cc.toLowerCase();
    }
  }
  const code = n => codes[n] || `R${n}`;
  const roundTip = n => `${code(n)} · ${roundNames[n] || `Round ${n}`}`;

  // ---------- one hover card for every chart ----------
  // Marks carry data-tip ("title line\nother lines"); the card follows the pointer inside the season page.
  let tipCard = null;
  function hideChartTip() { if (tipCard) tipCard.hidden = true; }
  // Chart marks with a value card: one tab stop per plot, each mark named by its card. Sections that fill in after the page
  // (Head-to-head's pace) run this again on what they add.
  function markTips(root) {
    for (const mark of root.querySelectorAll('[data-tip]')) {
      const plot = mark.closest('svg,.season-dist');
      mark.setAttribute('tabindex', mark === plot.querySelector('[data-tip]') ? '0' : '-1');
      mark.setAttribute('role', 'img');
      mark.setAttribute('aria-label', mark.dataset.tip.replaceAll('\n', ', '));
      plot.setAttribute('role', 'group');
    }
  }
  function bindTips(scope) {
    if (scope.dataset.tips) return;
    scope.dataset.tips = '1';
    const showTip = (mark, x, y) => {
      if (!mark) { hideChartTip(); return; }
      if (!tipCard) {
        tipCard = el('div', 'season-tip'); tipCard.setAttribute('role', 'tooltip'); document.body.append(tipCard);
        tipCard.addEventListener('pointerleave', hideChartTip);
      }
      const [head, ...rest] = mark.dataset.tip.split('\n');
      tipCard.replaceChildren(el('b', null, head), ...rest.map(line => el('span', null, line)));
      tipCard.hidden = false;
      const w = tipCard.offsetWidth, h = tipCard.offsetHeight;
      tipCard.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, x + 14))}px`;
      tipCard.style.top = `${Math.max(8, Math.min(innerHeight - h - 8, y - h - 12))}px`;
    };
    scope.addEventListener('pointermove', event => {
      let mark = event.target.closest?.('[data-tip]');
      const chart = !mark && event.target.closest?.('svg.season-chart');
      // Lines and markers can sit over a round's transparent hit region. The value must remain available there too.
      if (chart) mark = [...chart.querySelectorAll('[data-tip]')].find(node => {
        const box = node.getBoundingClientRect();
        return event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
      });
      showTip(mark, event.clientX, event.clientY);
    });
    scope.addEventListener('focusin', event => {
      const mark = event.target.closest?.('[data-tip]');
      if (!mark) { hideChartTip(); return; }
      const box = mark.getBoundingClientRect(); showTip(mark, box.left + box.width / 2, box.top);
    });
    scope.addEventListener('focusout', hideChartTip);
    scope.addEventListener('keydown', event => {
      const mark = event.target.closest?.('[data-tip]');
      if (!mark || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const marks = [...mark.closest('svg,.season-dist').querySelectorAll('[data-tip]')], index = marks.indexOf(mark);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? marks.length - 1 : Math.max(0, Math.min(marks.length - 1, index + (event.key === 'ArrowRight' ? 1 : -1)));
      event.preventDefault(); marks.forEach((node, i) => node.setAttribute('tabindex', i === next ? '0' : '-1')); marks[next].focus();
    });
    scope.addEventListener('pointerleave', event => { if (!tipCard?.contains(event.relatedTarget)) hideChartTip(); });
    document.addEventListener('keydown', event => { if (event.key === 'Escape') hideChartTip(); });
  }

  // ---------- SVG charts (numbers only go into markup; labels are escaped) ----------
  // Round labels along the bottom: every code when there is room for it, else every other one.
  // Every round is labelled; when the chart is drawn narrow (svg-scale.js measures the real spacing) every other label hides,
  // always keeping the last, and the one before it gives way so the two never touch.
  const xLabels = (rounds, xOf, H) => rounds.map((r, i) => {
    const alt = i !== rounds.length - 1 && (i % 2 === 1 || i === rounds.length - 2);
    // The race's flag above its code, at real size (season.css .x-flag); the code alone when there is no flag.
    const f = flags[r] ? `<image class="x-flag${alt ? ' is-alt' : ''}" href="assets/flags/${flags[r]}.svg" x="${xOf(i).toFixed(1)}" y="${H - 6}" width="16" height="12" preserveAspectRatio="xMidYMid slice" aria-hidden="true"/>` : '';
    return `${f}<text class="axis x-label${alt ? ' is-alt' : ''}" x="${xOf(i).toFixed(1)}" y="${H - 6}" text-anchor="middle">${esc(code(r))}</text>`;
  }).join('');
  // A bar rounded only at its outer end (top for positive values, bottom for negative).
  function barPath(x, y0, y1, w, r = 2) {
    const h = Math.abs(y1 - y0); r = Math.min(r, w / 2, h);
    if (y1 <= y0) return `M${x} ${y0}V${y1 + r}Q${x} ${y1} ${x + r} ${y1}H${x + w - r}Q${x + w} ${y1} ${x + w} ${y1 + r}V${y0}Z`;
    return `M${x} ${y0}V${y1 - r}Q${x} ${y1} ${x + r} ${y1}H${x + w - r}Q${x + w} ${y1} ${x + w} ${y1 - r}V${y0}Z`;
  }
  // Straight segments between points (Linear's charts draw no curves): values and positions alike.
  const linePath = points => points.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');
  const monotone = linePath, bumpPath = linePath;

  // One bar per round, up for positive values; `extra` stacks a second, lighter value on top (sprint points).
  function barChart(rounds, raw, {width = 640, height = 190, colour = () => 'var(--ui-accent, #5e6ad2)', format = v => String(v), tips = [], title = '', extra = null, clip = false} = {}) {
    const W = width, H = height, R = 8, T = 12, B = 48;   // B: round code with its flag above
    const sizes = raw.filter(Number.isFinite).map(Math.abs).sort((x, y) => y - x);
    const limit = clip && sizes.length > 2 && sizes[0] > 2 * sizes[1] ? sizes[1] * 1.3 : Infinity;
    const values = raw.map(v => (Number.isFinite(v) ? Math.max(-limit, Math.min(limit, v)) : v));
    const totals = values.map((v, i) => (Number.isFinite(v) ? v + (extra?.[i] || 0) : null));
    const finite = totals.filter(Number.isFinite).concat(values.filter(Number.isFinite));
    const ticks = niceTicks(Math.min(0, ...finite), Math.max(0, ...finite), 4);
    const top = Math.max(0, ...finite, ticks.at(-1) ?? 0), bottom = Math.min(0, ...finite, ticks[0] ?? 0);
    const L = axisRoom(ticks.map(format));
    const y = v => T + (top - v) / ((top - bottom) || 1) * (H - T - B);
    const n = Math.max(1, rounds.length), bw = (W - L - R) / n, mid = i => L + i * bw + bw / 2;
    let svg = `<svg class="season-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">`;
    for (const t of ticks) svg += `<line class="grid${t === 0 ? ' is-zero' : ''}" x1="${L}" x2="${W - R}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"/><text class="axis" x="${L - 8}" y="${(y(t) + 3.5).toFixed(1)}" text-anchor="end">${esc(format(t))}</text>`;
    values.forEach((v, i) => {
      if (!Number.isFinite(v)) return;
      const w = Math.min(bw * .62, 28), x = mid(i) - w / 2, y0 = y(0), y1 = y(v), clipped = Math.abs(raw[i]) > limit;
      const tip = `${tips[i] || roundTip(rounds[i])}\n${format(raw[i])}${extra?.[i] ? ` + ${format(extra[i])} sprint` : ''}${clipped ? '\nBar cut short: an outlier' : ''}`;
      svg += `<rect class="hit" x="${(L + i * bw).toFixed(1)}" y="${T}" width="${bw.toFixed(1)}" height="${H - T - B}" data-tip="${esc(tip)}"/>`;
      if (extra?.[i]) {
        const y2 = y(v + extra[i]);
        svg += `<path class="bar" d="${barPath(x, y0, y1, w, 0)}" style="fill:${esc(colour(v, i))}"/><path class="bar is-extra" d="${barPath(x, y1, y2, w)}" style="fill:${esc(colour(v, i))}"/>`;
      } else svg += `<path class="bar${clipped ? ' is-clipped' : ''}" d="${barPath(x, y0, y1, w)}" style="fill:${esc(colour(v, i))}"/>`;
      if (clipped) svg += `<path class="clip-mark" d="M${x.toFixed(1)} ${(y1 + (v < 0 ? -4 : 4)).toFixed(1)}l${(w / 2).toFixed(1)} ${v < 0 ? 4 : -4}l${(w / 2).toFixed(1)} ${v < 0 ? -4 : 4}"/>`;
    });
    return htmlNode(svg + xLabels(rounds, mid, H, bw) + '</svg>');
  }
  // Grid slot to finishing position for each round: a hollow dot where the car started, a filled one where it finished.
  function gridFinishChart(rounds, rows, colour) {
    const W = 640, H = 236, L = 36, R = 8, T = 10, B = 48;
    const maxP = Math.max(20, ...rows.flatMap(r => [r.grid || 0, r.finish || 0]));
    const y = p => T + (p - 1) / (maxP - 1) * (H - T - B);
    const n = Math.max(1, rounds.length), bw = (W - L - R) / n, mid = i => L + i * bw + bw / 2;
    let svg = `<svg class="season-chart season-dumbbell" viewBox="0 0 ${W} ${H}" role="img" aria-label="Grid to finish, each round">`;
    for (const p of [1, 5, 10, 15, 20].filter(p => p <= maxP)) svg += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(p)}" y2="${y(p)}"/><text class="axis" x="${L - 8}" y="${y(p) + 3.5}" text-anchor="end">P${p}</text>`;
    rows.forEach((r, i) => {
      const x = mid(i).toFixed(1);
      svg += `<rect class="hit" x="${(L + i * bw).toFixed(1)}" y="${T}" width="${bw.toFixed(1)}" height="${H - T - B}" data-tip="${esc(`${roundTip(rounds[i])}\n${r.tip}`)}"/>`;
      if (r.grid && r.finish) {
        const cls = r.finish < r.grid ? 'is-gain' : r.finish > r.grid ? 'is-loss' : '';
        svg += `<g class="${cls}"><line class="link" x1="${x}" x2="${x}" y1="${y(r.grid)}" y2="${y(r.finish)}"/><circle class="from" cx="${x}" cy="${y(r.grid)}" r="3.5"/><circle class="to" cx="${x}" cy="${y(r.finish)}" r="4.5" style="fill:${esc(colour)}"/></g>`;
      } else if (r.grid || r.finish) {
        const at = y(r.grid || r.finish);
        svg += `<g class="is-out"><circle class="from" cx="${x}" cy="${at}" r="3.5"/><path class="cross" d="M${+x - 4} ${at + 9}l8 8m0 -8l-8 8"/></g>`;
      }
    });
    return htmlNode(svg + xLabels(rounds, mid, H, bw) + '</svg>');
  }
  // Values over the season. One series gets a soft area under it and its last value at the end; several series
  // stay plain lines (hover one to bring it forward), and the hover card lists the leaders at that round.
  // endLabels: name every series at the end of its line (spread apart so they never overlap), all in their team colours;
  // hovering any line or table row still brings it forward.
  // Updates by team and Grand Prix: the grid (count per weekend), or a chart of each team's running total, where the
  // slope is the rate of development and a flat stretch a pause.
  function updatesByRound(data, teams, items, matrix) {
    const view = () => state.updatesView === 'chart' ? cumulative() : wrap(matrix);
    const rounds = data.rounds.filter(r => r.race.length).map(r => r.round);
    const cumulative = () => {
      const series = teams.map(t => { let total = 0; return {id: t, colour: teamColour(t), label: teamName(data, t), short: teamName(data, t),
        values: rounds.map(r => (total += items.filter(i => i.team === t && i.round === r).length))}; });
      return lineChart(rounds, series, {title: 'Updates so far, by team', height: 300, endLabels: teams.length});
    };
    const toggle = el('div', 'season-segment season-zone-toggle'); toggle.setAttribute('role', 'group'); toggle.setAttribute('aria-label', 'Show updates as');
    let body = view();
    const note = el('p', 'season-footnote');
    const say = () => { note.textContent = state.updatesView === 'chart' ? 'Each team’s running total of declared updates; a steeper line is a faster rate of development.' : 'Updates declared at each Grand Prix; deeper colour means more. Empty boxes are the rounds still to run.'; };
    for (const [id, label] of [['grid', 'Grid'], ['chart', 'Running total']]) {
      const b = el('button', null, label); b.type = 'button'; b.dataset.mode = id; b.setAttribute('aria-pressed', String((state.updatesView || 'grid') === id));
      b.addEventListener('click', () => {
        if ((state.updatesView || 'grid') === id) return;
        state.updatesView = id;
        toggle.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.mode === id)));
        const next = view(); body.replaceWith(next); body = next; say();
      });
      toggle.append(b);
    }
    say();
    return card('Updates by team and Grand Prix', toggle, body, note);
  }
  function lineChart(rounds, series, {title = '', invert = false, height = 260, min = null, max = null, format = v => String(v), endLabels = 0} = {}) {
    // Every series is drawn in its team colour and named at its end (teammates dashed); with many series the chart grows so
    // the names, 13 px apart, never collide, and the points shrink so the lines stay readable.
    const named = endLabels && series.length > 1, dense = series.length > 8;
    const W = 640, H = named ? Math.max(height, series.length * 19 + 60) : height, R = series.length === 1 ? 44 : named ? 52 : 12, T = 12, B = 48;
    const dashed = teammateDashes(series);
    const values = series.flatMap(s => s.values.filter(v => v != null));
    // Values (not positions) get round outer ticks that enclose the data; the scale then runs to those ticks.
    const dataLo = min ?? Math.min(0, ...values), dataHi = max ?? Math.max(1, ...values);
    const ticks = niceTicks(dataLo, dataHi, invert ? Math.min(5, dataHi - dataLo) : 4, {outward: !invert && min == null && max == null});
    const lo = Math.min(dataLo, ticks[0] ?? dataLo), hi = Math.max(dataHi, ticks.at(-1) ?? dataHi);
    const L = axisRoom(ticks.map(t => (invert ? 'P' + t : format(t))));
    const x = i => L + (rounds.length < 2 ? 0 : i / (rounds.length - 1) * (W - L - R));
    const y = v => invert ? T + (v - lo) / ((hi - lo) || 1) * (H - T - B) : H - B - (v - lo) / ((hi - lo) || 1) * (H - T - B);
    const gid = `g${Math.random().toString(36).slice(2, 8)}`;
    let svg = `<svg class="season-chart${dense ? ' is-dense' : ''}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">`;
    for (const t of ticks) svg += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"/><text class="axis" x="${L - 8}" y="${(y(t) + 3.5).toFixed(1)}" text-anchor="end">${esc(invert ? 'P' + t : format(t))}</text>`;
    const slot = rounds.length > 1 ? (W - L - R) / (rounds.length - 1) : 40;
    rounds.forEach((r, i) => {
      const at = series.map(s => [s, s.values[i]]).filter(([, v]) => v != null).sort((p, q) => (invert ? p[1] - q[1] : q[1] - p[1]));
      const lines = at.slice(0, 5).map(([s, v]) => `${s.label}  ${invert ? 'P' + v : format(v)}`).join('\n');
      svg += `<rect class="hit" x="${(x(i) - slot / 2).toFixed(1)}" y="${T}" width="${slot.toFixed(1)}" height="${H - T - B}" data-tip="${esc(`${roundTip(r)}\n${lines}`)}"/>`;
    });
    for (const s of [...series].reverse()) {
      const pts = s.values.map((v, i) => (v == null ? null : [x(i), y(v)])).filter(Boolean);
      if (!pts.length) continue;
      const d = monotone(pts);
      if (series.length === 1 && !invert) {
        svg += `<defs><linearGradient id="${gid}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${esc(s.colour)}" stop-opacity=".28"/><stop offset="1" stop-color="${esc(s.colour)}" stop-opacity="0"/></linearGradient></defs>`;
        svg += `<path class="area" d="${d}L${pts.at(-1)[0].toFixed(1)} ${H - B}L${pts[0][0].toFixed(1)} ${H - B}Z" fill="url(#${gid})"/>`;
      }
      svg += `<path data-id="${esc(s.id)}" class="line${dashed.has(s) ? ' is-dashed' : ''}" style="stroke:${esc(s.colour)}" d="${d}"/>`;
      // A dot on every round of every series, as Car performance's trend chart.
      if (series.length > 1) svg += `<g class="pts${dashed.has(s) ? ' is-hollow' : ''}" data-id="${esc(s.id)}" style="--c:${esc(s.colour)}">${pts.map(([px, py]) => `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}"/>`).join('')}</g>`;
      if (series.length === 1) {
        const [ex, ey] = pts.at(-1), last = s.values.filter(v => v != null).at(-1);
        svg += `<circle class="end" cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="3" style="fill:${esc(s.colour)}"/><text class="label is-value" x="${(ex + 8).toFixed(1)}" y="${(ey + 3.5).toFixed(1)}">${esc(invert ? 'P' + last : format(last))}</text>`;
      }
    }
    if (named) {
      const ends = series.map(s => {
        const i = s.values.findLastIndex(v => v != null);
        return i < 0 ? null : {id: s.id, colour: s.colour, name: s.short || s.label, x: x(i), y: y(s.values[i])};
      }).filter(Boolean);
      svg += endKey(ends, W - R + 4, dense ? 19 : 14, H - B);   // 19 units: about 14 px apart at a half-width desktop card
    }
    const chart = htmlNode(svg + xLabels(rounds, x, H, slot) + '</svg>');
    if (!(named && dense)) return chart;
    // Phones draw this chart at half size, too small for every name at the line ends: a key of all of them follows instead
    // (season.css shows one or the other by width), teammates marked as on the lines.
    const wrap = el('div', 'season-chart-keyed'), key = el('div', 'season-legend season-chart-key');
    for (const s of series) { const k = el('span', dashed.has(s) ? 'is-dashed' : null, s.short || s.label); k.dataset.tone = 'custom'; k.style.setProperty('--tone', s.colour); k.dataset.id = s.id; key.append(k); }
    wrap.append(chart, key);
    return wrap;
  }
  // End labels (docs/linear-components.md, Chart): the series name in its colour beside the line's last point, at least
  // 14 px apart so names never overlap. entries: [{id, colour, name, x, y, value}].
  // bottom: the lowest a name may sit; names pushed past it move back up, so a cluster of lines ending together (many
  // drivers near zero points) stacks upward inside the chart. A name moved off its line's end gets a hairline leader.
  function endKey(entries, labelX, gap = 14, bottom = Infinity) {
    const list = [...entries].sort((a, b) => a.y - b.y);
    list.forEach((e, i) => { e.ly = i ? Math.max(e.y, list[i - 1].ly + gap) : e.y; });
    for (let i = list.length - 1; i >= 0; i--) list[i].ly = Math.min(list[i].ly, i === list.length - 1 ? bottom : list[i + 1].ly - gap);
    return list.map(e => {
      const leader = Math.abs(e.ly - e.y) > 3 && e.x != null
        ? `<path class="end-leader" d="M${(e.x + 4).toFixed(1)} ${e.y.toFixed(1)}L${(labelX - 2).toFixed(1)} ${e.y.toFixed(1)}L${(labelX + 2).toFixed(1)} ${e.ly.toFixed(1)}" style="stroke:${esc(e.colour)}"/>` : '';
      return `<g class="end-key" data-id="${esc(e.id)}">${leader}<text class="label" style="fill:${esc(e.colour)}" x="${(labelX + 4).toFixed(1)}" y="${(e.ly + 3.5).toFixed(1)}">${esc(e.name)}${e.value != null ? `<tspan class="key-value" dx="5">${esc(e.value)}</tspan>` : ''}</text></g>`;
    }).join('');
  }
  // Teammates share a team colour: the second series of a colour is dashed, so the two can be told apart.
  function teammateDashes(series) {
    const seen = new Set(), out = new Set();
    for (const s of series) { if (seen.has(s.colour)) out.add(s); seen.add(s.colour); }
    return out;
  }
  function bumpChart(rounds, series) {
    const n = series.length, W = 640, H = Math.max(224, n * 18 + 54), L = 30, R = 52, T = 10, B = 46;
    const dashed = teammateDashes(series);
    const x = i => L + (rounds.length < 2 ? 0 : i / (rounds.length - 1) * (W - L - R));
    const y = p => T + (p - 1) / Math.max(1, n - 1) * (H - T - B);
    const slot = rounds.length > 1 ? (W - L - R) / (rounds.length - 1) : 40;
    let svg = `<svg class="season-chart${n > 8 ? ' is-dense' : ''}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Championship position after each round">`;
    rounds.forEach((r, i) => {
      const order = series.map(s => [s, s.values[i]]).filter(([, v]) => v != null).sort((p, q) => p[1] - q[1]).slice(0, 5).map(([s, v]) => `P${v}  ${s.label}`).join('\n');
      svg += `<rect class="hit" x="${(x(i) - slot / 2).toFixed(1)}" y="${T}" width="${slot.toFixed(1)}" height="${H - T - B}" data-tip="${esc(`${roundTip(r)}\n${order}`)}"/>`;
    });
    // Hairline rows with the position on the left (P1, P5, P10, ...), as the other charts' value axes.
    for (const p of [1, 5, 10, 15, 20].filter(p => p <= n)) svg += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(p).toFixed(1)}" y2="${y(p).toFixed(1)}"/><text class="axis" x="${L - 8}" y="${(y(p) + 3.5).toFixed(1)}" text-anchor="end">P${p}</text>`;
    for (const s of [...series].reverse()) {
      const pts = s.values.map((v, i) => (v == null ? null : [x(i), y(v)])).filter(Boolean);
      if (!pts.length) continue;
      const lastValue = s.values.at(-1);
      // Every driver in their team colour (the second of a team dashed); hovering one still lifts it above the rest.
      svg += `<g data-id="${esc(s.id)}"><path class="line is-bump${dashed.has(s) ? ' is-dashed' : ''}" style="stroke:${esc(s.colour)}" d="${bumpPath(pts)}"/>`;
      svg += `<g class="pts${dashed.has(s) ? ' is-hollow' : ''}" style="--c:${esc(s.colour)}">${pts.map(([px, py]) => `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}"/>`).join('')}</g>`;
      if (lastValue != null) svg += endKey([{id: s.id, colour: s.colour, name: s.label, x: pts.at(-1)[0], y: pts.at(-1)[1]}], W - R + 4);
      svg += '</g>';
    }
    return htmlNode(svg + xLabels(rounds, x, H, slot) + '</svg>');
  }
  // Round ticks for a value range. Outward (the default): the first tick is at or below the smallest value and the last at or
  // above the largest, so the labelled range always encloses the data and nothing runs past the outer gridlines. Inward
  // keeps every tick inside the range (positions: there is no P0).
  function niceTicks(lo, hi, count, {outward = true} = {}) {
    const span = hi - lo || 1, raw = span / Math.max(1, count), mag = 10 ** Math.floor(Math.log10(raw)), step = [1, 2, 2.5, 5, 10].find(m => m * mag >= raw - 1e-12) * mag;
    const first = (outward ? Math.floor(lo / step + 1e-9) : Math.ceil(lo / step - 1e-9)) * step;
    const last = (outward ? Math.ceil(hi / step - 1e-9) : Math.floor(hi / step + 1e-9)) * step;
    const out = []; for (let v = first; v <= last + step * 1e-6; v += step) out.push(Math.round(v * 1e6) / 1e6);
    return out;
  }
  // Room left of the plot for the longest axis label (about 6.2 px a character at the axis size, plus the gap).
  const axisRoom = labels => Math.max(36, Math.ceil(Math.max(...labels.map(t => String(t).length)) * 6.2 + 12));
  function htmlNode(markup) { const t = document.createElement('template'); t.innerHTML = markup; return t.content.firstElementChild; }

  // ----- form: pace over the season and recent results -----
  // Race pace per driver and round comes from the race analysis Car performance publishes (/api/performance, session R):
  // each driver's estimated clean-air pace as a % gap. Rounds are matched by number through /api/events, whose names
  // are the ones that analysis uses ("São Paulo Grand Prix" where the classification says "Brazilian").
  const formCache = {};
  function loadForm(year, data) {
    if (formCache[year]) return formCache[year];
    const request = typeof window.apexDataRequest === 'function' ? window.apexDataRequest : null;
    if (!request) return Promise.resolve({race: {}, failed: 0});
    formCache[year] = (async () => {
      const events = await seasonEvents(year);
      const done = data.rounds.filter(r => r.race?.length), byCode = {};
      for (const [id, d] of Object.entries(data.drivers)) if (d.code) byCode[d.code] = id;
      const race = {}, speed = {};
      let failed = 0;
      const jobs = done.map(r => async () => {
        const event = (Array.isArray(events) ? events : []).find(e => e.round === r.round);
        if (!event) { failed++; return; }
        try {
          const result = await request('/api/performance?' + new URLSearchParams({year, gp: event.name, session: 'R'}));
          const rows = (result?.teams || []).flatMap(t => t.race_drivers || []).filter(x => Number.isFinite(x.pace) && byCode[x.driver]);
          if (!rows.length) { failed++; return; }
          const best = Math.min(...rows.map(x => x.pace));
          race[r.round] = Object.fromEntries(rows.map(x => [byCode[x.driver], x.pace - best]));
          speed[r.round] = Object.fromEntries((result?.teams || []).flatMap(t => t.race_speed_drivers || [])
            .filter(x => Number.isFinite(x.race_speed_trap_median) && byCode[x.driver]).map(x => [byCode[x.driver], x.race_speed_trap_median]));
        } catch { failed++; }
      });
      const queue = [...jobs];
      await Promise.all(Array.from({length: 4}, async () => { while (queue.length) await queue.shift()(); }));
      return {race, speed, failed};
    })();
    formCache[year].catch(() => { delete formCache[year]; });
    return formCache[year];
  }
  // Each driver's best qualifying lap (any part) as a % gap to pole, per round. Laps over 107% of pole (the sport's own line
  // for an unrepresentative lap: a wet Q1, a car stopped) are left out.
  function qualiGapsByRound(done) {
    const quali = {};
    for (const r of done) {
      const best = r.qualifying.map(q => [q.driver, Math.min(...[q.q1, q.q2, q.q3].filter(Number.isFinite))]).filter(([, t]) => Number.isFinite(t));
      if (!best.length) continue;
      const pole = Math.min(...best.map(([, t]) => t));
      quali[r.round] = Object.fromEntries(best.filter(([, t]) => t <= pole * 1.07).map(([d, t]) => [d, (t / pole - 1) * 100]));
    }
    return quali;
  }
  const poleSeconds = r => Math.min(...r.qualifying.flatMap(q => [q.q1, q.q2, q.q3]).filter(Number.isFinite));
  // Recent rounds weigh more: each earlier round counts 0.7 of the one after it (the latest weighs 1, the one before 0.7…).
  const ROLLING_DECAY = 0.7;
  function rolling(points) {
    let num = 0, den = 0;
    points.forEach(([, v], i) => { const w = ROLLING_DECAY ** (points.length - 1 - i); num += w * v; den += w; });
    return den ? num / den : null;
  }
  // A tiny line of a driver's gap at each round (lower is quicker), the latest point marked.
  function sparkline(values, colour) {
    const w = 64, h = 18, hi = Math.max(...values, 0.2);
    const xy = values.map((v, k) => [values.length < 2 ? w / 2 : k / (values.length - 1) * w, 2 + v / hi * (h - 4)]);
    return htmlNode(`<svg class="season-spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">`
      + `<path d="${xy.map(([x, y], k) => `${k ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('')}" style="stroke:${esc(colour)}"/>`
      + `<circle cx="${xy.at(-1)[0].toFixed(1)}" cy="${xy.at(-1)[1].toFixed(1)}" r="2" style="fill:${esc(colour)}"/></svg>`);
  }
  function renderForm(data, form) {
    const done = data.rounds.filter(r => r.race?.length);
    if (!done.length) return [empty('Form needs a finished race.')];
    // Seconds on that weekend's pole lap, so a gap reads as time per lap whatever the circuit (the % is in the tooltip).
    const poleTime = Object.fromEntries(done.map(r => [r.round, Math.min(...r.qualifying.flatMap(q => [q.q1, q.q2, q.q3]).filter(Number.isFinite))]));
    const quali = qualiGapsByRound(done);
    const paceTable = (title, perRound, note) => {
      const ids = Object.keys(data.drivers), rounds = done.map(r => r.round).filter(n => perRound[n]);
      const series = id => rounds.filter(n => Number.isFinite(perRound[n][id])).map(n => [n, perRound[n][id]]);
      const toSeconds = ([n, pct]) => [n, pct / 100 * (Number.isFinite(poleTime[n]) ? poleTime[n] : 90)];
      const rankBy = upTo => ids.map(id => [id, rolling(series(id).filter(([n]) => n <= upTo).map(toSeconds))])
        .filter(([, v]) => v != null).sort((a, b) => a[1] - b[1]).map(([id]) => id);
      const last = rounds.at(-1), prev = rounds.at(-2);
      const now = rankBy(last), before = prev ? rankBy(prev) : [];
      const rows = now.map(id => {
        const pts = series(id), secs = pts.map(toSeconds);
        return {id, roll: rolling(secs), season: secs.reduce((a, [, v]) => a + v, 0) / secs.length, pct: rolling(pts), n: pts.length, secs,
          move: before.includes(id) ? before.indexOf(id) - now.indexOf(id) : 0};
      }).filter(r => r.n >= 2);
      if (!rows.length) return null;
      // Gaps read from the best: the quickest rolling (and season) figure is 0, as a ranking reads; the averaged gap to each
      // race's quickest driver is kept in the tooltip.
      const bestRoll = Math.min(...rows.map(r => r.roll)), bestSeason = Math.min(...rows.map(r => r.season));
      for (const r of rows) { r.raw = r.roll; r.roll -= bestRoll; r.season -= bestSeason; }
      const worst = Math.max(...rows.map(r => r.roll), 0.001);
      const tbl = el('table', 'season-table season-form');
      const head = el('tr');
      head.append(el('th', 'num', '#'), el('th', null, 'Driver'), el('th', null, 'Rolling, s'), el('th', 'num', 'Season'), el('th', null, 'Trend'), el('th', 'num', 'Move'));
      head.children[3].title = 'Plain average over the season, seconds per lap';
      const thead = el('thead'); thead.append(head); tbl.append(thead);
      const tb = el('tbody');
      rows.forEach((r, i) => {
        const tr = el('tr'), colour = teamColour(data.drivers[r.id]?.team);
        const bar = el('span', 'season-form-bar'); bar.style.setProperty('--w-n', (r.roll / worst).toFixed(3)); bar.style.setProperty('--team', colour);
        const cell = el('td', 'season-form-pace'); cell.title = `On average +${r.raw.toFixed(3)} s (+${r.pct.toFixed(2)}%) to each round’s quickest, weighted to recent rounds (${r.n} rounds)`;
        cell.append(el('b', null, r.roll < 0.0005 ? 'quickest' : `+${r.roll.toFixed(3)}`), bar);
        const trend = el('td', 'season-form-trend'); trend.append(sparkline(r.secs.map(([, v]) => v), colour));
        trend.title = r.secs.map(([n, v]) => `${code(n)} ${v < 0.0005 ? '0.000' : '+' + v.toFixed(3)} s`).join('\n');
        const move = el('td', `num season-form-move${r.move > 0 ? ' is-up' : r.move < 0 ? ' is-down' : ''}`, r.move > 0 ? `▲${r.move}` : r.move < 0 ? `▼${-r.move}` : '–');
        const name = el('td'); name.append(who(data, r.id, {team: false}));
        tr.append(el('td', 'num season-muted', String(i + 1)), name, cell, el('td', 'num', r.season < 0.0005 ? 'quickest' : `+${r.season.toFixed(3)}`), trend, move);
        tb.append(tr);
      });
      tbl.append(tb);
      return card(title, wrap(tbl), el('p', 'season-footnote', note));
    };
    const racePace = form && Object.keys(form.race).length
      ? paceTable('Race pace', form.race, `Each driver’s clean-air race pace (Car performance’s race analysis) as a gap to the quickest driver in that race, in seconds on that weekend’s pole lap. Rolling pace weighs recent races more (each earlier race counts ${ROLLING_DECAY} of the next); Season is the plain average; both read from the quickest driver on that measure. Move: places gained or lost since the previous race.${form.failed ? ` ${form.failed} race${form.failed === 1 ? ' is' : 's are'} not analysed yet and not counted.` : ''}`)
      : card('Race pace', empty('The race pace analysis is not available here yet.'));
    const qualiPace = paceTable('Qualifying pace', quali, 'Each driver’s best qualifying lap (any part) as a gap to pole, in seconds; laps over 107% of pole (a wet session, a car that stopped) are left out. Rolling and Season as for race pace.')
      || card('Qualifying pace', empty('No qualifying times yet.'));
    // Recent form: the last five races' finishing places in the colours of the Standings grid.
    const lastFive = done.slice(-5), ids = Object.keys(data.drivers).filter(id => lastFive.some(r => r.race.some(x => x.driver === id)));
    const formRows = ids.map(id => {
      const res = lastFive.map(r => r.race.find(x => x.driver === id));
      const finishes = res.filter(x => x?.position).map(x => x.position);
      return {id, res, avg: finishes.length ? finishes.reduce((a, b) => a + b, 0) / finishes.length : null, points: res.reduce((a, x) => a + (x?.points || 0), 0)};
    }).sort((a, b) => b.points - a.points || (a.avg ?? 99) - (b.avg ?? 99));
    const ft = el('table', 'season-table season-matrix season-grid season-form-recent');
    const head = el('tr'); head.append(el('th', null, 'Driver'));
    for (const r of lastFive) { const th = el('th', 'num'); th.append(roundMark(r)); head.append(th); }
    head.append(el('th', 'num', 'Average'), el('th', 'num', 'Points'));
    const thead = el('thead'); thead.append(head); ft.append(thead);
    const fb = el('tbody');
    for (const row of formRows) {
      const tr = el('tr'), name = el('th'); name.scope = 'row'; name.append(who(data, row.id, {code: true, team: false})); tr.append(name);
      row.res.forEach((x, k) => {
        const n = x?.position, td = el('td', 'num', !x ? '' : n ? String(n) : (x.status === 'Did not start' ? 'DNS' : 'DNF'));
        td.dataset.tone = !x ? 'none' : !n ? 'out' : n === 1 ? 'win' : n <= 3 ? 'podium' : x.points > 0 ? 'points' : 'none';
        td.title = `${lastFive[k].name}: ${!x ? 'did not race' : n ? 'P' + n : x.status}`;
        tr.append(td);
      });
      tr.append(el('td', 'num season-strong', row.avg != null ? `P${row.avg.toFixed(1)}` : '—'), el('td', 'num', String(row.points)));
      fb.append(tr);
    }
    ft.append(fb);
    const recent = card('Recent form · last 5 races', wrap(ft),
      el('p', 'season-footnote', 'Finishing places in the last five races, ordered by the points scored in them; the average counts classified finishes only.'));
    const two = el('div', 'season-two'); two.append(racePace, qualiPace);
    return [two, recent];
  }

  // ----- driver stats -----
  function driverPicker(data, current, onPick, label = 'Driver') {
    const select = el('select'); select.setAttribute('aria-label', label);
    const order = data.standings.drivers.at(-1)?.table.map(e => e.id) || Object.keys(data.drivers);
    for (const id of [...order, ...Object.keys(data.drivers).filter(id => !order.includes(id))]) select.append(new Option(`${driverName(data, id)} · ${teamName(data, data.drivers[id]?.team)}`, id));
    select.value = current;
    select.addEventListener('change', () => onPick(select.value));
    const shell = el('div', 'select-shell season-select'); shell.append(select);
    return shell;
  }
  function renderDrivers(data) {
    const order = data.standings.drivers.at(-1)?.table.map(e => e.id) || Object.keys(data.drivers);
    if (!state.driver || !data.drivers[state.driver]) state.driver = order[0];
    const id = state.driver, s = data.driver_stats[id];
    if (!s) return [empty('No races yet this season.')];
    const pick = driverPicker(data, id, value => { state.driver = value; window.ApexUrl?.write('season', urlParams()); paint(() => renderDrivers(data)); });
    const standing = data.standings.drivers.at(-1)?.table.find(e => e.id === id);
    const table = data.standings.drivers.at(-1)?.table || [];
    const ahead = standing && table[standing.position - 2], behind = standing && table[standing.position];
    const mate = data.teammates.find(p => (p.a === id || p.b === id));
    const mateId = mate && (mate.a === id ? mate.b : mate.a);
    const team = data.drivers[id]?.team, driver = data.drivers[id];
    const head = el('section', 'season-card season-driver-head');
    head.style.setProperty('--team', teamColour(team));
    const hero = el('div', 'season-hero');
    const portrait = el('div', 'season-hero-portrait'); portrait.append(avatar(data, id, 'lg'));
    const ident = el('div', 'season-hero-id');
    if (driver?.number) ident.append(el('span', 'season-hero-number', driver.number));
    ident.append(el('h2', null, driverName(data, id)), teamTag(data, team));
    const credit = photoCredit(id); if (credit) ident.append(credit);
    const side = el('div', 'season-driver-pos');
    side.append(el('b', 'season-big', standing ? `P${standing.position}` : '—'), el('span', 'season-muted', standing ? `${standing.points} points` : ''));
    hero.append(portrait, ident, side);
    head.append(hero);
    const facts = el('div', 'season-facts');
    const fact = (label, value, note) => { const f = el('div'); f.append(el('span', 'season-muted', label), el('b', null, value)); if (note) f.append(el('small', 'season-muted', note)); facts.append(f); };
    if (ahead) fact('To the car ahead', `−${(ahead.points - standing.points).toFixed(0)} pts`, driverName(data, ahead.id));
    else if (behind) fact('Lead', `+${(standing.points - behind.points).toFixed(0)} pts`, `over ${driverName(data, behind.id)}`);
    if (s.team_share != null) fact('Share of team points', `${(s.team_share * 100).toFixed(1)}%`, teamName(data, data.drivers[id].team));
    if (mateId) {
      const ms = data.driver_stats[mateId];
      fact('Against teammate', `${s.points - ms.points >= 0 ? '+' : '−'}${Math.abs(s.points - ms.points).toFixed(0)} pts`, driverName(data, mateId));
    }
    head.append(facts);
    const tiles = el('div', 'season-tiles');
    const tile = (label, value, note) => { const t = el('div', 'season-tile'); t.append(el('span', 'season-muted', label), el('b', null, value ?? '—')); if (note) t.append(el('small', 'season-muted', note)); tiles.append(t); };
    tile('Wins', String(s.wins), s.sprint_wins ? `+${s.sprint_wins} sprint` : null);
    tile('Podiums', String(s.podiums));
    tile('Poles', String(s.poles), `${s.front_rows} front rows`);
    tile('Points finishes', `${s.points_finishes}/${s.starts}`);
    tile('Q3 appearances', `${s.q3}/${s.starts}`);
    tile('Average finish', s.average_finish != null ? s.average_finish.toFixed(2) : '—', 'classified races');
    if (s.average_result != null) tile('Average result', s.average_result.toFixed(2), 'a retirement counts as last');
    if (s.finish_rate != null) tile('Finish rate', `${Math.round(s.finish_rate * 100)}%`, `${s.starts - s.retirements} of ${s.starts} starts`);
    tile('Average grid', s.average_grid != null ? s.average_grid.toFixed(2) : '—');
    tile('Best qualifying', s.best_qualifying ? `P${s.best_qualifying}` : '—');
    tile('Retirements', String(s.retirements), s.mechanical_retirements ? `${s.mechanical_retirements} car failure${s.mechanical_retirements === 1 ? '' : 's'}` : null);
    tile('Sprint points', String(s.sprint_points));
    // Full rows: the column count (at most 6, at least 4) that leaves the fewest empty cells for this driver's tiles.
    const n = tiles.childElementCount, cols = [6, 5, 4].reduce((best, c) => ((c - n % c) % c < (best - n % best) % best ? c : best), 6);
    tiles.style.setProperty('--tile-cols', String(cols));
    // Weekend strip: each round's finish (F1 colours: purple win, green podium, white points, grey no points, red retirement).
    const strip = el('div', 'season-strip');
    for (const r of s.by_round) {
      const finish = r.finish, n = Number(finish), cell = el('div', 'season-strip-cell');
      cell.dataset.tone = !Number.isFinite(n) ? (finish ? 'out' : 'none') : n === 1 ? 'win' : n <= 3 ? 'podium' : r.race_points > 0 ? 'points' : 'none';
      cell.title = `${data.rounds.find(x => x.round === r.round)?.name}: ${finish ? (Number.isFinite(n) ? 'P' + n : finish) : 'did not start'}${r.grid ? ' from P' + r.grid : ''}${r.race_points ? ' · ' + r.race_points + ' pts' : ''}`;
      // Flag and round code, the finishing place, and under it the classification when the race did not end in a place
      // (no colours: the number says the result).
      const round = data.rounds.find(x => x.round === r.round), head = el('small'), f = round && flag(round);
      if (f) head.append(f);
      head.append(code(r.round));
      const CLASS = {R: 'DNF', D: 'DSQ', E: 'EXC', W: 'DNS', N: 'NC', F: 'DNQ'};
      const status = Number.isFinite(n) ? '' : finish ? (CLASS[finish] || 'DNF') : 'DNS';
      cell.append(head, el('b', null, Number.isFinite(n) ? String(n) : '–'), el('span', 'season-strip-status', status || ' '));
      strip.append(cell);
    }
    for (const r of data.rounds.filter(notRun)) {
      const cell = el('div', 'season-strip-cell is-upcoming'), head = el('small'), f = flag(r); cell.title = notRunNote(r);
      if (f) head.append(f);
      head.append(code(r.round));
      cell.append(head, el('b'), el('span', 'season-strip-status'));
      strip.append(cell);
    }
    const counts = s.finish_counts, maxCount = Math.max(1, ...Object.values(counts));
    const dist = el('div', 'season-dist'); dist.style.setProperty('--team', teamColour(data.drivers[id]?.team));
    dist.setAttribute('aria-label', 'Race finishing positions');
    for (let p = 1; p <= 22; p++) {
      const n = counts[String(p)] || 0, col = el('div', 'season-dist-col'); col.dataset.tip = `P${p}\n${n} finish${n === 1 ? '' : 'es'}`;
      const stack = el('div', 'season-dist-stack'), bar = el('i'), share = n / maxCount * 100, count = el('span', null, n ? String(n) : '');
      bar.style.height = `${share}%`; count.style.bottom = `calc(${share}% + 3px)`;
      stack.append(count, bar);
      col.append(stack, el('small', null, String(p)));
      dist.append(col);
    }
    const positions = lineChart(s.position_after.map(p => p.round), [{id, colour: teamColour(data.drivers[id].team), label: driverName(data, id),
      values: s.position_after.map(p => p.position)}], {title: 'Championship position after each round', invert: true, min: 1, max: Math.max(5, ...s.position_after.map(p => p.position || 1)), height: 200});
    const legend = el('p', 'season-footnote', 'Finishing place in each Grand Prix. DNF did not finish, DNS did not start, DSQ disqualified, NC not classified.');
    return [el('div', 'season-toolbar'), head, tiles, card('Weekend by weekend', strip, legend), el('div', 'season-two'),
    ].map((node, i) => {
      if (i === 0) node.append(pick);
      if (i === 4) node.append(card('Race finishing positions', dist, el('p', 'season-footnote', 'Classified finishes only.')), card('Championship position', positions));
      return node;
    }).concat(driverExtras(data, id, mateId));
  }
  function driverExtras(data, id, mateId) {
    const s = data.driver_stats[id], colour = teamColour(data.drivers[id]?.team);
    const rounds = s.by_round.map(r => r.round), name = n => data.rounds.find(x => x.round === n)?.name || `Round ${n}`;
    const rows = s.by_round.map(r => {
      const n = Number(r.finish);
      return {grid: r.grid || null, finish: Number.isFinite(n) ? n : null,
        tip: `${name(r.round)}: ${r.grid ? 'P' + r.grid : 'pit lane'} → ${Number.isFinite(n) ? 'P' + n : r.finish || 'did not start'}`};
    });
    const gained = rows.filter(r => r.grid && r.finish).reduce((sum, r) => sum + (r.grid - r.finish), 0);
    const legend = el('div', 'season-legend');
    legend.append(el('span', null, 'Hollow: grid'), el('span', null, 'Filled: finish'), el('span', 'is-up', 'Green: places gained'), el('span', 'is-down', 'Red: places lost'), el('span', null, `Net ${gained >= 0 ? '+' : '−'}${Math.abs(gained)} places`));
    const gridCard = card('Grid to finish', gridFinishChart(rounds, rows, colour), legend);
    let qualiCard = null;
    if (mateId) {
      const gaps = data.rounds.filter(r => r.qualifying.length).map(r => ({round: r.round, gap: qualiGap(r, id, mateId), name: r.name}));
      const values = gaps.map(g => (g.gap ? -g.gap.percent : null));
      const ahead = values.filter(v => v > 0).length, counted = values.filter(Number.isFinite).length, med = median(values);
      const chart = barChart(gaps.map(g => g.round), values, {height: 230, clip: true, colour: v => (v >= 0 ? colour : 'var(--ui-tertiary)'), format: v => signed(v, 2, '%'),
        tips: gaps.map(g => g.gap ? `${g.name} (${g.gap.session}, ${signed(-g.gap.seconds, 3, ' s')})` : g.name), title: 'Qualifying gap to teammate'});
      qualiCard = card(`Qualifying gap to ${family(data, mateId)}`, chart, el('p', 'season-footnote',
        `Above zero: faster than ${family(data, mateId)}, in % of a lap, from the last session both set a time in. Ahead ${ahead} of ${counted}; median ${med == null ? '—' : signed(med, 3, '%')}.`));
    }
    const race = s.by_round.map(r => r.race_points), sprint = s.by_round.map(r => r.sprint_points);
    const per = s.starts ? s.points / s.starts : 0;
    // The wide canvas only where the card spans a wide row: on a phone the single column draws the 640 one at a readable size.
    const pts = card('Points by round', barChart(rounds, race, {width: mateId && innerWidth > 760 ? 1280 : 640, height: 200, extra: sprint, colour: () => colour, tips: rounds.map(name), title: 'Points by round'}),
      el('p', 'season-footnote', `${per.toFixed(1)} points per Grand Prix weekend. The lighter top of a bar is sprint points.`));
    const two = el('div', 'season-two'); two.append(gridCard, qualiCard || pts);
    return qualiCard ? [two, pts] : [two];
  }

  // ----- head-to-head -----
  function renderH2H(data) {
    const order = data.standings.drivers.at(-1)?.table.map(e => e.id) || Object.keys(data.drivers);
    if (!state.a || !data.drivers[state.a]) state.a = order[0];
    if (!state.b || !data.drivers[state.b] || state.b === state.a) {
      const pair = data.teammates.find(p => p.a === state.a || p.b === state.a);
      state.b = pair ? (pair.a === state.a ? pair.b : pair.a) : order.find(x => x !== state.a);
    }
    const a = state.a, b = state.b, sa = data.driver_stats[a], sb = data.driver_stats[b];
    const repaint = () => { window.ApexUrl?.write('season', urlParams()); paint(() => renderH2H(data)); };
    const toolbar = el('div', 'season-toolbar');
    toolbar.append(driverPicker(data, a, v => { state.a = v; if (state.b === v) state.b = null; repaint(); }, 'First driver'), el('span', 'season-vs', 'vs'),
      driverPicker(data, b, v => { state.b = v; repaint(); }, 'Second driver'));
    const result = compare(data, a, b);
    const ca = teamColour(data.drivers[a]?.team), cb0 = teamColour(data.drivers[b]?.team), cb = cb0 === ca ? (getComputedStyle(page).getPropertyValue('--ui-label').trim() || '#fff') : cb0;
    const rows = el('div', 'season-h2h');
    const face = (id, colour, mirrored) => {
      const side = el('div', `season-h2h-side${mirrored ? ' is-right' : ''}`); side.style.setProperty('--team', colour);
      const portrait = el('div', 'season-hero-portrait'); portrait.append(avatar(data, id, 'lg'));
      const ident = el('div', 'season-hero-id'); ident.append(el('h2', null, driverName(data, id)), teamTag(data, data.drivers[id]?.team));
      const st = data.driver_stats[id], pos = data.standings.drivers.at(-1)?.table.find(e => e.id === id)?.position;
      const line = el('div', 'season-hero-line');
      for (const [k, v] of [['Position', pos ? `P${pos}` : '\u2014'], ['Points', st?.points ?? 0], ['Wins', st?.wins ?? 0], ['Poles', st?.poles ?? 0]]) { const d = el('div'); d.append(el('b', null, String(v)), el('span', null, k)); line.append(d); }
      ident.append(line);
      side.append(portrait, ident);
      return side;
    };
    const versus = el('div', 'season-h2h-score');
    versus.append(el('b', null, `${result.tally.race[0]}–${result.tally.race[1]}`), el('span', 'season-muted', 'races ahead'));
    // The scoreboard: qualifying, race and sprint, each as weekends ahead.
    const board = el('div', 'season-h2h-board');
    for (const [kind, label] of [['qualifying', 'Qualifying'], ['race', 'Race'], ['sprint', 'Sprint']]) {
      const [x, y] = result.tally[kind]; if (!(x + y)) continue;
      const cell = el('div'); cell.append(el('b', null, `${x}–${y}`), el('span', 'season-muted', label)); board.append(cell);
    }
    versus.append(board);
    const qGaps = data.rounds.map(r => qualiGap(r, a, b)).filter(Boolean);
    const qMedian = median(qGaps.map(g => g.seconds));
    if (qMedian != null) versus.append(el('span', 'season-h2h-pace', `${signed(qMedian, 3, ' s')} qualifying`),
      el('small', 'season-muted', `median over ${qGaps.length} sessions`));
    const hero = el('div', 'season-h2h-hero'); hero.append(face(a, ca, false), versus, face(b, cb0, true));
    // Linear list rows: the measurement, then each driver's value either side of one split bar. The bar is the share of the
    // better quantity (for "lower is better" rows, the other driver's share of the total), so the longer side is the one ahead;
    // the leader's value is in the label colour and 590, the other in the secondary colour.
    let wonA = 0, wonB = 0;
    const nameCell = (id, colour, right) => { const n = el('span', `season-h2h-name${right ? ' is-right' : ''}`); const dot = el('i'); dot.style.background = colour; n.append(dot, el('b', null, family(data, id))); return n; };
    const headRow = el('div', 'season-h2h-row season-h2h-head');
    headRow.append(nameCell(a, ca), el('span'), nameCell(b, cb0, true));
    rows.append(headRow);
    const section = title => rows.append(el('div', 'season-h2h-section', title));
    // Field rank of a driver_stats value among everyone who started (ties share the better rank).
    const starters = Object.values(data.driver_stats).filter(st => st.starts > 0);
    const fieldRank = (key, value, lower) => {
      if (!key || value == null) return null;
      const vals = starters.map(st => st[key]).filter(v => v != null);
      return 1 + vals.filter(v => (lower ? v < value : v > value)).length;
    };
    const ordinal = n => `${n}${(n % 100 > 10 && n % 100 < 14 ? '' : ['', 'st', 'nd', 'rd'][n % 10]) || 'th'}`;
    const metric = (label, va, vb, {lower = false, format = v => String(v), key = null} = {}) => {
      const row = el('div', 'season-h2h-row');
      const better = va == null || vb == null || va === vb ? 0 : (lower ? va < vb : va > vb) ? -1 : 1;
      if (better < 0) wonA++; else if (better > 0) wonB++;
      // Mirrored: each driver's bar grows outward from the label in the middle, its length that driver's share (the longer
      // side leads; for lower-is-better values the shares are swapped). The side behind is drawn faint.
      const barA = el('span', 'season-h2h-bar is-left'), barB = el('span', 'season-h2h-bar');
      if (va != null && vb != null) {
        const x = Math.abs(va), y = Math.abs(vb), share = x + y === 0 ? .5 : lower ? y / (x + y) : x / (x + y);
        const fa = el('i'), fb = el('i');
        fa.style.width = `${(share * 100).toFixed(1)}%`; fb.style.width = `${((1 - share) * 100).toFixed(1)}%`;
        fa.style.background = ca; fb.style.background = cb;
        if (better > 0) fa.classList.add('is-behind'); if (better < 0) fb.classList.add('is-behind');
        barA.append(fa); barB.append(fb);
        barA.title = barB.title = `${family(data, a)} ${format(va)} · ${family(data, b)} ${format(vb)}`;
      }
      const name = el('span', 'season-h2h-label', label);
      if (lower) { name.title = 'Lower is better'; name.append(el('small', null, ' ↓')); }
      const valueCell = (v, cls) => {
        const cell = el('b', cls, v == null ? '—' : format(v)), rank = fieldRank(key, v, lower);
        if (rank) { const r = el('small', 'season-h2h-rank', ordinal(rank)); r.title = `${ordinal(rank)} of ${starters.length} drivers this season`; if (cls.includes('is-right')) cell.append(r); else cell.prepend(r); }
        return cell;
      };
      row.append(valueCell(va, `season-h2h-value${better < 0 ? ' is-better' : ''}`), barA, name, barB,
        valueCell(vb, `season-h2h-value is-right${better > 0 ? ' is-better' : ''}`));
      rows.append(row);
    };
    section('Weekends');
    metric('Qualifying ahead', result.tally.qualifying[0], result.tally.qualifying[1]);
    metric('Race ahead', result.tally.race[0], result.tally.race[1]);
    if (result.weekends.some(w => w.raceMechanical)) metric('Race ahead, car failures left out', result.clean[0], result.clean[1]);
    if (result.tally.sprint[0] + result.tally.sprint[1]) metric('Sprint ahead', result.tally.sprint[0], result.tally.sprint[1]);
    section('Results');
    metric('Points', sa.points, sb.points, {key: 'points'});
    metric('Wins', sa.wins, sb.wins, {key: 'wins'});
    metric('Podiums', sa.podiums, sb.podiums, {key: 'podiums'});
    metric('Poles', sa.poles, sb.poles, {key: 'poles'});
    metric('Q3 appearances', sa.q3, sb.q3, {key: 'q3'});
    metric('Points finishes', sa.points_finishes, sb.points_finishes, {key: 'points_finishes'});
    section('Averages');
    metric('Average finish', sa.average_finish, sb.average_finish, {lower: true, format: v => v.toFixed(2), key: 'average_finish'});
    if (sa.average_result != null && sb.average_result != null) metric('Average result', sa.average_result, sb.average_result, {lower: true, format: v => v.toFixed(2), key: 'average_result'});
    if (sa.finish_rate != null && sb.finish_rate != null) metric('Finish rate', sa.finish_rate, sb.finish_rate, {format: v => `${Math.round(v * 100)}%`, key: 'finish_rate'});
    metric('Average grid', sa.average_grid, sb.average_grid, {lower: true, format: v => v.toFixed(2), key: 'average_grid'});
    metric('Best finish', sa.best_finish, sb.best_finish, {lower: true, format: v => `P${v}`});
    metric('Retirements', sa.retirements, sb.retirements, {lower: true, key: 'retirements'});
    rows.prepend(el('p', 'season-h2h-sum', `${family(data, a)} is ahead on ${wonA} of these, ${family(data, b)} on ${wonB}. Each bar is split by who is ahead; the longer side leads. The small number is the driver’s rank in the field.`));
    // Each weekend: the qualifying gap as a bar rising in the colour of whoever was quicker (taller is a bigger gap, a
    // second fills it), then both finishing places, the better one bright; a ring marks a race the other car lost to a failure.
    const weeks = el('div', 'season-h2h-weeks is-gaps');
    const gapMax = Math.max(0.3, Math.min(1, Math.max(...data.rounds.map(r => Math.abs(qualiGap(r, a, b)?.seconds ?? 0)))));
    for (const w of result.weekends) {
      const round = data.rounds.find(r => r.round === w.round), cell = el('div');
      cell.append(round ? roundMark(round) : el('small', null, code(w.round)));
      const g = round && qualiGap(round, a, b), gap = el('span', 'season-h2h-gap');
      if (g) {
        const bar = el('i'); bar.style.height = `${(Math.min(Math.abs(g.seconds), gapMax) / gapMax * 100).toFixed(0)}%`;
        bar.style.background = g.seconds <= 0 ? ca : cb; gap.append(bar);
        gap.title = `Qualifying (${g.session}): ${g.seconds <= 0 ? driverCode(data, a) : driverCode(data, b)} quicker by ${Math.abs(g.seconds).toFixed(3)} s`;
      }
      cell.append(gap);
      const finish = id => { const x = round?.race.find(e => e.driver === id); return !x ? '—' : x.position ? String(x.position) : x.status === 'Did not start' ? 'DNS' : 'DNF'; };
      const pa = el('b', w.race === 0 ? 'is-better' : null, finish(a)), pb = el('b', w.race === 1 ? 'is-better' : null, finish(b));
      pa.style.setProperty('--tone', ca); pb.style.setProperty('--tone', cb);
      if (w.raceMechanical) (w.race === 0 ? pb : pa).classList.add('is-car-failure');
      cell.append(pa, pb); cell.title = `${round?.name || ''}: race ${driverCode(data, a)} ${finish(a)}, ${driverCode(data, b)} ${finish(b)}`;
      weeks.append(cell);
    }
    for (const r of data.rounds.filter(notRun)) {
      const cell = el('div', 'is-upcoming'); cell.title = notRunNote(r);
      cell.append(roundMark(r), el('span', 'season-h2h-gap'), el('b', null, ''), el('b', null, ''));
      weeks.append(cell);
    }
    // Whose colour is whose: the dots carry no names.
    const weekKey = el('div', 'season-legend season-week-key');
    for (const [id, colour] of [[a, ca], [b, cb]]) { const k = el('span', 'is-dot', driverCode(data, id)); k.style.setProperty('--tone', colour); k.dataset.tone = 'custom'; k.title = driverName(data, id); weekKey.append(k); }
    if (result.weekends.some(w => w.raceMechanical)) weekKey.append(el('span', 'is-ring', 'Other car failed'));
    // Every teammate battle, one compact row per pairing: the pair, the three scores (weekends ahead, each with a thin split
    // bar in the team colour, the leader's number bright), the median qualifying gap and their season points. A row opens
    // that pairing; the pair being compared is marked.
    const battles = el('table', 'season-table season-battles-table');
    const bh = el('tr');
    bh.append(el('th', null, 'Teammates'), el('th', 'num', 'Qualifying'), el('th', 'num', 'Race'), el('th', 'num', 'Sprint'), el('th', 'num', 'Quali gap'), el('th', 'num', 'Season points'));
    bh.children[4].title = 'Median qualifying gap over the sessions both set a time in the same part';
    const bthead = el('thead'); bthead.append(bh); battles.append(bthead);
    const btb = el('tbody');
    const score = (x, y, colour) => {
      const td = el('td', 'num season-battle-score');
      if (!(x + y)) { td.textContent = '—'; return td; }
      const nums = el('span'); nums.append(el('b', x > y ? 'is-better' : null, String(x)), el('span', 'season-muted', '–'), el('b', y > x ? 'is-better' : null, String(y)));
      const bar = el('i'); bar.style.setProperty('--share', `${(x / (x + y) * 100).toFixed(1)}%`); bar.style.setProperty('--team', colour);
      td.append(nums, bar); return td;
    };
    for (const p of data.teammates) {
      const tr = el('tr', 'season-battle-row'), colour = teamColour(p.team);
      if (p.a === a && p.b === b || p.a === b && p.b === a) tr.setAttribute('aria-current', 'true');
      const open = el('button', 'season-row-toggle season-battle-open'); open.type = 'button';
      const mark = teamMark(data, p.team);
      open.append(mark, who(data, p.a, {code: true, team: false}), el('span', 'season-muted', 'vs'), who(data, p.b, {code: true, team: false}));
      open.append(el('span', 'visually-hidden', `, ${teamName(data, p.team)}. Compare this pair.`));
      const name = el('td'); name.append(open);
      const gaps = data.rounds.map(r => qualiGap(r, p.a, p.b)?.seconds).filter(Number.isFinite), gm = median(gaps);
      const gap = el('td', 'num season-battle-gap', gm == null ? '—' : `${driverCode(data, gm <= 0 ? p.a : p.b)} ${Math.abs(gm).toFixed(3)} s`);
      const pts = [data.driver_stats[p.a]?.points ?? 0, data.driver_stats[p.b]?.points ?? 0];
      const ptsCell = el('td', 'num season-battle-points'); ptsCell.append(el('b', pts[0] > pts[1] ? 'is-better' : null, String(pts[0])), el('span', 'season-muted', '–'), el('b', pts[1] > pts[0] ? 'is-better' : null, String(pts[1])));
      const t = compare(data, p.a, p.b).tally;   // the same counting as the comparison below
      tr.append(name, score(...t.qualifying, colour), score(...t.race, colour), score(...t.sprint, colour), gap, ptsCell);
      tr.addEventListener('click', () => { state.a = p.a; state.b = p.b; repaint(); });   // the button's click bubbles here
      btb.append(tr);
    }
    battles.append(btb);
    const allBattles = card('Every teammate battle', wrap(battles), el('p', 'season-footnote', 'Weekends each driver finished ahead of their teammate (first-named driver first), the median qualifying gap, and each driver’s season points, including any scored for another team. Choose a pair to compare them below.'));
    return [toolbar, allBattles, hero, card(null, rows), h2hPace(data, a, b, ca, cb), h2hExtras(data, a, b, ca, cb), card('Weekend by weekend', weekKey, weeks, el('p', 'season-footnote', `Bars: the qualifying gap, rising in the colour of the quicker driver (a full bar is ${gapMax.toFixed(1)} s or more). Numbers: each driver’s race finishing place, the better one bright; a classified finish beats a retirement. A ring marks a race decided by the other car failing (reported cause mechanical). Empty columns are the rounds still to run.`))];
  }
  // Head-to-head pace: the two drivers' rolling race and qualifying pace and typical top speed (from Form's data), and
  // their race pace at every round. Filled in when the race analysis has loaded.
  function h2hPace(data, a, b, ca, cb) {
    const box = card('Pace', el('p', 'season-muted', 'Loading the race analysis…'));
    const done = data.rounds.filter(r => r.race?.length);
    loadForm(state.year, data).then(form => {
      if (state.a !== a || state.b !== b) return;
      const quali = qualiGapsByRound(done);
      const secs = (perRound, id) => done.filter(r => Number.isFinite(perRound[r.round]?.[id])).map(r => [r.round, perRound[r.round][id] / 100 * (Number.isFinite(poleSeconds(r)) ? poleSeconds(r) : 90)]);
      const raceA = secs(form.race || {}, a), raceB = secs(form.race || {}, b), qA = secs(quali, a), qB = secs(quali, b);
      const speedOf = id => { const v = Object.values(form.speed || {}).map(m => m[id]).filter(Number.isFinite); return v.length ? v.reduce((x, y) => x + y, 0) / v.length : null; };
      const rows = el('div', 'season-h2h-pace-rows');
      // Each line: the measure, both drivers' values, and who is quicker by how much.
      const line = (label, va, vb, {unit = ' s', digits = 3, higher = false, note = ''} = {}) => {
        if (va == null && vb == null) return;
        const row = el('div'), diff = va != null && vb != null ? (higher ? va - vb : vb - va) : null;
        const aBetter = diff != null && diff > 0, bBetter = diff != null && diff < 0;
        const v = (x, better, colour) => { const n = el('b', better ? 'is-better' : null, x == null ? '—' : `${x.toFixed(digits)}${unit}`); n.style.setProperty('--tone', colour); return n; };
        const verdict = diff == null ? '' : Math.abs(diff) < 10 ** -digits ? 'level' : `${driverCode(data, aBetter ? a : b)} by ${Math.abs(diff).toFixed(digits)}${unit}`;
        row.append(el('span', 'season-muted', label), v(va, aBetter, ca), v(vb, bBetter, cb), el('small', 'season-muted', verdict + (note ? ` · ${note}` : '')));
        rows.append(row);
      };
      const head = el('div', 'season-h2h-pace-head');
      head.append(el('span'), el('b', null, driverCode(data, a)), el('b', null, driverCode(data, b)), el('span'));
      rows.append(head);
      line('Rolling race pace', rolling(raceA), rolling(raceB), {note: 'gap to each race’s quickest, recent races weigh more'});
      line('Season race pace', raceA.length ? raceA.reduce((s, [, v]) => s + v, 0) / raceA.length : null, raceB.length ? raceB.reduce((s, [, v]) => s + v, 0) / raceB.length : null);
      line('Rolling qualifying pace', rolling(qA), rolling(qB), {note: 'gap to pole'});
      line('Typical top speed', speedOf(a), speedOf(b), {unit: ' km/h', digits: 1, higher: true, note: 'median race speed trap'});
      // Race pace at every round, both drivers on one scale (lower is quicker).
      const rounds = done.map(r => r.round).filter(n => form.race?.[n]);
      const at = (list, n) => list.find(([m]) => m === n)?.[1] ?? null;
      const chart = rounds.length > 1 ? lineChart(rounds, [
        {id: a, label: driverCode(data, a), short: driverCode(data, a), colour: ca, values: rounds.map(n => at(raceA, n))},
        {id: b, label: driverCode(data, b), short: driverCode(data, b), colour: cb, values: rounds.map(n => at(raceB, n))}],
      {title: 'Race pace by round', height: innerWidth <= 760 ? 360 : 220, endLabels: 2, format: v => `+${v.toFixed(1)}`}) : null;
      box.replaceChildren(el('h3', null, 'Pace'), rows, ...(chart ? [el('h4', 'season-report-title', 'Race pace at each round · seconds behind the quickest, lower is quicker'), chart] : []),
        el('p', 'season-footnote', 'Race pace: each driver’s clean-air pace in Car performance’s race analysis, as a gap to the quickest driver in that race, in seconds on that weekend’s pole lap. Qualifying pace: best lap against pole. Top speed: the median speed-trap reading over each race, averaged.'));
      markTips(box);
    }).catch(() => box.replaceChildren(el('h3', null, 'Pace'), el('p', 'season-muted', 'The race analysis is not available here yet.')));
    return box;
  }

  function h2hExtras(data, a, b, ca, cb) {
    const rounds = data.rounds.filter(r => r.race.length);
    let total = 0;
    const per = rounds.map(r => roundPoints(r, 'driver', a) - roundPoints(r, 'driver', b));
    const cumulative = per.map(v => (total += v));
    const nums = rounds.map(r => r.round), tips = rounds.map(r => r.name);
    const gapLine = lineChart(nums, [{id: 'gap', colour: ca, label: `${family(data, a)} \u2212 ${family(data, b)}`, values: cumulative}], {title: 'Cumulative points gap', height: 180});
    const perBars = barChart(nums, per, {height: 140, colour: v => (v >= 0 ? ca : cb), tips, title: 'Points gap per round', format: v => signed(v, 0)});
    const sub = text => el('p', 'season-chart-sub', text);
    const pointsCard = card('Points gap', sub('Running total'), gapLine, sub('Each weekend, sprint included'), perBars, el('p', 'season-footnote', `Above zero: ${family(data, a)} ahead.`));
    const q = data.rounds.filter(r => r.qualifying.length).map(r => ({round: r.round, name: r.name, gap: qualiGap(r, a, b)}));
    const values = q.map(g => (g.gap ? -g.gap.percent : null));
    const med = median(values);
    const finish = rounds.map(r => { const x = r.race.find(y => y.driver === a)?.position, y = r.race.find(z => z.driver === b)?.position; return x && y ? y - x : null; });
    const qualiCard = card('Pace gap', sub('Qualifying, % of a lap'), barChart(q.map(g => g.round), values, {height: 180, clip: true, colour: v => (v >= 0 ? ca : cb), format: v => signed(v, 2, '%'),
      tips: q.map(g => g.gap ? `${g.name} (${g.gap.session}, ${signed(-g.gap.seconds, 3, ' s')})` : g.name), title: 'Qualifying gap'}),
      sub('Race finish, places'), barChart(nums, finish, {height: 140, colour: v => (v >= 0 ? ca : cb), tips, title: 'Race finish gap', format: v => signed(v, 0)}),
      el('p', 'season-footnote', `Above zero: ${family(data, a)} ahead. Qualifying uses the last session both set a time in (median ${med == null ? '\u2014' : signed(med, 3, '%')}); a cut-short bar is an outlier, its value on hover. Races where either was not classified are left out.`));
    const two = el('div', 'season-two'); two.append(pointsCard, qualiCard);
    return two;
  }
  // Same rules as season_data.compare, for any two drivers.
  function compare(data, a, b) {
    const tally = {qualifying: [0, 0], race: [0, 0], sprint: [0, 0]}, clean = [0, 0], weekends = [];
    for (const r of data.rounds) {
      const find = (rows, id) => rows.find(x => x.driver === id);
      const entry = {round: r.round};
      const qa = find(r.qualifying, a), qb = find(r.qualifying, b);
      if (qa?.position && qb?.position) { const side = qa.position < qb.position ? 0 : 1; tally.qualifying[side]++; entry.qualifying = side; }
      for (const [kind, rows] of [['race', r.race], ['sprint', r.sprint]]) {
        const x = find(rows, a), y = find(rows, b);
        if (x && y && (x.position || y.position)) {
          const side = (x.position || 99) < (y.position || 99) ? 0 : 1; tally[kind][side]++; entry[kind] = side;
          // The loser's car failed (reported cause): a result the winner did not have to earn on track.
          const loser = side === 0 ? y : x;
          if (kind === 'race') { if (!loser.position && loser.cause === 'mechanical') entry.raceMechanical = true; else clean[side]++; }
        }
      }
      if (Object.keys(entry).length > 1) weekends.push(entry);
    }
    return {tally, clean, weekends};
  }

  // ----- upgrades -----
  // 'Mirror stay' and 'Mirror Stay' are one component: shown in sentence case.
  const componentLabel = name => { const t = String(name || '').trim().replace(/\s+/g, ' '); return t && t[0].toUpperCase() + t.slice(1).toLowerCase(); };
  function renderUpgrades(data, ups) {
    const items = (ups.items || []).filter(i => i.team);
    if (!items.length) return [card(null, empty(`The FIA's documents for ${data.year} include no car presentation submissions, so there are no team upgrade lists for this season.`))];
    const teams = [...new Set(items.map(i => i.team))].sort((x, y) => items.filter(i => i.team === y).length - items.filter(i => i.team === x).length);
    const types = [...new Set(items.map(i => i.reason_type))];
    const filtered = items.filter(i => (!state.team || i.team === state.team) && (!state.type || i.reason_type === state.type));
    const filters = el('div', 'season-filters');
    const chip = (label, pressed, onClick, colour, team) => {
      const b = el('button', 'season-filter', label); b.type = 'button'; b.setAttribute('aria-pressed', String(pressed));
      if (team) { const mark = teamMark(data, team); b.prepend(mark); b.classList.add('has-mark'); } else if (colour) b.style.setProperty('--team', colour);
      b.addEventListener('click', onClick); return b;
    };
    const repaint = () => { window.ApexUrl?.write('season', urlParams()); paint(() => renderUpgrades(data, ups)); };
    filters.append(chip('All teams', !state.team, () => { state.team = null; repaint(); }));
    for (const t of teams) filters.append(chip(teamName(data, t), state.team === t, () => { state.team = state.team === t ? null : t; repaint(); }, teamColour(t), t));
    const typeFilters = el('div', 'season-filters');
    typeFilters.append(chip('All reasons', !state.type, () => { state.type = null; repaint(); }));
    for (const t of types) typeFilters.append(chip(t, state.type === t, () => { state.type = state.type === t ? null : t; repaint(); }));
    // Summary: per team (stacked by reason), per reason, most-updated components.
    const typeColour = {Performance: '#5e6ad2', 'Circuit specific': '#f2994a', Reliability: '#4cb782', 'Cooling range': '#26b5ce', 'Balance range': '#bb87fc', Unspecified: '#8a8f98'};
    const perTeam = el('div', 'season-bars');
    const maxTeam = Math.max(1, ...teams.map(t => items.filter(i => i.team === t).length));
    for (const t of teams) {
      const row = el('div', 'season-bar-row'); row.append(teamTag(data, t));
      const bar = el('span', 'season-bar is-stacked');
      for (const ty of types) { const n = items.filter(i => i.team === t && i.reason_type === ty).length; if (!n) continue; const seg = el('i'); seg.style.width = `${n / maxTeam * 100}%`; seg.style.background = typeColour[ty] || '#8a8f98'; seg.title = `${ty}: ${n}`; bar.append(seg); }
      row.append(bar, el('b', null, String(items.filter(i => i.team === t).length))); perTeam.append(row);
    }
    const legend = el('div', 'season-legend');
    for (const ty of types) { const s = el('span'); s.style.setProperty('--tone', typeColour[ty] || '#8a8f98'); s.dataset.tone = 'custom'; s.textContent = `${ty} · ${items.filter(i => i.reason_type === ty).length}`; legend.append(s); }
    // Teams type component names freely: group them ignoring case and spacing, and leave unnamed ones out of the ranking.
    const componentKey = name => String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();
    const tally = filtered.reduce((acc, i) => {
      const key = componentKey(i.component);
      if (!key) return acc;
      acc[key] ||= {name: componentLabel(i.component), n: 0};
      acc[key].n++;
      return acc;
    }, {});
    const components = Object.values(tally).sort((x, y) => y.n - x.n || x.name.localeCompare(y.name)).slice(0, 10).map(c => [c.name, c.n]);
    const comp = el('ol', 'season-ranked');
    for (const [name, n] of components) { const li = el('li'); li.append(el('span', null, name), el('b', null, String(n))); comp.append(li); }
    // Matrix: teams by round.
    const roundsWith = [...new Set(items.map(i => i.round).filter(Boolean))].sort((x, y) => x - y);
    const matrix = el('table', 'season-table season-matrix');
    const headRow = el('tr'); headRow.append(el('th', null, ''));
    for (const r of roundsWith) { const th = el('th', 'num'); const round = data.rounds.find(x => x.round === r); th.append(round ? roundMark(round) : document.createTextNode(code(r))); headRow.append(th); }
    const ahead = data.rounds.filter(r => notRun(r) && !roundsWith.includes(r.round));
    for (const r of ahead) { const th = el('th', 'num'); th.append(roundMark(r)); headRow.append(th); }
    const thead = el('thead'); thead.append(headRow); matrix.append(thead);
    const mbody = el('tbody'); const maxCell = Math.max(1, ...teams.flatMap(t => roundsWith.map(r => items.filter(i => i.team === t && i.round === r).length)));
    for (const t of teams) {
      const tr = el('tr'); const name = el('th'); name.append(teamTag(data, t)); tr.append(name);
      for (const r of roundsWith) {
        const n = items.filter(i => i.team === t && i.round === r).length, td = el('td', 'num');
        if (n) { td.textContent = String(n); td.style.setProperty('--heat', String(.15 + .85 * n / maxCell)); td.style.setProperty('--team', teamColour(t)); td.classList.add('is-heat'); }
        tr.append(td);
      }
      for (const r of ahead) tr.append(upcomingCell(r));
      mbody.append(tr);
    }
    matrix.append(mbody);
    // The updates themselves, newest round first.
    const list = el('div', 'season-updates');
    const byRound = [...new Set(filtered.map(i => i.round))].sort((x, y) => (y || 0) - (x || 0));
    for (const r of byRound) {
      const group = filtered.filter(i => i.round === r);
      const section = el('section', 'season-update-group');
      section.append(el('h4', null, `${group[0].round_name}${r ? ` · R${r}` : ''} · ${group.length} update${group.length === 1 ? '' : 's'}`));
      for (const i of group) {
        const row = el('details', 'season-update');
        const summary = el('summary');
        summary.append(teamTag(data, i.team), el('strong', null, componentLabel(i.component) || 'Component not named'), el('span', 'season-chip', i.reason_type));
        if (i.reason_detail) summary.append(el('span', 'season-muted', i.reason_detail));
        row.append(summary, el('p', null, i.description || 'No description given.'));
        if (i.geometry) row.append(el('p', 'season-muted', `Geometry: ${i.geometry}`));
        const src = el('a', 'season-link', 'FIA document'); src.href = i.document; src.target = '_blank'; src.rel = 'noopener'; row.append(src);
        section.append(row);
      }
      list.append(section);
    }
    const busiest = roundsWith.map(r => [r, items.filter(i => i.round === r).length]).sort((x, y) => y[1] - x[1])[0];
    const perf = items.filter(i => i.reason_type === 'Performance').length;
    const total = el('div', 'season-numbers');
    for (const [label, value, note] of [['Updates', items.length, `${filtered.length} shown`], ['Grands Prix', roundsWith.length, `${(items.length / Math.max(1, roundsWith.length)).toFixed(1)} per race`],
      ['Most updated', teams[0] ? teamName(data, teams[0]) : '\u2014', teams[0] ? `${items.filter(i => i.team === teams[0]).length} updates` : null],
      ['Busiest weekend', busiest ? code(busiest[0]) : '\u2014', busiest ? `${data.rounds.find(r => r.round === busiest[0])?.name} \u00b7 ${busiest[1]}` : null],
      ['For performance', items.length ? `${Math.round(perf / items.length * 100)}%` : '\u2014', `${perf} updates`]]) {
      const d = el('div'); d.append(el('span', 'season-muted', label), el('b', null, String(value))); if (note) d.append(el('small', 'season-muted', note)); total.append(d);
    }
    const filterRow = (label, node) => { const row = el('div', 'season-filter-row'); row.append(el('span', 'season-filter-label', label), node); return row; };
    const head = card(null, total, filterRow('Team', filters), filterRow('Reason', typeFilters)); head.classList.add('season-upgrades-head');
    return [head,
      el('div', 'season-two'),
      updatesByRound(data, teams, items, matrix),
      card(`Updates${state.team ? ' · ' + teamName(data, state.team) : ''}${state.type ? ' · ' + state.type : ''}`, filtered.length ? list : empty('No updates match these filters.')),
      el('p', 'season-footnote', 'Source: the teams\' own descriptions in the FIA Car Presentation Submissions for each Grand Prix. Pages submitted as images cannot be read and are not counted.')]
      .map((node, i) => { if (i === 1) node.append(card('By team and reason', perTeam, legend), card('Most-updated components', comp)); return node; });
  }

  // ----- power units -----
  // Power units by manufacturer. Manufacturers supply different numbers of cars, so counts are set against shares: each
  // manufacturer's share of the grid next to its share of the season's replacement elements (every element beyond the
  // first set each car starts with), and replacements per car, element by element.
  const PU_MAKERS = [[/RBPT/, 'Honda RBPT', 'red_bull'], [/RB Ford|\bFord\b/, 'Red Bull Ford', 'red_bull'], [/Honda/, 'Honda', 'aston_martin'],
    [/Mercedes/, 'Mercedes', 'mercedes'], [/Ferrari/, 'Ferrari', 'ferrari'], [/Audi/, 'Audi', 'audi'], [/Renault/, 'Renault', 'alpine']];
  function puMaker(label) { const hit = PU_MAKERS.find(([re]) => re.test(label || '')); return hit ? {name: hit[1], team: hit[2]} : null; }
  // Reported retirement causes that are the power unit's: the engine and its energy, cooling and fuel systems.
  const PU_CAUSES = /engine|power unit|\bpu\b|battery|\bers\b|energy|mgu|turbo|exhaust|water pressure|oil pressure|oil leak|coolant|overheat|fuel/i;
  // Sortable power-unit tables: select a column title to sort by it, again to reverse; the choice is kept per table.
  // col -1 is the name column. dir 1 = larger first (or A–Z for names), -1 the reverse.
  let unitsArgs = null;
  function sortLines(table, lines, columns, nameOf, defaultCol, defaultDir) {
    const saved = state.puSort?.[table];
    // Historical snapshots may omit allocation columns: retain only a sort that exists in this view.
    const sort = saved && (saved.col === -1 || columns[saved.col]) ? saved : {col: defaultCol, dir: defaultDir};
    state.puSort = {...state.puSort, [table]: sort};
    const value = sort.col < 0 ? g => nameOf(g) : columns[sort.col].value;
    lines.sort((a, b) => {
      const x = value(a), y = value(b);
      if (typeof x === 'string') return sort.dir * String(x).localeCompare(String(y));
      return sort.dir * ((Number.isFinite(y) ? y : Number.MAX_VALUE) - (Number.isFinite(x) ? x : Number.MAX_VALUE));
    });
  }
  // A shaded value sits in its own chip inside a normally padded, right-aligned cell, so neighbouring highlights keep a
  // clear gap and never run to the cell edges. --heat (0-1) on the cell sets the chip's depth; no --heat, no fill.
  function heatChip(td) {
    const chip = el('span', 'season-heat-value'); chip.append(...td.childNodes); td.append(chip);
    return td;
  }

  function sortHeader(th, table, col) {
    const sort = state.puSort?.[table];
    th.classList.add('season-sortable'); th.scope = 'col';
    th.setAttribute('aria-label', th.textContent);
    const button = el('button', 'season-sort-button'); button.type = 'button';
    button.setAttribute('aria-label', `Sort by ${th.textContent}`);
    button.dataset.sortTable = table; button.dataset.sortColumn = String(col);
    button.append(...th.childNodes); th.append(button);
    if (sort && sort.col === col) th.setAttribute('aria-sort', sort.dir === 1 ? (col < 0 ? 'ascending' : 'descending') : (col < 0 ? 'descending' : 'ascending'));
    const go = () => {
      const now = state.puSort?.[table];
      const restoreFocus = document.activeElement === button;
      state.puSort = {...state.puSort, [table]: {col, dir: now && now.col === col ? -now.dir : 1}};
      if (unitsArgs) {
        paint(() => renderUnits(...unitsArgs));
        if (restoreFocus) document.querySelector(`[data-sort-table="${table}"][data-sort-column="${col}"]`)?.focus({preventScroll: true});
      }
    };
    button.addEventListener('click', go);
    return th;
  }
  function reliabilityCard(data, pu) {
    // The same groupings as the elements table (state.unitsView), in the same heat-table look. Counts from each race
    // classification's reported retirement causes and from qualifying, plus the FIA elements table for units fitted.
    const view = ['teams', 'makers'].includes(state.unitsView) ? state.unitsView : 'drivers';
    const makerOf = new Map();
    for (const r of pu.rows) { const m = puMaker(r.label), team = data.drivers[r.driver]?.team || r.team; if (m && team) makerOf.set(team, m); }
    const groups = new Map(), failures = [];
    const keyOf = x => (view === 'drivers' ? x.driver : view === 'teams' ? x.team : makerOf.get(x.team)?.name);
    const group = x => {
      const key = keyOf(x); if (!key) return null;
      if (!groups.has(key)) groups.set(key, {key, team: view === 'makers' ? makerOf.get(x.team)?.team : x.team, teams: new Set(), starts: 0, finished: 0, pu: 0, mechanical: 0, incident: 0, dns: 0, qualis: 0, noTime: 0, laps: 0, possible: 0});
      const g = groups.get(key); g.teams.add(x.team); return g;
    };
    for (const r of data.rounds) {
      const leaderLaps = Math.max(0, ...r.race.map(x => x.laps || 0));
      for (const x of r.race) {
        const g = group(x); if (!g) continue;
        if (x.status === 'Did not start') { g.dns++; continue; }
        g.starts++; g.laps += Math.min(x.laps || 0, leaderLaps); g.possible += leaderLaps;
        if (x.position) g.finished++;
        else if (x.cause === 'mechanical') {
          if (PU_CAUSES.test(x.cause_text || '')) { g.pu++; failures.push({round: r, x, kind: 'pu'}); } else g.mechanical++;
        } else if (x.cause === 'incident') g.incident++;
      }
      for (const q of r.qualifying) { const g = group(q); if (!g) continue; g.qualis++; if (q.q1 == null && q.q2 == null && q.q3 == null) { g.noTime++; failures.push({round: r, x: q, quali: true}); } }
    }
    // Units fitted, from the FIA's cumulative elements table: internal combustion engines (one per power unit) and every
    // element used beyond its season allowance (each one past the allowance brings a grid penalty).
    const allowances = pu.allowances || {}, fitted = new Map();
    for (const r of pu.rows) {
      const team = data.drivers[r.driver]?.team || r.team;
      const key = view === 'drivers' ? r.driver : view === 'teams' ? team : makerOf.get(team)?.name;
      if (!key) continue;
      if (!fitted.has(key)) fitted.set(key, {ice: 0, over: 0, teams: new Set()});
      const f = fitted.get(key); f.teams.add(team); f.ice += r.elements?.ICE || 0;
      for (const [el_, used] of Object.entries(r.elements || {})) if (allowances[el_] && used > allowances[el_]) f.over += used - allowances[el_];
    }
    const lines = [...groups.values()].filter(g => g.starts || g.dns);
    if (lines.length < 2) return null;
    for (const g of lines) {
      const f = fitted.get(g.key);
      g.ice = f?.ice || 0; g.over = f ? f.over : null; g.cars = view === 'drivers' ? 1 : 2 * (f?.teams.size || g.teams.size);
    }
    const hasAllowances = Object.keys(allowances).length > 0;
    // Columns: label, a value to sort by, the text shown, and how it is shaded (worse = deeper): 'up' when a larger value is
    // worse, 'down' when a smaller one is (laps per failure).
    const lapsPerFailure = g => (g.pu ? g.laps / g.pu : Infinity);
    const columns = [
      {label: 'Starts', value: g => g.starts},
      {label: 'Finish rate', value: g => (g.starts ? g.finished / g.starts : 0), text: g => (g.starts ? `${Math.round(g.finished / g.starts * 100)}%` : '—')},
      {label: 'PU failures', value: g => g.pu, heat: 'up', title: 'Race retirements blamed on the power unit: engine, battery or ERS, cooling, fuel'},
      {label: 'Other failures', value: g => g.mechanical, heat: 'up', title: 'Other mechanical retirements: gearbox, brakes, suspension, hydraulics…'},
      {label: 'Incidents', value: g => g.incident, heat: 'up', title: 'Retirements after an accident, collision or damage'},
      {label: 'Did not start', value: g => g.dns, heat: 'up'},
      {label: 'Quali, no time', value: g => g.noTime, heat: 'up', title: 'Qualifying sessions where the car set no time'},
      {label: 'Distance run', value: g => (g.possible ? g.laps / g.possible : 0), text: g => (g.possible ? `${(g.laps / g.possible * 100).toFixed(1)}%` : '—'), title: 'Laps completed as a share of the winner’s laps in the races started'},
      {label: 'Laps per PU failure', value: lapsPerFailure, heat: 'down', text: g => (g.pu ? Math.round(g.laps / g.pu).toLocaleString() : `none in ${g.laps.toLocaleString()}`),
        title: 'Race laps run for each power-unit failure (mean distance between failures): higher is more reliable. Distance, not starts, because power-unit elements are changed between races.'},
      {label: 'Units failed', value: g => (g.ice ? g.pu / g.ice : NaN), heat: 'up',
        text: g => (g.ice ? `${g.pu}/${g.ice} · ${Math.round(g.pu / g.ice * 100)}%` : '—'),
        title: 'Race power-unit failures as a share of the engines (ICEs) fitted this season. Most units are retired on schedule, so this asks how many of them ended in a failure rather than how far they ran.'},
      ...(hasAllowances ? [{label: 'Over allocation', value: g => (g.over == null ? NaN : g.over / g.cars), heat: 'up',
        text: g => (g.over == null ? '—' : view === 'drivers' ? String(g.over) : (g.over / g.cars).toFixed(1)),
        title: `Power-unit elements fitted beyond the season allowance (${Object.entries(allowances).map(([k, v]) => `${k} ${v}`).join(', ')}), summed over every element${view === 'drivers' ? '' : ', per car'}. Each one past the allowance brings a grid penalty.`}] : []),
    ];
    sortLines('reliability', lines, columns, g => (view === 'drivers' ? driverName(data, g.key) : g.key), 8, -1);
    const range = columns.map(c => { if (!c.heat) return null; const v = lines.map(c.value).filter(Number.isFinite); return v.length ? [Math.min(...v), Math.max(...v)] : null; });
    const table = el('table', 'season-table season-units season-reliability');
    const head = el('tr'); head.append(sortHeader(el('th', null, {drivers: 'Driver', teams: 'Team', makers: 'Manufacturer'}[view]), 'reliability', -1));
    columns.forEach((c, i) => { const th = el('th', 'num', c.label); if (c.title) th.title = c.title; head.append(sortHeader(th, 'reliability', i)); });
    const thead = el('thead'); thead.append(head); table.append(thead);
    const tb = el('tbody');
    for (const g of lines) {
      const tr = el('tr'), name = el('td');
      if (view === 'drivers') name.append(data.drivers[g.key] ? who(data, g.key) : el('span', null, g.key));
      else if (view === 'teams') name.append(teamTag(data, g.key));
      else { const dot = el('i', 'season-maker-dot'); dot.style.background = teamColour(g.team); name.classList.add('season-maker'); name.append(dot, el('strong', null, g.key), el('small', null, `${g.teams.size} team${g.teams.size === 1 ? '' : 's'}`)); }
      tr.append(name);
      columns.forEach((c, i) => {
        const raw = c.value(g), td = el('td', `num${c.heat ? ' season-heat-cell' : ''}`, String(c.text ? c.text(g) : raw));
        if (c.heat) heatChip(td);
        if (c.heat && range[i] && Number.isFinite(raw)) {
          const [lo, hi] = range[i], share = hi > lo ? (raw - lo) / (hi - lo) : 0, heat = c.heat === 'down' ? 1 - share : share;
          if (heat > 0 && (c.heat === 'down' ? true : raw > lo)) td.style.setProperty('--heat', String(heat));
        }
        tr.append(td);
      });
      tb.append(tr);
    }
    table.append(tb);
    const listing = el('ul', 'season-failures');
    for (const f of failures.sort((a, b) => b.round.round - a.round.round)) {
      const li = el('li'), maker = makerOf.get(f.x.team)?.name || '';
      li.append(roundMark(f.round), el('strong', null, driverCode(data, f.x.driver)), el('span', 'season-muted', maker),
        el('span', null, f.quali ? 'Qualifying · no time set' : `Race · ${f.x.cause_text}${f.x.laps != null ? ` · lap ${f.x.laps + 1}` : ''}`));
      listing.append(li);
    }
    const fold = failures.length ? (() => { const d = el('details', 'season-failures-wrap'); d.append(el('summary', null, `Show the ${failures.length} power-unit failures and qualifying no-shows`), listing); return d; })() : null;
    return card('Reliability', wrap(table), fold,
      el('p', 'season-footnote', 'From the reported retirement causes in each race classification: power-unit failures are those blamed on the engine, battery or ERS, cooling or fuel; other car failures add the gearbox, brakes, suspension, hydraulics and the rest. Sprints carry no causes and are not counted. A car with no time in qualifying usually could not run; the cause is not published. Laps per PU failure measures distance between failures; because most units are replaced on schedule before they fail, units failed compares race PU failures with the engines (ICEs) fitted, and over allocation counts elements used past the season allowance (per car for teams and manufacturers), from the FIA elements table. Deeper shading is worse. Select a column title to sort by it, again to reverse.'));
  }
  function renderUnits(data, pu) {
    unitsArgs = [data, pu];
    // One table, three groupings (pills): each driver's car, each team, each power-unit manufacturer. Teams and
    // manufacturers run different numbers of cars, so they show elements per car, their cars, and the total per car
    // against the average car (1.5x = 50% more).
    const view = ['teams', 'makers'].includes(state.unitsView) ? state.unitsView : 'drivers';
    const totalOf = el_ => pu.elements.reduce((s, e) => s + (el_[e] || 0), 0);
    let lines;
    if (view === 'drivers') lines = pu.rows.map(r => ({row: r, cars: 1, elements: r.elements, total: totalOf(r.elements)}));
    else {
      const groups = new Map();
      for (const r of pu.rows) {
        const maker = puMaker(r.label), team = data.drivers[r.driver]?.team || r.team;
        const key = view === 'makers' ? maker?.name : team;
        if (!key) continue;
        const g = groups.get(key) || {key, team: view === 'makers' ? maker.team : team, maker, teams: new Set(), cars: 0, sums: Object.fromEntries(pu.elements.map(e => [e, 0]))};
        g.cars++; g.teams.add(team);
        for (const e of pu.elements) g.sums[e] += r.elements[e] || 0;
        groups.set(key, g);
      }
      lines = [...groups.values()].map(g => { const elements = Object.fromEntries(pu.elements.map(e => [e, g.sums[e] / g.cars])); return {group: g, cars: g.cars, elements, total: totalOf(elements)}; });
    }
    const average = lines.reduce((s, r) => s + r.total * r.cars, 0) / Math.max(1, lines.reduce((s, r) => s + r.cars, 0));
    const max = Object.fromEntries(pu.elements.map(e => [e, Math.max(...lines.map(r => r.elements[e] || 0))]));
    const min = Object.fromEntries(pu.elements.map(e => [e, Math.min(...lines.map(r => r.elements[e] || 0))]));
    const fmt = v => (view === 'drivers' ? String(v) : v.toFixed(1));
    const table = el('table', 'season-table season-units');
    // Sortable columns (sortHeader): cars, each element, the total and, grouped, against the average car.
    const grouped = view !== 'drivers';
    const cols = [...(grouped ? [{label: 'Cars', value: l => l.cars}] : []),
      ...pu.elements.map(e => ({label: e, value: l => l.elements[e] || 0, title: (ELEMENT_NAMES[e] || e) + (grouped ? ', per car' : '')})),
      {label: grouped ? 'Total per car' : 'Total', value: l => l.total},
      ...(grouped ? [{label: 'vs average', value: l => l.total / average, title: 'Total per car against the average car on the grid'}] : [])];
    const nameOf = l => (view === 'drivers' ? driverName(data, l.row.driver) || l.row.label : view === 'teams' ? teamName(data, l.group.key) : l.group.key);
    sortLines('elements-' + view, lines, cols, nameOf, cols.findIndex(c => c.label.startsWith('Total')), 1);
    const head = el('tr'); head.append(sortHeader(el('th', null, {drivers: 'Driver', teams: 'Team', makers: 'Manufacturer'}[view]), 'elements-' + view, -1));
    cols.forEach((c, i) => { const th = el('th', 'num', c.label); if (c.title) th.title = c.title; head.append(sortHeader(th, 'elements-' + view, i)); });
    const thead = el('thead'); thead.append(head); table.append(thead);
    const tb = el('tbody');
    for (const r of lines) {
      const tr = el('tr'); const name = el('td');
      if (view === 'drivers') { if (r.row.driver && data.drivers[r.row.driver]) name.append(who(data, r.row.driver)); else name.append(el('span', null, `#${r.row.number} ${r.row.label}`)); }
      else if (view === 'teams') name.append(teamTag(data, r.group.key));
      else { const dot = el('i', 'season-maker-dot'); dot.style.background = teamColour(r.group.team); name.classList.add('season-maker'); name.append(dot, el('strong', null, r.group.key), el('small', null, `${r.group.teams.size} team${r.group.teams.size === 1 ? '' : 's'}`)); }
      tr.append(name);
      if (view !== 'drivers') tr.append(el('td', 'num', String(r.cars)));
      for (const e of pu.elements) {
        const v = r.elements[e], td = heatChip(el('td', 'num season-heat-cell', v == null ? '—' : fmt(v)));
        // Shade by how far above the lowest in this view (no allocation limits are assumed).
        if (v != null && max[e] > min[e]) td.style.setProperty('--heat', String((v - min[e]) / (max[e] - min[e])));
        tr.append(td);
      }
      tr.append(el('td', 'num season-strong', fmt(r.total)));
      if (view !== 'drivers') { const ratio = r.total / average; tr.append(el('td', `num season-maker-ratio${ratio > 1.05 ? ' is-over' : ratio < .95 ? ' is-under' : ''}`, `${ratio.toFixed(2)}×`)); }
      tb.append(tr);
    }
    table.append(tb);
    const pills = el('div', 'season-segment season-zone-toggle'); pills.setAttribute('role', 'group'); pills.setAttribute('aria-label', 'Group by');
    for (const [id, label] of [['drivers', 'Drivers'], ['teams', 'Teams'], ['makers', 'PU manufacturers']]) {
      const btn = el('button', null, label); btn.type = 'button'; btn.setAttribute('aria-pressed', String(view === id));
      btn.addEventListener('click', () => { if (view === id) return; state.unitsView = id; paint(() => renderUnits(data, pu)); });
      pills.append(btn);
    }
    const legend = el('div', 'season-legend');
    for (const e of pu.elements) { const s = el('span'); s.textContent = `${e} · ${ELEMENT_NAMES[e] || e}`; legend.append(s); }
    const src = el('a', 'season-link', 'FIA document'); src.href = pu.document; src.target = '_blank'; src.rel = 'noopener';
    const note = el('p', 'season-footnote');
    note.append(`Elements each driver has used this season, as of ${pu.round_name || 'the latest Grand Prix'}${pu.round ? ` (R${pu.round})` : ''}. Shading compares each driver with the field's lowest count for that element; it does not show penalties or allocation limits. `, src);
    const out = [card(null, pills, wrap(table), legend, note), reliabilityCard(data, pu)].filter(Boolean);
    const history = (pu.history || []).filter(h => h.round);
    if (history.length > 1) {
      const hist = el('table', 'season-table season-matrix season-grid');
      const hrow = el('tr'); hrow.append(el('th', null, 'Driver'));
      for (const h of history) { const th = el('th', 'num'); const r = data.rounds.find(x => x.round === h.round); th.title = h.round_name; if (r) th.append(roundMark(r)); else th.textContent = `R${h.round}`; hrow.append(th); }
      const ahead = data.rounds.filter(r => notRun(r) && !history.some(h => h.round === r.round));
      for (const r of ahead) { const th = el('th', 'num'); th.append(roundMark(r)); hrow.append(th); }
      const hhead = el('thead'); hhead.append(hrow); hist.append(hhead);
      const hb = el('tbody');
      const maxNew = Math.max(1, ...history.flatMap(h => Object.values(h.new || {})));
      for (const r of [...pu.rows].sort((x, y) => pu.elements.reduce((t, e) => t + (y.elements[e] || 0), 0) - pu.elements.reduce((t, e) => t + (x.elements[e] || 0), 0))) {
        const key = r.driver || r.number.replace(/^0+/, '');
        const tr = el('tr'); const name = el('th');
        name.append(r.driver && data.drivers[r.driver] ? who(data, r.driver, {code: true, team: false}) : el('span', null, `#${r.number}`)); tr.append(name);
        history.forEach((h, i) => {
          const n = h.new?.[key], first = h.first?.[key], td = el('td', 'num');
          if (first != null) { td.textContent = String(first); td.classList.add('is-first'); td.title = `${h.round_name}: the first table listing this driver, ${first} elements`; }
          else if (n > 0) { td.textContent = String(n); td.classList.add('is-heat'); td.style.setProperty('--team', '#ff6961'); td.style.setProperty('--heat', String(.15 + .7 * n / maxNew)); td.title = `${h.round_name}: ${n} new element${n === 1 ? '' : 's'}`; }
          else td.title = `${h.round_name}: no new elements`;
          tr.append(td);
        });
        for (const r of ahead) tr.append(upcomingCell(r));
        hb.append(tr);
      }
      hist.append(hb);
      out.push(card('New elements fitted at each Grand Prix', wrap(hist), el('p', 'season-footnote', 'The rise in each driver’s total from one FIA table to the next. Grey numbers are a driver’s total in the first table that lists them, not new parts.')));
    }
    return out;
  }

  // ---------- start ----------
  function boot() {
    build(); buildButton(); place();
    window.ApexUrl?.onRestore('season', params => show(params.tab || 'schedule', params, true));
    const initial = window.ApexUrl?.read();
    if (initial?.view === 'season') show(initial.params.tab || 'schedule', initial.params, true);
    // Its stylesheet ships separately and loads with the view.
    const version = [...document.scripts].find(s => /season\.js/.test(s.src))?.src.match(/\?v=[^&#]+/)?.[0] || '';
    const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = 'season.css' + version; document.head.append(link);
  }
  addEventListener('apex-skin', () => button && place());
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', boot); else boot();
  window.ApexSeason = Object.freeze({show, leave});
})();
