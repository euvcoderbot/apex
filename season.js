/* Season hub: schedule, results, standings, driver stats, head-to-heads, car upgrades and power-unit usage.
   Data: /api/season (Jolpica classifications plus our calculations), /api/season/upgrades and /api/season/power-units
   (parsed FIA documents), fetched through the same cached data path as the other views. Loaded after the page
   (lazy module), so it never delays the session view. Text from data is always set as text or escaped. */
(() => {
  const TABS = [['schedule', 'Schedule'], ['results', 'Results'], ['standings', 'Standings'], ['drivers', 'Driver stats'],
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
  const imagery = {circuits: null, photos: {}, shown: new Set()};
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
    span.setAttribute('aria-hidden', 'true');
    span.style.setProperty('--team', teamColour(data.drivers[id]?.team));
    // Without a photo: the car number on the team colour (the code when a season's data has no number).
    const number = String(data.drivers[id]?.number || '').match(/^\d{1,3}$/)?.[0];
    span.append(el('b', number ? 'is-number' : null, number || (data.drivers[id]?.code || '').slice(0, 3)));
    if (imagery.photos[id]) {
      // The number stays underneath: if the photo fails to load, removing it shows the number.
      const img = el('img'); img.src = `assets/drivers/${encodeURIComponent(id)}.webp`; img.alt = ''; img.decoding = 'async'; img.loading = 'lazy';
      img.addEventListener('error', () => img.remove(), {once: true});
      span.append(img); imagery.shown.add(id);
    }
    return span;
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
    if (!best) return null;
    const k = Math.cos(best[0][1] * Math.PI / 180);
    const xs = best.map(p => p[0] * k), ys = best.map(p => -p[1]);
    const minX = Math.min(...xs), minY = Math.min(...ys), span = Math.max(Math.max(...xs) - minX, Math.max(...ys) - minY) || 1;
    const offX = (span - (Math.max(...xs) - minX)) / 2, offY = (span - (Math.max(...ys) - minY)) / 2;
    const d = xs.map((x, i) => `${i ? 'L' : 'M'}${(4 + (x - minX + offX) / span * 92).toFixed(1)} ${(4 + (ys[i] - minY + offY) / span * 92).toFixed(1)}`).join('') + 'Z';
    return htmlNode(`<svg class="${cls}" viewBox="0 0 100 100" aria-hidden="true" focusable="false"><path d="${d}"/></svg>`);
  }

  let page, body, tabsNav, yearSelect, button, railSection, active = false;
  const state = {year: new Date().getFullYear(), tab: 'schedule', driver: null, a: null, b: null, team: null, standings: 'drivers', matrix: 'position', type: null, expanded: null};
  const cache = {};   // `${kind}:${year}` -> Promise of data

  // ---------- data ----------
  // Saved snapshots (scripts/snapshot-season.mjs, assets/data/season) come first wherever the live API cannot do
  // better: always on the hosted site, which has no backend for new data, and for finished seasons everywhere. The
  // local app keeps the current season live and falls back to the snapshot only if the API fails.
  let snapshotIndex = null;
  async function savedSeason(path) {
    if (typeof DecompressionStream === 'undefined') return null;
    snapshotIndex ||= fetch('assets/data/season/index.json', {cache: 'no-cache'}).then(r => (r.ok ? r.json() : null)).catch(() => null);
    const entry = (await snapshotIndex)?.entries?.[path];
    if (!entry || !/^[a-f0-9]{24}\.json\.gz$/.test(entry.file || '')) return null;
    try {
      const response = await fetch(`assets/data/season/${entry.file}`);
      if (!response.ok) return null;
      const bytes = new Uint8Array(await response.arrayBuffer());
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
  const card = (title, ...children) => { const c = el('section', 'season-card'); if (title) c.append(el('h3', null, title)); c.append(...children.filter(Boolean)); return c; };
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
    if (!active) return;
    active = false;
    document.body.classList.remove('season-view');
    page.hidden = true; mark(false);
  }
  document.addEventListener('click', event => { if (event.target.closest?.('[data-analysis-view], #liveViewButton')) leave(); }, true);

  // ---------- rendering ----------
  // A page's views, then the credits for the driver photos those views showed.
  function paint(views) {
    imagery.shown.clear();
    const nodes = views(), credits = photoCredits();
    body.replaceChildren(...nodes, ...(credits ? [credits] : []));
  }
  let renderToken = 0;
  async function render() {
    const token = ++renderToken, tab = state.tab, year = state.year;
    body.replaceChildren(el('p', 'season-loading', tab === 'upgrades' ? 'Reading the FIA car presentation documents… the first time takes up to a minute.' : 'Loading…'));
    try {
      const [data] = await Promise.all([load('season', year), loadPhotos(), tab === 'schedule' ? loadCircuits() : null]);
      const extra = tab === 'upgrades' ? await load('upgrades', year) : tab === 'units' ? await load('units', year) : null;
      if (token !== renderToken) return;
      const view = {schedule: renderSchedule, results: renderResults, standings: renderStandings, drivers: renderDrivers,
        h2h: renderH2H, upgrades: renderUpgrades, units: renderUnits}[tab];
      setCodes(data);
      const note = savedNote(extra?.saved_at ? extra : data), saved = page.querySelector('.season-saved');
      if (saved) { saved.textContent = note; saved.hidden = !note; }
      paint(() => view(data, extra));
      requestAnimationFrame(() => window.ApexUI?.decorate?.(body));
    } catch (error) {
      if (token !== renderToken) return;
      body.replaceChildren(empty(error.message || String(error)));
    }
  }

  // ----- schedule -----
  function renderSchedule(data) {
    const out = [];
    const next = data.rounds.find(r => r.status === 'next');
    if (next) out.push(nextRaceHero(data, next));
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
          if (!id) { const line = el('div', `${cls || ''} is-empty`.trim()); line.append(el('dt', null, label), el('dd', null, label === 'Sprint' ? 'No sprint' : '—')); rows.append(line); return; }
          const line = el('div', cls); line.title = `${label}: ${driverName(data, id)}`;
          const dd = el('dd'); dd.append(avatar(data, id), el('b', null, driverCode(data, id)));
          line.append(el('dt', null, label), dd); rows.append(line);
        };
        for (const x of r.race.filter(x => x.position && x.position <= 3).sort((a, b) => a.position - b.position)) row(`P${x.position}`, x.driver, x.position === 1 ? 'is-winner' : '');
        const w = data.winners.find(x => x.round === r.round);
        const fastest = r.race.find(x => x.fastest_lap_rank === 1);
        row('Pole', w?.pole, 'is-first-extra');
        row('Fastest lap', fastest?.driver);
        // Always six rows (the sprint row says "No sprint" when there was none), so every card lines up and its link sits in
        // the same place.
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
    const fact = (k, v, note) => { if (v == null || v === '') return; const d = el('div'); d.append(el('dt', null, k), el('dd', null, String(v))); if (note) d.append(el('small', null, note)); facts.append(d); };
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
    const table = el('table', 'season-table');
    table.innerHTML = '<thead><tr><th scope="col" class="num">Round</th><th scope="col">Grand Prix</th><th scope="col">Pole</th><th scope="col">Winner</th><th scope="col">Second</th><th scope="col">Third</th><th scope="col">Fastest lap</th><th scope="col">Sprint</th><th scope="col" class="num">Margin</th></tr></thead>';
    const tbody = el('tbody');
    for (const w of data.winners) {
      const r = data.rounds.find(x => x.round === w.round);
      if (r.status !== 'done') continue;
      const tr = el('tr', 'season-row-expand'); tr.tabIndex = 0; tr.setAttribute('aria-expanded', String(state.expanded === r.round));
      const gp = el('td'), gpName = el('span', 'season-gp'); const f = flag(r); if (f) gpName.append(f); gpName.append(el('span', null, r.name)); gp.append(gpName);
      const cell = id => { const td = el('td'); if (id) td.append(who(data, id, {code: true, team: false})); else td.textContent = '—'; return td; };
      const at = p => r.race.find(x => x.position === p)?.driver;
      tr.append(el('td', 'num', String(r.round)), gp, cell(w.pole), cell(w.race_winner), cell(at(2)), cell(at(3)),
        cell(r.race.find(x => x.fastest_lap_rank === 1)?.driver), cell(w.sprint_winner), el('td', 'num', w.margin != null ? `${w.margin.toFixed(3)} s` : '—'));
      const toggle = () => { state.expanded = state.expanded === r.round ? null : r.round; paint(() => renderResults(data)); };
      tr.addEventListener('click', toggle);
      tr.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggle(); } });
      tbody.append(tr);
      if (state.expanded === r.round) {
        const detail = el('tr', 'season-detail'); const td = el('td'); td.colSpan = 9;
        td.append(classification(data, r));
        detail.append(td); tbody.append(detail);
      }
    }
    table.append(tbody);
    out.push(card('Grand Prix results', el('p', 'season-footnote', 'Select a race for its classification.'), wrap(table)), breakdown);
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
    table.innerHTML = `<thead><tr><th scope="col" class="num">Pos</th><th scope="col"></th><th scope="col">${drivers ? 'Driver' : 'Constructor'}</th><th scope="col" class="num">Wins</th><th scope="col" class="num" title="Points from the last five rounds, sprints included">Last 5</th>${drivers ? '' : '<th scope="col">Split</th>'}<th scope="col" class="num">Points</th><th scope="col" class="num">Gap</th></tr></thead>`;
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
      tr.append(el('td', 'num season-strong', String(e.points)), el('td', 'num season-muted', e.position === 1 ? '' : `−${(leaderPoints - e.points).toFixed(0)}`));
      tb.append(tr);
    }
    table.append(tb);
    const ids = last.map(e => e.id);
    const points = lineChart(evo.map(s => s.round), ids.map(id => ({id, colour: colour(id), label: label(id), short: drivers ? driverCode(data, id) : teamName(data, id),
      values: evo.map(s => s.table.find(x => x.id === id)?.points ?? 0)})), {title: 'Points after each round', endLabels: drivers ? 6 : 5, height: 400});
    const ranks = bumpChart(evo.map(s => s.round), ids.map(id => ({id, colour: colour(id), label: drivers ? driverCode(data, id) : teamName(data, id),
      values: evo.map(s => s.table.find(x => x.id === id)?.position ?? null)})));
    const layout = el('div', 'season-two');
    layout.append(card(null, wrap(table)), el('div', 'season-stack'));
    layout.lastChild.append(card('Points evolution', points), card('Championship position', ranks));
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
    return [toggle, titleFight(data, drivers), layout, matrix, ...(drivers ? [] : [qualiPace(data)])].filter(Boolean);
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
    const rounds = data.rounds.filter(r => r.race.length);
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
    const rounds = data.rounds.filter(r => r.qualifying.length);
    if (!rounds.length) return null;
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
  function setCodes(data) {
    codes = {}; roundNames = {};
    const used = new Set();
    for (const r of data.rounds) {
      const name = String(r.name || '').toLowerCase();
      let c = (RACE_CODES.find(([k]) => name.includes(k)) || [])[1] || String(r.name || `R${r.round}`).replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase();
      if (used.has(c)) c = c.slice(0, 2) + (r.round % 10);   // a second race in one country that year
      used.add(c); codes[r.round] = c; roundNames[r.round] = r.name;
    }
  }
  const code = n => codes[n] || `R${n}`;
  const roundTip = n => `${code(n)} · ${roundNames[n] || `Round ${n}`}`;

  // ---------- one hover card for every chart ----------
  // Marks carry data-tip ("title line\nother lines"); the card follows the pointer inside the season page.
  let tipCard = null;
  function bindTips(scope) {
    if (scope.dataset.tips) return;
    scope.dataset.tips = '1';
    scope.addEventListener('pointermove', event => {
      const mark = event.target.closest?.('[data-tip]');
      if (!mark) { if (tipCard) tipCard.hidden = true; return; }
      if (!tipCard) { tipCard = el('div', 'season-tip'); tipCard.setAttribute('role', 'tooltip'); document.body.append(tipCard); }
      const [head, ...rest] = mark.dataset.tip.split('\n');
      tipCard.replaceChildren(el('b', null, head), ...rest.map(line => el('span', null, line)));
      tipCard.hidden = false;
      const w = tipCard.offsetWidth, h = tipCard.offsetHeight;
      tipCard.style.left = `${Math.min(innerWidth - w - 8, event.clientX + 14)}px`;
      tipCard.style.top = `${Math.max(8, event.clientY - h - 12)}px`;
    });
    scope.addEventListener('pointerleave', () => { if (tipCard) tipCard.hidden = true; });
  }

  // ---------- SVG charts (numbers only go into markup; labels are escaped) ----------
  // Round labels along the bottom: every code when there is room for it, else every other one.
  // Every round is labelled; when the chart is drawn narrow (svg-scale.js measures the real spacing) every other label hides,
  // always keeping the last, and the one before it gives way so the two never touch.
  const xLabels = (rounds, xOf, H) => rounds.map((r, i) => {
    const alt = i !== rounds.length - 1 && (i % 2 === 1 || i === rounds.length - 2);
    return `<text class="axis x-label${alt ? ' is-alt' : ''}" x="${xOf(i).toFixed(1)}" y="${H - 6}" text-anchor="middle">${esc(code(r))}</text>`;
  }).join('');
  // A bar rounded only at its outer end (top for positive values, bottom for negative).
  function barPath(x, y0, y1, w, r = 3) {
    const h = Math.abs(y1 - y0); r = Math.min(r, w / 2, h);
    if (y1 <= y0) return `M${x} ${y0}V${y1 + r}Q${x} ${y1} ${x + r} ${y1}H${x + w - r}Q${x + w} ${y1} ${x + w} ${y1 + r}V${y0}Z`;
    return `M${x} ${y0}V${y1 - r}Q${x} ${y1} ${x + r} ${y1}H${x + w - r}Q${x + w} ${y1} ${x + w} ${y1 - r}V${y0}Z`;
  }
  // Smooth paths: monotone for values (never overshoots between points), bump curves for positions.
  function monotone(points) {
    if (points.length < 3) return points.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');
    const n = points.length, dx = [], m = [], t = [];
    for (let i = 0; i < n - 1; i++) { dx[i] = points[i + 1][0] - points[i][0]; m[i] = (points[i + 1][1] - points[i][1]) / (dx[i] || 1); }
    t[0] = m[0]; t[n - 1] = m[n - 2];
    for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : 3 * (dx[i - 1] + dx[i]) / ((2 * dx[i] + dx[i - 1]) / m[i - 1] + (dx[i] + 2 * dx[i - 1]) / m[i]);
    let d = `M${points[0][0].toFixed(1)} ${points[0][1].toFixed(1)}`;
    for (let i = 0; i < n - 1; i++) {
      const [x0, y0] = points[i], [x1, y1] = points[i + 1], h = dx[i] / 3;
      d += `C${(x0 + h).toFixed(1)} ${(y0 + t[i] * h).toFixed(1)} ${(x1 - h).toFixed(1)} ${(y1 - t[i + 1] * h).toFixed(1)} ${x1.toFixed(1)} ${y1.toFixed(1)}`;
    }
    return d;
  }
  const bumpPath = points => points.map(([x, y], i) => {
    if (!i) return `M${x.toFixed(1)} ${y.toFixed(1)}`;
    const [px, py] = points[i - 1], mx = (px + x) / 2;
    return `C${mx.toFixed(1)} ${py.toFixed(1)} ${mx.toFixed(1)} ${y.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join('');

  // One bar per round, up for positive values; `extra` stacks a second, lighter value on top (sprint points).
  function barChart(rounds, raw, {width = 640, height = 190, colour = () => 'var(--ui-accent, #5e6ad2)', format = v => String(v), tips = [], title = '', extra = null, clip = false} = {}) {
    const W = width, H = height, R = 8, T = 12, B = 24;
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
    const W = 640, H = 230, L = 36, R = 8, T = 10, B = 24;
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
  // endLabels: with many series, name the first N at the end of their lines (spread apart so they never overlap) and draw
  // the rest faint, so the leaders read without a legend; hovering any line or table row still brings it forward.
  function lineChart(rounds, series, {title = '', invert = false, height = 260, min = null, max = null, format = v => String(v), endLabels = 0} = {}) {
    const W = 640, H = height, R = series.length === 1 ? 44 : endLabels ? 46 : 12, T = 12, B = 24;
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
    let svg = `<svg class="season-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">`;
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
      const faint = endLabels && series.indexOf(s) >= endLabels;
      svg += `<path data-id="${esc(s.id)}" class="line${faint ? ' is-faint' : ''}${dashed.has(s) ? ' is-dashed' : ''}" style="stroke:${esc(s.colour)}" d="${d}"/>`;
      if (series.length === 1) {
        const [ex, ey] = pts.at(-1), last = s.values.filter(v => v != null).at(-1);
        svg += `<circle class="end" cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="4" style="fill:${esc(s.colour)}"/><text class="label" x="${(ex + 8).toFixed(1)}" y="${(ey + 4).toFixed(1)}" style="fill:${esc(s.colour)}">${esc(invert ? 'P' + last : format(last))}</text>`;
      }
    }
    if (endLabels && series.length > 1) {
      const ends = series.slice(0, endLabels).map(s => { const last = s.values.filter(v => v != null).at(-1); return last == null ? null : {s, y: y(last), last}; }).filter(Boolean).sort((a, b) => a.y - b.y);
      for (let i = 1; i < ends.length; i++) ends[i].y = Math.max(ends[i].y, ends[i - 1].y + 12);
      for (const e of ends) svg += `<text class="label" data-id="${esc(e.s.id)}" x="${W - R + 6}" y="${(e.y + 4).toFixed(1)}" style="fill:${esc(e.s.colour)}">${esc(e.s.short || e.s.label)}</text>`;
    }
    return htmlNode(svg + xLabels(rounds, x, H, slot) + '</svg>');
  }
  // Teammates share a team colour: the second series of a colour is dashed, so the two can be told apart.
  function teammateDashes(series) {
    const seen = new Set(), out = new Set();
    for (const s of series) { if (seen.has(s.colour)) out.add(s); seen.add(s.colour); }
    return out;
  }
  function bumpChart(rounds, series) {
    const n = series.length, W = 640, H = Math.max(200, n * 18 + 30), L = 30, R = 46, T = 10, B = 22;
    const dashed = teammateDashes(series.slice(0, 6));
    const x = i => L + (rounds.length < 2 ? 0 : i / (rounds.length - 1) * (W - L - R));
    const y = p => T + (p - 1) / Math.max(1, n - 1) * (H - T - B);
    const slot = rounds.length > 1 ? (W - L - R) / (rounds.length - 1) : 40;
    let svg = `<svg class="season-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Championship position after each round">`;
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
      // The top six (current order) in full colour; the rest faint until hovered, as on the points chart.
      const faint = series.indexOf(s) >= 6;
      svg += `<g data-id="${esc(s.id)}"${faint ? ' class="is-faint-group"' : ''}><path class="line is-bump${faint ? ' is-faint' : dashed.has(s) ? ' is-dashed' : ''}" style="stroke:${esc(s.colour)}" d="${bumpPath(pts)}"/>`;
      if (lastValue != null) svg += `<circle class="end" cx="${pts.at(-1)[0].toFixed(1)}" cy="${pts.at(-1)[1].toFixed(1)}" r="3" style="fill:${esc(s.colour)}"/><text class="label" x="${W - R + 8}" y="${y(lastValue) + 4}" style="fill:${esc(s.colour)}">${esc(s.label)}</text>`;
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
    const counts = s.finish_counts, maxCount = Math.max(1, ...Object.values(counts));
    const dist = el('div', 'season-dist'); dist.style.setProperty('--team', teamColour(data.drivers[id]?.team));
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
    const pts = card('Points by round', barChart(rounds, race, {width: mateId ? 1280 : 640, height: 200, extra: sprint, colour: () => colour, tips: rounds.map(name), title: 'Points by round'}),
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
    const metric = (label, va, vb, {lower = false, format = v => String(v)} = {}) => {
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
      row.append(el('b', `season-h2h-value${better < 0 ? ' is-better' : ''}`, va == null ? '—' : format(va)), barA, name, barB,
        el('b', `season-h2h-value is-right${better > 0 ? ' is-better' : ''}`, vb == null ? '—' : format(vb)));
      rows.append(row);
    };
    section('Weekends');
    metric('Qualifying ahead', result.tally.qualifying[0], result.tally.qualifying[1]);
    metric('Race ahead', result.tally.race[0], result.tally.race[1]);
    if (result.weekends.some(w => w.raceMechanical)) metric('Race ahead, car failures left out', result.clean[0], result.clean[1]);
    if (result.tally.sprint[0] + result.tally.sprint[1]) metric('Sprint ahead', result.tally.sprint[0], result.tally.sprint[1]);
    section('Results');
    metric('Points', sa.points, sb.points);
    metric('Wins', sa.wins, sb.wins);
    metric('Podiums', sa.podiums, sb.podiums);
    metric('Poles', sa.poles, sb.poles);
    metric('Q3 appearances', sa.q3, sb.q3);
    metric('Points finishes', sa.points_finishes, sb.points_finishes);
    section('Averages');
    metric('Average finish', sa.average_finish, sb.average_finish, {lower: true, format: v => v.toFixed(2)});
    if (sa.average_result != null && sb.average_result != null) metric('Average result', sa.average_result, sb.average_result, {lower: true, format: v => v.toFixed(2)});
    if (sa.finish_rate != null && sb.finish_rate != null) metric('Finish rate', sa.finish_rate, sb.finish_rate, {format: v => `${Math.round(v * 100)}%`});
    metric('Average grid', sa.average_grid, sb.average_grid, {lower: true, format: v => v.toFixed(2)});
    metric('Best finish', sa.best_finish, sb.best_finish, {lower: true, format: v => `P${v}`});
    metric('Retirements', sa.retirements, sb.retirements, {lower: true});
    rows.prepend(el('p', 'season-h2h-sum', `${family(data, a)} is ahead on ${wonA} of these, ${family(data, b)} on ${wonB}. Each bar is split by who is ahead; the longer side leads.`));
    const weeks = el('div', 'season-h2h-weeks');
    for (const w of result.weekends) {
      const cell = el('div'); cell.title = data.rounds.find(r => r.round === w.round)?.name || '';
      const round = data.rounds.find(r => r.round === w.round); cell.append(round ? roundMark(round) : el('small', null, code(w.round)));
      for (const kind of ['qualifying', 'race']) {
        const dot = el('i'); dot.title = kind;
        if (w[kind] != null) dot.style.background = w[kind] === 0 ? ca : cb;
        if (kind === 'race' && w.raceMechanical) { dot.classList.add('is-car-failure'); dot.title = 'race · the other car failed'; }
        cell.append(dot);
      }
      weeks.append(cell);
    }
    const battles = el('div', 'season-battles');
    // Column headings, and one line saying how to read a row: numbers and bars follow the order of the names.
    const heads = el('div', 'season-battle-head', null); heads.setAttribute('aria-hidden', 'true');
    for (const t of ['Team', 'Teammates', 'Qualifying', 'Race']) heads.append(el('span', null, t));
    battles.append(heads);
    for (const p of data.teammates) {
      const row = el('button', 'season-battle'); row.type = 'button';
      row.addEventListener('click', () => { state.a = p.a; state.b = p.b; repaint(); });
      const names = el('div', 'season-battle-names'); names.append(who(data, p.a, {code: true, team: false}), el('span', 'season-muted', 'vs'), who(data, p.b, {code: true, team: false}));
      row.append(teamTag(data, p.team), names);
      for (const [kind, label] of [['qualifying', 'qualifying'], ['race', 'race']]) {
        const [x, y] = p.tally[kind], bar = el('div', 'season-battle-bar');
        bar.title = `${family(data, p.a)} ${x} · ${family(data, p.b)} ${y} weekends ahead in ${label}`;
        bar.append(el('b', x > y ? 'is-better' : null, String(x)));
        // The first driver's share in the team colour, the second's in the same colour, faint.
        const track = el('span'); const left = el('i'), right = el('i');
        left.style.width = `${x + y ? x / (x + y) * 100 : 50}%`; left.style.background = teamColour(p.team); right.style.background = teamColour(p.team);
        track.append(left, right);
        bar.append(track, el('b', y > x ? 'is-better' : null, String(y)));
        row.append(bar);
      }
      battles.append(row);
    }
    return [toolbar, hero, card(null, rows), h2hExtras(data, a, b, ca, cb), card('Weekend by weekend', weeks, el('p', 'season-footnote', 'Top dot qualifying, bottom dot race, in the colour of whoever finished ahead. A classified finish beats a retirement; two retirements count for neither. A ring marks a race decided by the other car failing, where the reported cause was mechanical.')),
      card('Every teammate battle', el('p', 'season-footnote', 'Weekends each driver finished ahead of their teammate. Numbers and bars follow the order of the names: the first driver on the left, the second on the right.'), battles)];
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
    const thead = el('thead'); thead.append(headRow); matrix.append(thead);
    const mbody = el('tbody'); const maxCell = Math.max(1, ...teams.flatMap(t => roundsWith.map(r => items.filter(i => i.team === t && i.round === r).length)));
    for (const t of teams) {
      const tr = el('tr'); const name = el('th'); name.append(teamTag(data, t)); tr.append(name);
      for (const r of roundsWith) {
        const n = items.filter(i => i.team === t && i.round === r).length, td = el('td', 'num');
        if (n) { td.textContent = String(n); td.style.setProperty('--heat', String(.15 + .85 * n / maxCell)); td.style.setProperty('--team', teamColour(t)); td.classList.add('is-heat'); }
        tr.append(td);
      }
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
      card('Updates by team and Grand Prix', wrap(matrix)),
      card(`Updates${state.team ? ' · ' + teamName(data, state.team) : ''}${state.type ? ' · ' + state.type : ''}`, filtered.length ? list : empty('No updates match these filters.')),
      el('p', 'season-footnote', 'Source: the teams\' own descriptions in the FIA Car Presentation Submissions for each Grand Prix. Pages submitted as images cannot be read and are not counted.')]
      .map((node, i) => { if (i === 1) node.append(card('By team and reason', perTeam, legend), card('Most-updated components', comp)); return node; });
  }

  // ----- power units -----
  function renderUnits(data, pu) {
    const rows = pu.rows.map(r => ({...r, total: pu.elements.reduce((s, e) => s + (r.elements[e] || 0), 0)})).sort((x, y) => y.total - x.total);
    const max = Object.fromEntries(pu.elements.map(e => [e, Math.max(...rows.map(r => r.elements[e] || 0))]));
    const min = Object.fromEntries(pu.elements.map(e => [e, Math.min(...rows.map(r => r.elements[e] || 0))]));
    const table = el('table', 'season-table season-units');
    const head = el('tr'); head.append(el('th', null, 'Driver'));
    for (const e of pu.elements) { const th = el('th', 'num', e); th.title = ELEMENT_NAMES[e] || e; head.append(th); }
    head.append(el('th', 'num', 'Total'));
    const thead = el('thead'); thead.append(head); table.append(thead);
    const tb = el('tbody');
    for (const r of rows) {
      const tr = el('tr'); const name = el('td');
      if (r.driver && data.drivers[r.driver]) name.append(who(data, r.driver)); else name.append(el('span', null, `#${r.number} ${r.label}`));
      tr.append(name);
      for (const e of pu.elements) {
        const v = r.elements[e], td = el('td', 'num season-heat-cell', v == null ? '—' : String(v));
        // Shade by how far above the field's lowest count this driver is (no allocation limits are assumed).
        if (v != null && max[e] > min[e]) td.style.setProperty('--heat', String((v - min[e]) / (max[e] - min[e])));
        tr.append(td);
      }
      tr.append(el('td', 'num season-strong', String(r.total)));
      tb.append(tr);
    }
    table.append(tb);
    const legend = el('div', 'season-legend');
    for (const e of pu.elements) { const s = el('span'); s.textContent = `${e} · ${ELEMENT_NAMES[e] || e}`; legend.append(s); }
    const src = el('a', 'season-link', 'FIA document'); src.href = pu.document; src.target = '_blank'; src.rel = 'noopener';
    const note = el('p', 'season-footnote');
    note.append(`Elements each driver has used this season, as of ${pu.round_name || 'the latest Grand Prix'}${pu.round ? ` (R${pu.round})` : ''}. Shading compares each driver with the field's lowest count for that element; it does not show penalties or allocation limits. `, src);
    const out = [card(null, wrap(table), legend, note)];
    const history = (pu.history || []).filter(h => h.round);
    if (history.length > 1) {
      const hist = el('table', 'season-table season-matrix season-grid');
      const hrow = el('tr'); hrow.append(el('th', null, 'Driver'));
      for (const h of history) { const th = el('th', 'num'); const r = data.rounds.find(x => x.round === h.round); const f = r && flag(r); th.title = h.round_name; if (f) th.append(f); else th.textContent = `R${h.round}`; hrow.append(th); }
      const hhead = el('thead'); hhead.append(hrow); hist.append(hhead);
      const hb = el('tbody');
      const maxNew = Math.max(1, ...history.flatMap(h => Object.values(h.new || {})));
      for (const r of rows) {
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
