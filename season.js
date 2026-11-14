/* Season hub: schedule, results, standings, driver stats, head-to-heads, car upgrades and power-unit usage.
   Data: /api/season (Jolpica classifications plus our calculations), /api/season/upgrades and /api/season/power-units
   (parsed FIA documents), fetched through the same cached data path as the other views. Loaded after the page
   (lazy module), so it never delays the session view. Text from data is always set as text or escaped. */
(() => {
  // The rail lists the sections (Home, Session analysis, Car performance, Season, Tracks); a section's pages are the small
  // pills at the top of its page. Season's pills: Calendar to Reliability. Form is part of Drivers (?tab=form opens it).
  const TABS = [['home', 'Home'], ['schedule', 'Calendar'], ['results', 'Results'], ['standings', 'Standings'], ['drivers', 'Drivers'],
    ['h2h', 'Head-to-head'], ['upgrades', 'Development'], ['units', 'Reliability'], ['tracks', 'Tracks']];
  const SECTION_TABS = ['home', 'tracks'];   // their own rows in the rail, not Season pills
  const TAB_ALIASES = {form: 'drivers'};
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
  const state = {year: new Date().getFullYear(), tab: 'schedule', driver: null, a: null, b: null, team: null, standings: 'drivers', matrix: 'points', updatesView: 'grid', type: null, expanded: null};
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
      if (SECTION_TABS.includes(id)) continue;   // Home and Tracks are their own rows in the rail, not Season pages
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
    button.addEventListener('click', () => show(SECTION_TABS.includes(state.tab) || !active ? (lastSeasonTab || 'schedule') : state.tab));
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
  // Home: the first row of the rail, above Session analysis; it opens the landing page.
  let homeButton = null;
  function placeHome(rail) {
    if (!homeButton) {
      homeButton = el('button', 'season-view-button home-view-button'); homeButton.type = 'button'; homeButton.id = 'homeViewButton';
      homeButton.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 7 8 2.5 13.5 7v6.5h-3.5v-4h-4v4H2.5z"/></svg>';
      homeButton.append(el('span', null, 'Home'));
      homeButton.addEventListener('click', () => show('home'));
    }
    // Before the analysis tablist, not inside it: a tablist may only hold tabs.
    const tabs = rail.querySelector('.performance-tabs'), first = tabs || rail.querySelector('button, a');
    if (homeButton.parentElement !== first?.parentElement || homeButton.nextElementSibling !== first) first ? first.before(homeButton) : rail.prepend(homeButton);
    homeButton.setAttribute('aria-pressed', String(active && state.tab === 'home'));
  }
  let tracksRow = null;
  const ICONS = {
    tracks: '<path d="M4.5 12.5c-1.7 0-2.5-1.2-2-2.6l1.6-4.6C4.6 3.9 5.7 3 7.2 3h2.3c1.6 0 2.4 1.4 1.8 2.8l-.6 1.4c-.3.7.2 1.3.9 1.3h.6c1.4 0 2.3 1.3 1.8 2.6-.4 1-1.3 1.4-2.3 1.4z"/>',
    upgrades: '<path d="M8 13V3.5M4 7l4-4 4 4"/><path d="M3 13.5h10"/>',
    units: '<path d="M8 2.5 3 4.5v4c0 2.6 2.1 4.6 5 5.5 2.9-.9 5-2.9 5-5.5v-4z"/><path d="m5.8 8.2 1.6 1.6 3-3.2"/>',
    schedule: '<rect x="2.5" y="3.5" width="11" height="10" rx="2"/><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3"/>',
    results: '<path d="M4 14V2.5"/><path d="M4 3h8l-1.5 2.5L12 8H4"/>',
    standings: '<path d="M5 2.5h6v3a3 3 0 0 1-6 0z"/><path d="M8 8.5v3M5.5 13.5h5M5 4H3a2 2 0 0 0 2 2.5M11 4h2a2 2 0 0 1-2 2.5"/>',
    drivers: '<circle cx="8" cy="5.5" r="2.5"/><path d="M3 13.5c.6-2.6 2.6-4 5-4s4.4 1.4 5 4"/>',
    h2h: '<circle cx="5.5" cy="6" r="2"/><circle cx="10.5" cy="6" r="2"/><path d="M2 13c.4-2 1.8-3 3.5-3S8.6 11 9 13M7 13c.4-2 1.8-3 3.5-3s3.1 1 3.5 3"/>',
  };
  // A rail row: the page's icon and name, as the rail's own rows.
  function railRow(id, label) {
    const b = el('button', 'season-view-button season-analysis-row'); b.type = 'button'; b.dataset.seasonTab = id;
    b.innerHTML = `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[id] || ''}</svg>`;
    b.append(el('span', null, label));
    b.addEventListener('click', () => show(id));
    return b;
  }
  function place() {
    const rail = document.querySelector('#linearWorkspace .linear-navigation');
    if (rail) {
      placeHome(rail);
      rail.append(button);
      tracksRow ||= railRow('tracks', 'Tracks');
      button.after(tracksRow);
      // The brand opens Home, as a site's name does.
      const brand = document.querySelector('#linearWorkspace .linear-workspace-brand');
      if (brand && !brand.dataset.home) {
        brand.dataset.home = '1'; brand.setAttribute('role', 'link'); brand.tabIndex = 0; brand.title = 'Home';
        brand.addEventListener('click', () => show('home'));
        brand.addEventListener('keydown', e => { if (e.key === 'Enter') show('home'); });
      }
    } else {
      (document.querySelector('.site-header .performance-tabs') || document.querySelector('.site-header .header-actions'))?.append(button);
    }
    mark(active && !SECTION_TABS.includes(state.tab));
    tracksRow?.setAttribute('aria-pressed', String(active && state.tab === 'tracks'));
  }

  // ---------- entering and leaving ----------
  let lastSeasonTab = null;
  function show(tab, params = {}, fromHistory = false) {
    window.ApexLive?.leave?.();
    const aliased = Boolean(TAB_ALIASES[tab]);
    tab = TAB_ALIASES[tab] || tab;
    state.tab = TABS.some(([id]) => id === tab) ? tab : 'schedule';
    if (!SECTION_TABS.includes(state.tab)) lastSeasonTab = state.tab;
    if (params.year && Number(params.year) !== state.year) { state.year = Number(params.year); }
    for (const key of ['driver', 'a', 'b', 'team', 'track']) if (params[key]) state[key] = params[key];
    yearSelect.value = String(state.year); window.syncSelectUI?.(yearSelect);
    if (!active) {
      active = true;
      document.querySelectorAll('[data-analysis-view]').forEach(t => t.setAttribute('aria-selected', 'false'));
      document.body.classList.add('season-view');
      page.hidden = false;
      document.body.dataset.view = 'season';
    }
    for (const b of document.querySelectorAll('[data-season-tab]')) b.setAttribute('aria-pressed', String(b.dataset.seasonTab === state.tab));
    // Home lights its own rail row; any Season page lights the Season row.
    mark(!SECTION_TABS.includes(state.tab)); homeButton?.setAttribute('aria-pressed', String(state.tab === 'home')); tracksRow?.setAttribute('aria-pressed', String(state.tab === 'tracks'));
    page.classList.toggle('is-home', state.tab === 'home');
    const label = TABS.find(([id]) => id === state.tab)[1];
    page.querySelector('.season-title h1').textContent = label;
    const crumb = document.getElementById('windowTitle'), sub = document.getElementById('windowSubtitle');
    if (crumb) crumb.textContent = label;
    if (sub) sub.textContent = state.tab === 'home' ? 'F1 Apex Data' : state.tab === 'tracks' ? `Tracks · ${state.year}` : `Season ${state.year}`;
    if (!fromHistory || aliased) window.ApexUrl?.write('season', urlParams());
    else document.title = window.ApexUrl?.titleFor('season', urlParams()) || document.title;
    render();
  }
  const urlParams = () => ({year: state.year, tab: state.tab, ...(state.tab === 'drivers' && state.driver ? {driver: state.driver} : {}),
    ...(state.tab === 'h2h' && state.a ? {a: state.a, b: state.b} : {}), ...(state.tab === 'upgrades' && state.team ? {team: state.team} : {}), ...(state.tab === 'tracks' && state.track ? {track: state.track} : {})});
  function leave() {
    hideChartTip();
    if (!active) return;
    active = false;
    document.body.classList.remove('season-view');
    page.hidden = true; mark(false); homeButton?.setAttribute('aria-pressed', 'false');
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
      if (tab === 'schedule' || tab === 'home') void loadCircuits().then(hydrateImagery);
      const [data, extra] = await Promise.all([load('season', year),
        tab === 'upgrades' ? load('upgrades', year) : tab === 'units' ? load('units', year) : tab === 'tracks' ? loadTrackProfiles() : null]);
      // Form also reads each finished race's pace analysis (the published Car performance results), once per season.
      const form = tab === 'drivers' ? await loadForm(year, data).catch(() => null) : null;
      if (token !== renderToken) return;
      const view = {home: renderHome, schedule: renderSchedule, results: renderResults, standings: renderStandings, form: renderForm, drivers: renderDrivers,
        h2h: renderH2H, upgrades: renderUpgrades, units: renderUnits, tracks: renderTracks}[tab];
      setCodes(data);
      const note = savedNote(extra?.saved_at ? extra : data), saved = page.querySelector('.season-saved');
      if (saved) { saved.textContent = note; saved.hidden = !note; }
      paint(() => view(data, tab === 'drivers' ? form : extra));
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

  // ----- home: the landing page -----
  // The next race (countdown, sessions, forecast), the season at a glance, and a way into every part of the site.
  function renderHome(data) {
    const out = [];
    const next = data.rounds.find(r => r.status === 'next');
    if (next) out.push(nextRaceHero(data, next));
    // The season strip: every round as its flag and code, done / next / to come.
    const strip = el('div', 'home-season-strip'); strip.style.setProperty('--n', String(data.rounds.length));
    for (const r of data.rounds) {
      const cell = el('button', `home-round is-${r.status}`); cell.type = 'button'; cell.append(roundMark(r));
      // A finished round: the winner's photo and code; the next one says so; later ones their date.
      const winner = r.status === 'done' ? r.race.find(x => x.position === 1)?.driver : null;
      if (winner && data.drivers[winner]) cell.append(avatar(data, winner));
      cell.append(el('small', null, r.status === 'done' ? (driverCode(data, winner) || 'Done') : r.status === 'next' ? 'Next' : new Date(r.date + 'T12:00:00').toLocaleDateString(undefined, {day: 'numeric', month: 'short'})));
      cell.title = `R${r.round} · ${r.name}${winner ? ` · won by ${driverName(data, winner)}` : ''}`;
      cell.addEventListener('click', () => { state.expanded = r.round; show('results'); });
      strip.append(cell);
    }
    const done = data.rounds.filter(r => r.race?.length);
    out.push(card(`Season ${data.year} · ${done.length} of ${data.rounds.length} Grands Prix`, strip));
    // At a glance: four short lists, each opening its full page.
    const glance = el('div', 'home-glance');
    const list = (title, rows, tab, note) => {
      const box = el('section', 'home-glance-card'), head = el('header');
      const open = el('button', 'home-glance-open', title); open.type = 'button'; open.addEventListener('click', () => show(tab));
      head.append(open, el('span', 'season-muted', note || '')); box.append(head);
      const ol = el('ol', 'home-glance-list');
      for (const [left, right, sub] of rows) { const li = el('li'); li.append(left, el('b', null, right)); if (sub) li.append(el('small', 'season-muted', sub)); ol.append(li); }
      box.append(ol); glance.append(box); return box;
    };
    const table = data.standings.drivers.at(-1)?.table || [];
    list('Standings', table.slice(0, 5).map(e => [who(data, e.id, {team: false, family: true}), String(e.points)]), 'standings', 'points');
    const last = done.at(-1);
    if (last) {
      const pole = last.qualifying.find(q => q.position === 1), fl = last.race.find(x => x.fastest_lap_rank === 1);
      const rows = last.race.filter(x => x.position && x.position <= 3).sort((x, y) => x.position - y.position).map(x => [who(data, x.driver, {team: false, family: true}), `P${x.position}`]);
      if (pole) rows.push([who(data, pole.driver, {team: false, family: true}), 'Pole']);
      if (fl) rows.push([who(data, fl.driver, {team: false, family: true}), 'Fastest lap']);
      const box = list(last.name.replace(' Grand Prix', ' GP'), rows, 'results', 'last race');
      const f = flag(last); if (f) box.querySelector('header .home-glance-open').prepend(f);
    }
    const formBox = list('Rolling race pace', [], 'form', 'gap to the quickest');
    loadForm(state.year, data).then(form => {
      const ids = Object.keys(data.drivers), rounds = done.map(r => r.round).filter(n => form.race?.[n]);
      const rows = ids.map(id => [id, rolling(trimOutliers(rounds.filter(n => Number.isFinite(form.race[n][id])).map(n => [n, form.race[n][id] / 100 * 90])).kept)])
        .filter(([, v]) => v != null).sort((x, y) => x[1] - y[1]).slice(0, 5);
      const best = rows[0]?.[1] ?? 0, ol = formBox.querySelector('ol');
      for (const [id, v] of rows) { const li = el('li'); li.append(who(data, id, {team: false, family: true}), el('b', null, v - best < 0.0005 ? 'quickest' : `+${(v - best).toFixed(3)} s`)); ol.append(li); }
      if (!rows.length) ol.append(el('li', 'season-muted', 'Race analysis not available yet.'));
    });
    out.push(glance);
    // Every part of the site, one tile each.
    return out;
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
  // ----- Tracks: one circuit in full, and every circuit compared -----
  // assets/data/track-profiles.json (scripts/build-track-profiles.mjs): each circuit as the season's fastest qualifying
  // lap drove it, with the numbered corners, sectors, straights, Pirelli's nominated compounds, the pit-lane time loss
  // and a map outline. The picker is every measured round; the page shows the chosen one, then all of them in a table.
  let trackProfiles = null;
  const loadTrackProfiles = () => (trackProfiles ||= fetch('assets/data/track-profiles.json').then(r => (r.ok ? r.json() : null)).catch(() => null));
  const TRACK_COLUMNS = [
    ['length', 'Length', v => `${(v / 1000).toFixed(3)} km`],
    ['lap_time', 'Pole lap', v => lapTime(v)],
    ['average_speed', 'Average speed', v => `${Math.round(v)} km/h`],
    ['full_throttle', 'Full throttle', v => `${Math.round(v * 100)}%`],
    ['braking', 'Braking', v => `${Math.round(v * 100)}%`],
    ['braking_zones', 'Braking zones', v => String(Math.round(v))],
    ['gear_changes', 'Gear changes', v => String(Math.round(v))],
    ['total', 'Corners', v => String(Math.round(v))],
    ['slow', 'Slow', v => String(Math.round(v))],
    ['medium', 'Medium', v => String(Math.round(v))],
    ['fast', 'Fast', v => String(Math.round(v))],
  ];
  const trackValue = (t, key) => (['slow', 'medium', 'fast', 'total'].includes(key) ? t.corners[key] : t[key]);
  const SPEED_RAMP = ['#5b3fd1', '#a245b8', '#e0577a', '#f5933d', '#f7d94c'];
  const SECTOR_COLOURS = ['#ff4081', '#e6bc24', '#40a9ed'];
  const CORNER_TYPE = {slow: 'Slow', medium: 'Medium', fast: 'Fast'};
  function rampColour(share) {
    const at = Math.max(0, Math.min(1, share)) * (SPEED_RAMP.length - 1), i = Math.min(SPEED_RAMP.length - 2, Math.floor(at)), f = at - i;
    const mix = (a, b) => Math.round(parseInt(a, 16) + (parseInt(b, 16) - parseInt(a, 16)) * f).toString(16).padStart(2, '0');
    const [a, b] = [SPEED_RAMP[i].slice(1), SPEED_RAMP[i + 1].slice(1)];
    return `#${mix(a.slice(0, 2), b.slice(0, 2))}${mix(a.slice(2, 4), b.slice(2, 4))}${mix(a.slice(4, 6), b.slice(4, 6))}`;
  }
  // The circuit drawn north-up (as the session map), coloured by speed or by sector, with the numbered corners.
  function trackMap(t, mode) {
    const pts = t.map?.outline || [];
    if (pts.length < 10) return el('p', 'season-muted', 'No map for this track.');
    const W = 620, H = 440, pad = 34;
    const xs = pts.map(p => p[0]), ys = pts.map(p => -p[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const k = Math.min((W - pad * 2) / (x1 - x0 || 1), (H - pad * 2) / (y1 - y0 || 1));
    const ox = (W - (x1 - x0) * k) / 2, oy = (H - (y1 - y0) * k) / 2;
    const X = x => ox + (x - x0) * k, Y = y => oy + (-y - y0) * k;
    const vLo = Math.min(...pts.map(p => p[2])), vHi = Math.max(...pts.map(p => p[2]));
    const total = t.length, step = total / pts.length;
    const sectorOf = i => { const d = i * step; return !t.sectors ? 0 : d < t.sectors[0].to ? 0 : d < t.sectors[1].to ? 1 : 2; };
    let svg = `<svg class="season-chart season-track-map" viewBox="0 0 ${W} ${H}" role="img" aria-label="Map of ${esc(t.circuit || 'the circuit')}">`;
    // A smooth outline: each piece runs from the midpoint before a sample to the midpoint after it, curving through the
    // sample (a quadratic curve), so the telemetry's ~10 m steps never show as corners; each piece takes its sample's colour.
    const P = pts.map(p => [X(p[0]), Y(p[1])]), n = P.length, f = v => v.toFixed(1);
    const midOf = (i, j) => [(P[i][0] + P[j][0]) / 2, (P[i][1] + P[j][1]) / 2];
    const piece = i => { const m1 = midOf(i, (i + 1) % n); return `Q${f(P[i][0])} ${f(P[i][1])} ${f(m1[0])} ${f(m1[1])}`; };
    const start = i => { const m0 = midOf((i - 1 + n) % n, i); return `M${f(m0[0])} ${f(m0[1])}`; };
    let base = '';
    for (let i = 0; i < n; i++) base += `${i ? '' : start(i)}${piece(i)}`;
    svg += `<path class="track-base" d="${base}Z"/>`;
    // FIA zones: the lap in one quiet stroke under the zones.
    if (mode === 'zones') svg += `<path class="track-seg is-quiet" d="${base}Z"/>`;
    else for (let i = 0; i < n; i++) {
      const colour = mode === 'sectors' ? SECTOR_COLOURS[sectorOf(i)] : rampColour((pts[i][2] - vLo) / (vHi - vLo || 1));
      svg += `<path class="track-seg" d="${start(i)}${piece(i)}" style="stroke:${colour}"/>`;
    }
    // The FIA's zones: each from its activation point to the first lift once flat out on the lap (or the next zone), with the
    // activation point and the Overtake (or DRS) detection and activation points as round markers.
    const zoneMarks = [];
    if (mode === 'zones') {
      const o = t.official;
      for (const z of o?.zones || []) {
        const from = (z.normal || z).i;
        if (from == null || z.i_to == null) continue;
        let d = start(from);
        for (let i = from, k = 0; k <= n; i = (i + 1) % n, k++) { d += piece(i); if (i === z.i_to) break; }
        const name = z.zone || `DRS ${z.number ?? ''}`.trim();
        svg += `<path class="track-zone" d="${d}"/>`;
        zoneMarks.push({i: from, cls: 'track-zone-start', tip: `${o.kind === 'drs' ? 'DRS activation' : `Straight mode ${name}`}\n${(z.normal || z).text}${z.length ? `\n${z.ends === 'data gap' ? 'at least ' : ''}${z.length} m flat out · top ${z.top_speed} km/h` : ''}`});
      }
      const points = o?.kind === 'drs' ? (o.detection || []).map(p => ['DRS detection', p]) : o?.overtake ? [['Overtake detection', o.overtake.detection], ['Overtake activation', o.overtake.activation]] : [];
      for (const [label, p] of points) if (p?.i != null) zoneMarks.push({i: p.i, cls: label.endsWith('detection') ? 'track-zone-detect' : 'track-zone-ot', tip: `${label}\n${p.text}`});
    }
    // Start/finish: a short bar across the first point.
    const [s0, s1] = [pts[0], pts[2]], dx = X(s1[0]) - X(s0[0]), dy = Y(s1[1]) - Y(s0[1]), len = Math.hypot(dx, dy) || 1;
    svg += `<line class="track-start" x1="${(X(s0[0]) - dy / len * 9).toFixed(1)}" y1="${(Y(s0[1]) + dx / len * 9).toFixed(1)}" x2="${(X(s0[0]) + dy / len * 9).toFixed(1)}" y2="${(Y(s0[1]) - dx / len * 9).toFixed(1)}"/>`;
    // Corner numbers: outside the track, along the outward normal at the nearest outline point.
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    for (const c of t.map.corners || []) {
      const info = t.corners.list.find(x => x.number === c.number);
      let near = 0, bestD = Infinity;
      pts.forEach((p, i) => { const d = (p[0] - c.x) ** 2 + (p[1] - c.y) ** 2; if (d < bestD) { bestD = d; near = i; } });
      const p = pts[near], q = pts[(near + 2) % pts.length], r = pts[(near - 2 + pts.length) % pts.length];
      let nx = -(Y(q[1]) - Y(r[1])), ny = X(q[0]) - X(r[0]); const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
      // Point the label away from the middle of the drawing.
      if ((X(p[0]) - X(cx)) * nx + (Y(p[1]) - Y(-cy)) * ny < 0) { nx = -nx; ny = -ny; }
      const lx = X(p[0]) + nx * 15, ly = Y(p[1]) + ny * 15;
      const tip = info ? `Turn ${c.number}\nApex  ${info.speed} km/h${info.gear ? ` · gear ${info.gear}` : ''}\n${CORNER_TYPE[info.type]} corner` : `Turn ${c.number}`;
      svg += `<g class="track-corner" data-tip="${esc(tip)}"><circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="8.5"/><text x="${lx.toFixed(1)}" y="${(ly + 3.4).toFixed(1)}" text-anchor="middle">${esc(c.number)}</text></g>`;
    }
    for (const m of zoneMarks) svg += `<g class="track-zone-mark ${m.cls}" data-tip="${esc(m.tip)}"><circle cx="${X(pts[m.i][0]).toFixed(1)}" cy="${Y(pts[m.i][1]).toFixed(1)}" r="${m.cls === 'track-zone-start' ? 4.5 : 4}"/></g>`;
    svg += '</svg>';
    const wrapEl = el('div', 'season-track-map-wrap'); wrapEl.append(htmlNode(svg));
    const key = el('div', 'season-track-key');
    const swatch = (cls, label) => { const s = el('span'); s.append(el('i', cls), label); key.append(s); };
    if (mode === 'zones') {
      const drs = t.official?.kind === 'drs';
      swatch('season-key-zone', drs ? 'DRS zone' : 'Straight mode zone');
      swatch('season-key-detect', drs ? 'DRS detection' : 'Overtake detection');
      if (!drs) swatch('season-key-ot', 'Overtake activation');
    } else if (mode === 'sectors') SECTOR_COLOURS.forEach((c, i) => { const s = el('span'); const d = el('i'); d.style.background = c; s.append(d, `Sector ${i + 1}`); key.append(s); });
    else { const bar = el('i', 'season-track-ramp'); bar.style.background = `linear-gradient(90deg, ${SPEED_RAMP.join(', ')})`; key.append(el('span', null, `${vLo} km/h`), bar, el('span', null, `${vHi} km/h`)); }
    wrapEl.append(key);
    return wrapEl;
  }
  // The FIA's zones for the track, from the Race Director's circuit map (t.official, scripts/build-track-profiles.mjs):
  // this season's Straight Mode zones and Overtake points, and last season's DRS zones on the same circuit, each as printed
  // with its place on the fastest qualifying lap. Nothing is shown for a map the FIA published only as an image.
  function officialZonesCard(t, repaint) {
    const o = t.official;
    const seasons = [o, o?.previous].filter(x => x?.source);
    if (!seasons.length) return null;
    const label = x => (x.kind === 'drs' ? `${x.year} DRS` : x.kind === 'straight-mode' ? `${x.year} straight mode` : `${x.year}`);
    const pick = seasons.find(x => x.year === state.trackZones) || seasons[0];
    const km = p => (p?.at != null ? `${(p.at / 1000).toFixed(2)} km` : '—');
    const box = card('Official zones');
    if (seasons.length > 1) {
      const pills = el('div', 'season-segment season-zone-toggle'); pills.setAttribute('role', 'group'); pills.setAttribute('aria-label', 'Season');
      for (const x of seasons) {
        const b = el('button', null, label(x)); b.type = 'button'; b.setAttribute('aria-pressed', String(x === pick));
        b.addEventListener('click', () => { if (x === pick) return; state.trackZones = x.year; repaint(); });
        pills.append(b);
      }
      box.append(pills);
    }
    // The FIA's own map, always visible (not behind Show explanations): the zones' starts are read from it.
    const link = el('a', 'season-track-source-link', `FIA circuit map · ${pick.year} ${pick.event.replace(' Grand Prix', ' GP')}`);
    link.href = pick.source; link.target = '_blank'; link.rel = 'noopener';
    link.append(el('span', 'visually-hidden', ' (PDF, opens in a new tab)'));
    const sourceLine = el('p', 'season-track-source');
    sourceLine.append(link);
    const drs = pick.kind === 'drs';
    const points = drs ? (pick.detection || []).map(p => [`Detection${p.number ? ` ${p.number}` : ''}`, p])
      : pick.overtake ? [['Overtake detection', pick.overtake.detection], ['Overtake activation', pick.overtake.activation]].filter(([, p]) => p) : [];
    if (!pick.readable || (!pick.zones?.length && !points.length)) {
      box.append(sourceLine, empty(!pick.readable ? 'The FIA published this map as an image only, so its zones are not read.' : 'The FIA map lists no zones for this event.'));
      return box;
    }
    if (pick.zones.length) sourceLine.append(el('span', 'season-muted', ' · starts as printed, ends estimated from the fastest qualifying lap'));
    box.append(sourceLine);
    const source = el('p', 'season-footnote');
    if (!pick.zones.length) box.append(el('p', 'season-muted', `No ${drs ? 'DRS' : 'straight mode'} zones at this event.`));
    const zt = el('table', 'season-table season-units season-track-zones');
    zt.innerHTML = `<thead><tr><th scope="col">Zone</th><th scope="col">Activation</th><th scope="col" class="num">From the line</th><th scope="col" class="num">Flat out</th><th scope="col" class="num">Top speed</th>${drs ? '' : '<th scope="col">Low grip</th>'}</tr></thead>`;
    const tb = el('tbody'), longest = Math.max(1, ...pick.zones.map(z => z.length || 0));
    for (const z of pick.zones) {
      const a = drs ? z : z.normal, tr = el('tr');
      const len = heatChip(el('td', 'num season-heat-cell', z.length ? `${z.ends === 'data gap' ? '≥ ' : ''}${z.length} m` : '—'));
      if (z.ends === 'data gap') len.title = 'At least: the lap\'s telemetry has a gap before the driver lifts'; if (z.length) len.style.setProperty('--heat', String(z.length / longest));
      tr.append(el('td', 'season-strong', drs ? `DRS ${z.number ?? ''}`.trim() : z.zone), el('td', null, a?.text || 'n/a'), el('td', 'num', km(a)), len,
        el('td', 'num', z.top_speed ? `${z.top_speed} km/h` : '—'));
      if (!drs) tr.append(el('td', null, z.low?.text || 'not used'));
      tb.append(tr);
    }
    zt.append(tb);
    if (pick.zones.length) box.append(wrap(zt));
    box.classList.add('season-data-section');   // a table section, like Sectors beside it
    if (points.length) {
      const pt = el('table', 'season-table season-units season-track-zone-points');
      pt.innerHTML = `<thead><tr><th scope="col">${drs ? 'DRS point' : 'Overtake point'}</th><th scope="col">As printed</th><th scope="col" class="num">From the line</th></tr></thead>`;
      const ptb = el('tbody');
      for (const [name, p] of points) { const tr = el('tr'); tr.append(el('td', 'season-strong', name), el('td', null, p.text), el('td', 'num', km(p))); ptb.append(tr); }
      pt.append(ptb);
      box.append(wrap(pt));
    }
    const unplaced = [...pick.zones.map(z => (drs ? z : z.normal)), ...points.map(([, p]) => p)].some(p => p && p.at == null);
    source.append(drs
      ? `DRS opens at each activation point for a car within a second of the one ahead at its detection point. `
      : `Straight mode opens the wings at each zone's activation point in normal grip; in low grip it opens later (or not at all). Overtake gives extra electrical energy to a car within a second at the detection point. `,
    `The FIA gives each zone's start only: its length here runs to the first lift or braking once flat out on the fastest qualifying lap, or to the next zone's start (≥: the lap's telemetry has a gap there, so the length is a minimum). Points are placed from the numbered corner they name${unplaced ? '; "—" where the wording names no corner on this lap' : ''}${pick.year !== t.official?.year ? `; ${pick.year} points shown on the ${t.official?.year ?? ''} lap` : ''}.`);
    box.append(source);
    return box;
  }
  function renderTracks(data, profiles) {
    const all = Object.entries(profiles?.tracks || {});
    if (!all.length) return [card(null, empty('No track profiles yet.'))];
    const roundOf = gp => data.rounds.find(r => r.name === gp || r.name.startsWith(gp + ' '));   // 'Bahrain Grand Prix in Malaysia'
    const ordered = all.sort(([a], [b]) => (roundOf(a)?.round ?? 99) - (roundOf(b)?.round ?? 99));
    const names = ordered.map(([gp]) => gp);
    if (!names.includes(state.track)) {
      const last = data.rounds.filter(r => r.status === 'done' && names.some(gp => roundOf(gp) === r)).at(-1);
      state.track = last ? names.find(gp => roundOf(gp) === last) : names[0];
    }
    const pick = state.track, t = profiles.tracks[pick], round = roundOf(pick);
    const repaint = () => { window.ApexUrl?.write('season', urlParams()); paint(() => renderTracks(data, profiles)); };
    // Picker: every measured track as flag and code, in round order.
    const picker = el('div', 'home-season-strip season-track-picker'); picker.style.setProperty('--n', String(ordered.length));
    picker.setAttribute('role', 'group'); picker.setAttribute('aria-label', 'Track');
    for (const [gp] of ordered) {
      const r = roundOf(gp), b = el('button', 'home-round season-track-choice'); b.type = 'button';
      b.setAttribute('aria-pressed', String(gp === pick));
      if (r) b.append(roundMark(r)); else b.append(el('small', null, gp.replace(' Grand Prix', '')));
      b.title = gp;
      b.addEventListener('click', () => { if (state.track === gp) return; state.track = gp; repaint(); });
      picker.append(b);
    }
    // Header: the circuit, the lap it was measured on, and the headline numbers.
    const head = el('section', 'season-card season-track-head');
    const title = el('div', 'season-track-title'), f = round && flag(round); if (f) title.append(f);
    title.append(el('h2', null, t.circuit || pick.replace(' Grand Prix', '')), el('span', 'season-muted', pick));
    const poleId = Object.keys(data.drivers).find(id => driverCode(data, id) === t.driver);
    const lap = el('div', 'season-track-lap'); if (poleId) lap.append(avatar(data, poleId));
    lap.append(el('span', null, `${poleId ? driverName(data, poleId) : t.driver} · ${lapTime(t.lap_time)}`), el('small', 'season-muted', 'fastest qualifying lap'));
    head.append(title, lap);
    const tiles = el('div', 'season-tiles season-track-tiles');
    const tile = (label, value, note) => { const x = el('div', 'season-tile'); x.append(el('span', 'season-muted', label), el('b', null, value)); if (note) x.append(el('small', 'season-muted', note)); tiles.append(x); };
    tile('Length', `${(t.length / 1000).toFixed(3)} km`);
    tile('Corners', String(t.corners.total), `${t.corners.slow} slow · ${t.corners.medium} medium · ${t.corners.fast} fast${t.corners.approximate ? ' (approx.)' : ''}`);
    tile('Average speed', `${Math.round(t.average_speed)} km/h`, `top ${t.top_speed} · lowest ${t.minimum_speed}`);
    tile('Full throttle', `${Math.round(t.full_throttle * 100)}%`, 'of the lap time');
    tile('Braking', `${Math.round(t.braking * 100)}%`, `${t.braking_zones} braking zones`);
    tile('Gear changes', String(t.gear_changes), 'on the lap');
    if (t.pit_loss?.normal) tile('Pit stop loss', `${t.pit_loss.normal.toFixed(1)} s`, `${t.pit_loss.vsc ? `VSC ${t.pit_loss.vsc.toFixed(1)} s · ` : ''}${t.pit_loss.sc ? `SC ${t.pit_loss.sc.toFixed(1)} s` : ''}`);
    if (t.compounds?.length) tile('Pirelli compounds', t.compounds.join(' · '), 'hard · medium · soft');
    if (t.conditions) tile('Conditions', `${Math.round(t.conditions.track)}° track`, `${Math.round(t.conditions.air)}° air${t.conditions.rain ? ' · rain' : ''}, at the lap`);
    tiles.style.setProperty('--tile-cols', String(Math.min(5, tiles.childElementCount)));
    head.append(tiles);
    // Map with Speed / Sectors pills.
    const o = t.official, hasZones = (o?.zones || []).some(z => (z.normal || z).i != null && z.i_to != null)
      || [o?.overtake?.detection, o?.overtake?.activation, ...(o?.detection || [])].some(p => p?.i != null);
    const mode = state.trackMap === 'sectors' && t.sectors ? 'sectors' : state.trackMap === 'zones' && hasZones ? 'zones' : 'speed';
    const mapPills = el('div', 'season-segment season-zone-toggle'); mapPills.setAttribute('role', 'group'); mapPills.setAttribute('aria-label', 'Colour the map by');
    for (const [id, label] of [['speed', 'Speed'], ['sectors', 'Sectors'], ['zones', 'FIA zones']]) {
      if ((id === 'sectors' && !t.sectors) || (id === 'zones' && !hasZones)) continue;
      const b = el('button', null, label); b.type = 'button'; b.setAttribute('aria-pressed', String(mode === id));
      b.addEventListener('click', () => { if (mode === id) return; state.trackMap = id; paint(() => renderTracks(data, profiles)); });
      mapPills.append(b);
    }
    const mapCard = card('Track map', mapPills, trackMap(t, mode), el('p', 'season-footnote', `The fastest qualifying lap's own path, north up; corner numbers ${t.corners.approximate ? 'are approximate (FIA map estimates)' : 'from the official circuit data'}, hover one for its apex speed.`));
    mapCard.classList.add('season-track-map-card');
    // Sectors and straights.
    const sideStack = el('div', 'season-stack');
    if (t.sectors) {
      const st = el('table', 'season-table season-units season-track-sectors');
      st.innerHTML = '<thead><tr><th scope="col">Sector</th><th scope="col" class="num">Time</th><th scope="col" class="num">Length</th><th scope="col" class="num">Average speed</th><th scope="col" class="num">Corners</th></tr></thead>';
      const tb = el('tbody');
      t.sectors.forEach((s, i) => {
        const tr = el('tr'), name = el('td'), dot = el('i', 'season-sector-dot'); dot.style.background = SECTOR_COLOURS[i]; name.append(dot, `Sector ${i + 1}`);
        const n = t.corners.list.filter(c => c.distance >= s.from && c.distance < s.to).length;
        tr.append(name, el('td', 'num', `${s.time.toFixed(3)} s`), el('td', 'num', `${((s.to - s.from) / 1000).toFixed(2)} km`), el('td', 'num', `${Math.round(s.average_speed)} km/h`), el('td', 'num', String(n)));
        tb.append(tr);
      });
      st.append(tb);
      sideStack.append(card('Sectors', wrap(st)));
    }
    const fia = officialZonesCard(t, () => paint(() => renderTracks(data, profiles)));
    if (fia) sideStack.append(fia);
    if (t.straights?.length) {
      const sr = el('table', 'season-table season-units season-track-straights');
      sr.innerHTML = '<thead><tr><th scope="col">Full throttle</th><th scope="col" class="num">Length</th><th scope="col" class="num">Entry</th><th scope="col" class="num">Top speed</th></tr></thead>';
      const tb = el('tbody'), longest = Math.max(...t.straights.map(s => s.length));
      for (const s of [...t.straights].sort((a, b) => b.length - a.length)) {
        const tr = el('tr'), len = heatChip(el('td', 'num season-heat-cell', `${s.length} m`)); len.style.setProperty('--heat', String(s.length / longest));
        const before = t.corners.list.filter(c => c.distance <= s.from).at(-1), after = t.corners.list.find(c => c.distance >= s.to);
        tr.append(el('td', null, `${before ? `T${before.number}` : 'Start'} → ${after ? `T${after.number}` : 'line'}`), len, el('td', 'num', `${s.entry_speed} km/h`), el('td', 'num', `${s.top_speed} km/h`));
        tb.append(tr);
      }
      sr.append(tb);
      sideStack.append(card('Full throttle stretches', wrap(sr), el('p', 'season-footnote', 'Our own measure, not the FIA\'s: stretches of the fastest qualifying lap flat out (throttle 98% or more) for at least 250 m, longest first; named by the corners either side.')));
    }
    const two = el('div', 'season-two season-track-two'); two.append(mapCard, sideStack);
    // Corners: the table in two halves side by side (first half of the lap, second half), so a long list stays short.
    const vs = t.corners.list.map(c => c.speed), cLo = Math.min(...vs), cHi = Math.max(...vs);
    const cornerTable = list => {
      const ct = el('table', 'season-table season-units season-track-corners');
      ct.innerHTML = '<thead><tr><th scope="col">Turn</th><th scope="col" class="num">Apex speed</th><th scope="col" class="num">Gear</th><th scope="col">Type</th><th scope="col" class="num">From the line</th></tr></thead>';
      const ctb = el('tbody');
      for (const c of list) {
        const tr = el('tr'), sp = heatChip(el('td', 'num season-heat-cell', `${c.speed} km/h`));
        if (cHi > cLo) sp.style.setProperty('--heat', String(1 - (c.speed - cLo) / (cHi - cLo)));
        const type = el('td'); type.append(el('span', `season-chip season-corner-${c.type}`, CORNER_TYPE[c.type]));
        tr.append(el('td', 'season-strong', `T${c.number}`), sp, el('td', 'num', c.gear ? String(c.gear) : '—'), type, el('td', 'num', `${(c.distance / 1000).toFixed(2)} km`));
        ctb.append(tr);
      }
      ct.append(ctb);
      return wrap(ct);
    };
    const half = Math.ceil(t.corners.list.length / 2), ct = el('div', 'season-two season-track-corner-halves');
    ct.append(cornerTable(t.corners.list.slice(0, half)), cornerTable(t.corners.list.slice(half)));
    const cornersCard = card('Corners', ct, el('p', 'season-footnote', `Every numbered corner at the lowest speed of the lap through it${t.corners.approximate ? ' (corner positions approximate)' : ''}; deeper shading is slower. Slow under 120 km/h, medium 120–200, fast over 200 (flat-out bends included).`));
    const history = round ? circuitProfile(data, round) : null;
    return [picker, head, ...(history ? [history] : []), two, cornersCard, trackComparison(data, profiles, pick, gp => { state.track = gp; repaint(); window.scrollTo({top: 0, behavior: 'smooth'}); })];
  }
  // Every track in one table: sortable columns, values shaded by where they sit in the column. A row opens that track.
  function trackComparison(data, profiles, pick, choose) {
    const all = Object.entries(profiles.tracks);
    const roundOf = gp => data.rounds.find(r => r.name === gp || r.name.startsWith(gp + ' '));   // 'Bahrain Grand Prix in Malaysia'
    const range = key => { const v = all.map(([, x]) => trackValue(x, key)); return [Math.min(...v), Math.max(...v)]; };
    const sort = state.trackSort || {key: null, dir: -1};
    const rows = [...all].sort(([ga, a], [gb, b]) => (sort.key ? sort.dir * (trackValue(a, sort.key) - trackValue(b, sort.key)) : (roundOf(ga)?.round ?? 99) - (roundOf(gb)?.round ?? 99)));
    const box = card('Every track compared');
    const redraw = () => { const next = trackComparison(data, profiles, pick, choose); box.replaceWith(next); markTips(next); };
    const table = el('table', 'season-table season-units season-tracks');
    const head = el('tr'), th0 = el('th', null, 'Track'); th0.scope = 'col'; head.append(th0);
    for (const [key, label] of TRACK_COLUMNS) {
      const th = el('th', 'num season-sortable'); th.scope = 'col';
      const b = el('button', 'season-sort-button', label); b.type = 'button'; b.setAttribute('aria-label', `Sort by ${label}`);
      if (sort.key === key) th.setAttribute('aria-sort', sort.dir === -1 ? 'descending' : 'ascending');
      b.addEventListener('click', () => { state.trackSort = sort.key !== key ? {key, dir: -1} : sort.dir === -1 ? {key, dir: 1} : {key: null, dir: -1}; redraw(); });
      th.append(b); head.append(th);
    }
    const thead = el('thead'); thead.append(head); table.append(thead);
    const tb = el('tbody');
    for (const [gp, x] of rows) {
      const tr = el('tr'); if (gp === pick) tr.classList.add('is-picked');
      const name = el('td'), b = el('button', 'season-row-toggle season-track-pick'); b.type = 'button'; b.setAttribute('aria-pressed', String(gp === pick));
      const r = roundOf(gp), fl = r && flag(r); if (fl) b.append(fl); b.append(el('span', null, x.circuit || gp.replace(' Grand Prix', '')));
      b.addEventListener('click', () => choose(gp));
      name.append(b); tr.append(name);
      for (const [key, , fmt] of TRACK_COLUMNS) {
        const v = trackValue(x, key), [lo, hi] = range(key), td = heatChip(el('td', 'num season-heat-cell', fmt(v)));
        if (hi > lo && v > lo) td.style.setProperty('--heat', String((v - lo) / (hi - lo)));
        tr.append(td);
      }
      tb.append(tr);
    }
    table.append(tb);
    box.append(wrap(table), el('p', 'season-footnote', `Measured on the fastest qualifying lap of ${profiles.year} at each track. Full throttle and braking are shares of the lap time. Corners are the numbered corners by apex speed: slow under 120 km/h, medium 120–200, fast over 200. Deeper shading: higher in that column. Choose a track to open it.`));
    return box;
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
    const forecastOk = !data.saved_at || Date.now() - Date.parse(data.saved_at) < 3 * 86400000;
    for (const x of next.sessions) {
      const at = new Date(x.start), li = el('li'); li.dataset.state = x === upcoming ? 'next' : at < now() ? 'done' : 'ahead';
      const name = el('span', null, x.name);
      if (li.dataset.state === 'done') name.prepend(htmlNode('<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7"/></svg>'));
      if (li.dataset.state === 'next') name.append(el('em', null, 'Next'));
      const stamp = el('time', null, clock(x)); stamp.dateTime = x.start;
      li.append(name, stamp);
      // The session's own forecast (its two hours) when the data has it, otherwise that day's.
      const own = forecastOk && x.weather?.temp != null ? x.weather : null;
      const day = !own && forecastOk && data.next_weather?.find(d => d.date === x.start.slice(0, 10));
      if (own || day) {
        const f = own || day, w = el('span', 'season-session-weather'); const icon = weatherIcon(f.code);
        icon.dataset.kind = f.code >= 95 ? 'storm' : f.rain >= 50 ? 'wet' : f.code <= 2 ? 'sun' : 'cloud';
        w.append(icon, el('span', null, own ? `${Math.round(own.temp)}°` : `${Math.round(day.min)}–${Math.round(day.max)}°`), el('span', f.rain >= 50 ? 'is-wet' : null, `${f.rain ?? 0}% rain`));
        w.title = own ? `Forecast for the session: ${Math.round(own.temp)}°, ${own.rain ?? 0}% chance of rain, wind ${Math.round(own.wind ?? 0)} km/h`
          : `Forecast for that day: ${Math.round(day.max)}° high, ${Math.round(day.min)}° low, ${day.rain ?? 0}% chance of rain, wind ${Math.round(day.wind)} km/h`;
        li.append(w);
      }
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
    // A forecast saved more than three days ago is out of date: leave it out rather than show old weather; between one and
    // three days it is shown with the date it was made.
    const forecastAge = data.saved_at ? Date.now() - Date.parse(data.saved_at) : 0;
    const forecastFresh = forecastAge < 3 * 86400000;
    if (data.next_weather?.length && forecastFresh) {
      const sky = code => code == null ? '' : code === 0 ? 'Clear' : code <= 2 ? 'Partly cloudy' : code === 3 ? 'Cloudy' : code <= 48 ? 'Fog' : code <= 57 ? 'Drizzle' : code <= 67 ? 'Rain' : code <= 77 ? 'Snow' : code <= 82 ? 'Showers' : 'Thunderstorms';
      const forecast = el('div', 'season-weather');
      forecast.append(el('h3', null, 'Weekend forecast'));
      if (forecastAge > 86400000) forecast.append(el('p', 'season-muted season-weather-range', `Forecast from ${new Date(data.saved_at).toLocaleDateString([], {day: 'numeric', month: 'short'})}.`));
      // Beyond about a week a forecast is a rough guide: say so rather than show it with the same confidence as tomorrow's.
      const daysAhead = (Date.parse(`${data.next_weather[0].date}T12:00:00`) - Date.now()) / 86400000;
      if (daysAhead > 7) forecast.append(el('p', 'season-muted season-weather-range', 'Long-range forecast: likely to change.'));
      // One Linear list row per session when each has its own forecast (its two hours), otherwise one per day, under quiet
      // column labels: session or day, sky, temperature, chance of rain, wind.
      const list = el('div', 'season-forecast');
      const header = el('div', 'season-forecast-head');
      const bySession = next.sessions.filter(x => x.weather?.temp != null);
      header.append(el('span', null, bySession.length ? 'Session' : 'Day'), el('span'), el('span', null, bySession.length ? 'Temp' : 'High / low'), el('span', null, 'Rain'), el('span', null, 'Wind'));
      if (bySession.some(x => x.weather.humidity != null)) header.append(el('span', null, 'Humidity'));
      list.append(header);
      if (bySession.length) list.classList.add('is-sessions');
      for (const x of bySession) {
        const w = x.weather, row = el('div', 'season-forecast-row'); row.dataset.wet = String(w.rain >= 50);
        row.title = `${x.name} \u00b7 ${sky(w.code)} \u00b7 ${Math.round(w.temp)}\u00b0 \u00b7 ${w.rain ?? 0}% chance of rain \u00b7 wind ${Math.round(w.wind ?? 0)} km/h`;
        const icon = weatherIcon(w.code); icon.dataset.kind = w.code >= 95 ? 'storm' : w.rain >= 50 ? 'wet' : w.code <= 2 ? 'sun' : 'cloud';
        const temp = el('span', 'season-forecast-temp'); temp.append(el('b', null, `${Math.round(w.temp)}\u00b0`));
        const short = x.name.replace('Practice ', 'FP').replace('Sprint Qualifying', 'Sprint quali');
        // Wind: speed with an arrow pointing where it blows to (the forecast gives where it comes from), gusts on hover.
        const wind = el('span', 'season-forecast-wind');
        if (w.direction != null) { const arrow = htmlNode(`<svg class="season-wind-arrow" viewBox="0 0 12 12" width="11" height="11" aria-hidden="true" style="transform:rotate(${(w.direction + 180) % 360}deg)"><path d="M6 1.5v9M2.8 4.7 6 1.5l3.2 3.2" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`); wind.append(arrow); }
        wind.append(`${Math.round(w.wind ?? 0)} km/h`);
        const compass = d => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(d / 45) % 8];
        wind.title = `Wind ${Math.round(w.wind ?? 0)} km/h${w.direction != null ? ` from the ${compass(w.direction)}` : ''}${w.gust != null ? `, gusts to ${Math.round(w.gust)} km/h` : ''}`;
        const rainCell = el('span', 'season-forecast-rain', `${w.rain ?? 0}%`);
        if (w.mm) rainCell.append(el('small', 'season-muted', ` ${w.mm} mm`));
        row.append(el('span', 'season-forecast-day', short), icon, temp, rainCell, wind);
        if (w.humidity != null) row.append(el('span', 'season-forecast-humid', `${w.humidity}%`));
        list.append(row);
      }
      for (const d of bySession.length ? [] : data.next_weather) {
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
    out.push(seasonNumbers(data), grid);
    // Two columns of stacked cards, paired so the columns come out about the same length (the last card in each
    // stretches to meet the other), rather than side-by-side pairs of very different heights.
    // Results is about the Grands Prix: the season's numbers, then the race-by-race table. Wins moved to Standings;
    // retirements by team are in Power units' reliability table, and pit crews in Car performance > Pit stops.
    out.push(gpResults(data));
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
  const wrap = node => { const w = el('div', 'season-table-wrap'); w.append(node); return w; };
  // Grand Prix results in two views: Race (podium, fastest lap, sprint winner, margin) and Qualifying (the front row,
  // pole lap, gaps, the Q3 cut and sprint pole). A row opens that session's full classification.
  function gpResults(data) {
    const session = ['qualifying', 'sprint', 'sprintq'].includes(state.resultsSession) ? state.resultsSession : 'race';
    const sprintOnly = session === 'sprint' || session === 'sprintq';
    // Sprint qualifying times come from each sprint weekend's captured session, loaded when the pill is chosen.
    const sq = session === 'sprintq' ? sprintQualifying.get(data.year) : null;
    if (session === 'sprintq' && !sq) {
      loadSprintQualifying(data).then(() => { if (state.resultsSession === 'sprintq') paint(() => renderResults(data)); });
    }
    const rows = data.winners.map(w => [w, data.rounds.find(x => x.round === w.round)])
      .filter(([, r]) => r?.status === 'done' && (sprintOnly ? r.sprint?.length : session === 'race' || r.qualifying.length));
    const heads = session === 'race'
      ? ['Winner', 'Second', 'Third', 'Fastest lap', 'Sprint', ['Margin', 'num']]
      : session === 'sprint' ? ['Winner', 'Second', 'Third', 'Fastest lap', ['Margin', 'num']]
      : session === 'sprintq' ? ['Sprint pole', 'Second', 'Third', ['Pole lap', 'num'], ['Gap to P2', 'num']]
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
      if (session === 'sprint') {
        const at = p => r.sprint.find(x => x.position === p)?.driver, second = r.sprint.find(x => x.position === 2);
        tr.append(cell(at(1)), cell(at(2)), cell(at(3)), cell(r.sprint.find(x => x.fastest_lap_rank === 1)?.driver),
          el('td', 'num', /^\+/.test(second?.gap || '') ? `${second.gap.replace(/^\+/, '')} s` : '—'));
      } else if (session === 'sprintq') {
        const order = sq?.get(r.round) || [], at = p => order.find(x => x.position === p);
        const byCode = code => Object.keys(data.drivers).find(id => data.drivers[id].code === code);
        const pole = at(1), second = at(2);
        tr.append(cell(pole && byCode(pole.code)), cell(second && byCode(second.code)), cell(at(3) && byCode(at(3).code)),
          el('td', 'num', pole?.best ? lapTime(pole.best) : sq ? '—' : '…'),
          el('td', 'num', pole?.best && second?.best ? `+${(second.best - pole.best).toFixed(3)} s` : sq ? '—' : '…'));
      } else if (session === 'race') {
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
        if (session === 'sprint') td.append(classification(data, {...r, race: r.sprint}));
        else if (session === 'sprintq') td.append(sprintQualifyingClassification(data, sq?.get(r.round) || []));
        else td.append(session === 'qualifying' ? qualifyingClassification(data, r) : classification(data, r));
        if (session === 'race') td.append(raceReport(data, r));
        detail.append(td); tbody.append(detail);
      }
    }
    table.append(tbody);
    const pills = el('div', 'season-segment season-zone-toggle'); pills.setAttribute('role', 'group'); pills.setAttribute('aria-label', 'Session');
    const sessions = [['race', 'Race'], ['qualifying', 'Qualifying']];
    if (data.rounds.some(r => r.sprint?.length)) sessions.push(['sprint', 'Sprint'], ['sprintq', 'Sprint qualifying']);
    for (const [id, label] of sessions) {
      const b = el('button', null, label); b.type = 'button'; b.setAttribute('aria-pressed', String(session === id));
      b.addEventListener('click', () => { if (session === id) return; state.resultsSession = id; state.expanded = null; paint(() => renderResults(data)); });
      pills.append(b);
    }
    const note = {race: 'Select a race for its classification and race report.', sprint: 'Select a sprint for its classification.',
      sprintq: 'Select a sprint weekend for the full sprint qualifying order and each driver’s best lap.',
      qualifying: 'Select a round for the full qualifying result, Q1 to Q3. Q3 cut: the slowest Q2 lap that still reached Q3.'}[session];
    return card('Grand Prix results', pills, el('p', 'season-footnote', note), wrap(table));
  }
  const lapTime = t => { const m = Math.floor(t / 60); return `${m}:${(t - m * 60).toFixed(3).padStart(6, '0')}`; };
  // Sprint qualifying: each sprint weekend's captured session, its classification and every driver's best timed lap.
  const sprintQualifying = new Map();
  function loadSprintQualifying(data) {
    const year = data.year, request = window.apexDataRequest;
    if (sprintQualifying.get(year) || typeof request !== 'function') return Promise.resolve();
    return seasonEvents(year).then(events => Promise.all(data.rounds.filter(r => r.sprint?.length).map(async r => {
      const event = events.find(e => e.round === r.round);
      if (!event) return [r.round, []];
      const session = await request('/api/session?' + new URLSearchParams({year, gp: event.name, session: 'Sprint Qualifying', round: r.round})).catch(() => null);
      const rows = (session?.drivers || []).map(d => {
        const laps = (d.laps || []).filter(l => Number.isFinite(l.time) && l.time > 0 && !l.deleted && !l.in_lap && !l.out_lap);
        // Best lap in each part (SQ1, SQ2, SQ3 come through as Q1-Q3 phases) and overall.
        const part = k => { const t = laps.filter(l => l.phase === k).map(l => l.time); return t.length ? Math.min(...t) : null; };
        return {code: d.code, position: d.position, best: laps.length ? Math.min(...laps.map(l => l.time)) : null, q1: part('Q1'), q2: part('Q2'), q3: part('Q3')};
      }).filter(x => x.position);
      return [r.round, rows.sort((a, b) => a.position - b.position)];
    }))).then(entries => { sprintQualifying.set(year, new Map(entries)); });
  }
  function sprintQualifyingClassification(data, rows) {
    const t = el('table', 'season-table season-mini');
    // As the Grand Prix qualifying table: every part each driver ran, and the gap to pole in the last part they reached.
    const parts = rows.some(x => x.q1 || x.q2 || x.q3);
    const head = el('tr'); head.append(el('th', 'num', 'Pos'), el('th', null, 'Driver'));
    if (parts) head.append(el('th', 'num', 'SQ1'), el('th', 'num', 'SQ2'), el('th', 'num', 'SQ3')); else head.append(el('th', 'num', 'Best lap'));
    head.append(el('th', 'num', 'Gap'));
    const thead = el('thead'); thead.append(head); t.append(thead);
    const tb = el('tbody'), pole = rows[0];
    for (const x of rows) {
      const id = Object.keys(data.drivers).find(k => data.drivers[k].code === x.code), tr = el('tr'), name = el('td');
      name.append(id ? who(data, id) : el('strong', null, x.code));
      const part = x.q3 ? 'q3' : x.q2 ? 'q2' : x.q1 ? 'q1' : 'best', mine = x[part], ref = pole?.[part];
      tr.append(el('td', 'num', String(x.position)), name);
      if (parts) tr.append(...['q1', 'q2', 'q3'].map(k => el('td', 'num', x[k] ? lapTime(x[k]) : '')));
      else tr.append(el('td', 'num', x.best ? lapTime(x.best) : '—'));
      tr.append(el('td', 'num season-muted', x.position === 1 ? 'pole' : mine && ref ? `+${(mine - ref).toFixed(3)}` : ''));
      tb.append(tr);
    }
    t.append(tb);
    return rows.length ? wrap(t) : el('p', 'season-muted', 'No sprint qualifying data for this weekend yet.');
  }

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
      // Stints: consecutive laps on one stint number. Its compound is the one its laps report (a lap the feed left blank takes
      // the stint's known compound); a set whose first lap is already past age 1 was used before (qualifying or an earlier run).
      const known = c => (c && c !== 'UNKNOWN' && c !== 'NONE' ? c : null);
      const stintsOf = d => {
        const out = [];
        for (const lap of d.laps) {
          const last = out.at(-1), c = known(String(lap.compound || '').toUpperCase());
          if (last && last.stint === lap.stint) { last.laps++; if (c) last.seen[c] = (last.seen[c] || 0) + 1; }
          else out.push({stint: lap.stint, laps: 1, from: lap.lap, age: lap.tyre_life, seen: c ? {[c]: 1} : {}});
        }
        for (const st of out) {
          st.compound = Object.entries(st.seen).sort((x, y) => y[1] - x[1])[0]?.[0] || '';
          st.used = Number.isFinite(st.age) && st.age > 1;
        }
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
          const seg = el('span', `${s.used ? 'is-used' : 'is-new'}${s.compound ? '' : ' is-unknown'}`, s.laps >= 4 ? String(s.laps) : '');
          seg.style.flexGrow = String(s.laps); if (s.compound) seg.style.setProperty('--tyre', TYRE[s.compound] || 'var(--ui-tertiary)');
          seg.title = `${s.compound ? s.compound.charAt(0) + s.compound.slice(1).toLowerCase() : 'Compound not in the timing feed'} · ${s.used ? `used set (${s.age - 1} laps old at the start)` : 'new set'} · ${s.laps} laps from lap ${s.from}`;
          bar.append(seg);
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
      const tyres = el('div', 'season-legend season-tyre-key');
      const all = rows.flatMap(stintsOf);
      for (const [k, c] of Object.entries(TYRE)) { if (!all.some(s => s.compound === k)) continue; const s = el('span', null, k.charAt(0) + k.slice(1).toLowerCase()); s.dataset.tone = 'custom'; s.style.setProperty('--tone', c); tyres.append(s); }
      const sw = (cls, label) => { const s = el('span', `season-tyre-swatch ${cls}`, label); tyres.append(s); };
      sw('is-new', 'New set'); sw('is-used', 'Used set');
      if (all.some(s => !s.compound)) sw('is-unknown', 'Compound not in the timing feed');
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
    const standingsColumn = el('div', 'season-stack'); standingsColumn.append(card('Championship standings', wrap(table)), titleFight(data, drivers));
    layout.append(standingsColumn, el('div', 'season-stack'));
    layout.lastChild.append(card('Points evolution', points), card('Championship position', ranks));
    linkHover(layout);
    // Drivers: finishing positions or points per round, switched in place (the choice is kept while the page is open).
    if (!state.matrix) state.matrix = 'points';
    const showPoints = () => !drivers || state.matrix === 'points', showQuali = () => drivers && state.matrix === 'qualifying';
    const note = () => showQuali() ? 'Grand Prix qualifying position (before grid penalties). Purple pole, light into Q3, grey out before Q3; the last columns are the mean and the median.'
      : showPoints() ? 'Points scored at each Grand Prix weekend, sprint included; deeper colour means more points.'
      : 'Grand Prix finishing position; a small number is the sprint result when it scored. Purple win, green podium, light points, red not classified. Mean and median over classified finishes.';
    let grid = resultsMatrix(data, drivers, last, showPoints(), showQuali());
    const foot = el('p', 'season-footnote', note());
    let matrixToggle = null;
    if (drivers) {
      matrixToggle = el('div', 'season-segment season-zone-toggle'); matrixToggle.setAttribute('role', 'group'); matrixToggle.setAttribute('aria-label', 'Show by round');
      for (const [id, label] of [['points', 'Points'], ['position', 'Positions'], ['qualifying', 'Qualifying']]) {
        const b = el('button', null, label); b.type = 'button'; b.dataset.mode = id; b.setAttribute('aria-pressed', String(state.matrix === id));
        b.addEventListener('click', () => {
          if (state.matrix === id) return;
          state.matrix = id;
          matrixToggle.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.mode === id)));
          const next = resultsMatrix(data, drivers, last, showPoints(), showQuali()); grid.replaceWith(next); grid = next; foot.textContent = note();
        });
        matrixToggle.append(b);
      }
    }
    const matrix = card(drivers ? 'Results by round' : 'Points by round', ...[matrixToggle, grid, foot].filter(Boolean));
    return [toggle, layout, matrix].filter(Boolean);
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
  // quali: each round's qualifying position instead (purple pole, light into Q3, grey out before Q3).
  function resultsMatrix(data, drivers, table, points = !drivers, quali = false) {
    const key = drivers ? 'driver' : 'team';
    const rounds = data.rounds;
    const t = el('table', 'season-table season-matrix season-grid');
    const head = el('tr'); head.append(el('th', null, drivers ? 'Driver' : 'Constructor'));
    for (const r of rounds) { const th = el('th', 'num'); th.append(roundMark(r)); head.append(th); }
    if (points) head.append(el('th', 'num', 'Pts')); else head.append(el('th', 'num', 'Mean'), el('th', 'num', 'Median'));
    const thead = el('thead'); thead.append(head); t.append(thead);
    const tb = el('tbody');
    const maxPoints = points ? Math.max(1, ...rounds.flatMap(r => table.map(e => roundPoints(r, key, e.id)))) : 1;
    for (const e of table) {
      const tr = el('tr'); tr.dataset.id = e.id;
      const name = el('th'); name.append(drivers ? who(data, e.id, {code: true, team: false}) : teamTag(data, e.id)); tr.append(name);
      for (const r of rounds) {
        if (notRun(r)) { tr.append(upcomingCell(r)); continue; }
        const td = el('td', 'num');
        if (quali) {
          const q = r.qualifying.find(x => x.driver === e.id);
          if (q) {
            td.dataset.tone = !q.position ? 'out' : q.position === 1 ? 'win' : q.position <= 10 ? 'points' : 'none';
            td.append(el('span', null, q.position ? String(q.position) : '–'));
            td.title = `${r.name}: qualified ${q.position ? 'P' + q.position : 'without a time'}`;
          }
        } else if (!points) {
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
      if (points) tr.append(el('td', 'num season-strong', String(e.points)));
      else {
        // Qualifying position, or Grand Prix finishing place (classified finishes), over the season: mean and median.
        const places = rounds.map(r => (quali ? r.qualifying : r.race).find(x => x.driver === e.id)?.position).filter(Number.isFinite);
        const mid = median(places);
        tr.append(el('td', 'num season-strong', places.length ? (places.reduce((a, b) => a + b, 0) / places.length).toFixed(1) : '—'),
          el('td', 'num season-strong', mid == null ? '—' : (Number.isInteger(mid) ? String(mid) : mid.toFixed(1))));
      }
      tb.append(tr);
    }
    t.append(tb);
    return wrap(t);
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
  // Every value explanation uses the value card, not the browser's slow native tooltip: a data element's title moves to
  // data-tip (controls keep theirs). One tab stop per chart, table or bar group; arrows move within it.
  const TIP_GROUP = 'svg,.season-dist,table,.season-stint-bar,.season-report-facts,.season-strip,.season-h2h-weeks,.season-bars,.season-ranked';
  function markTips(root) {
    for (const node of root.querySelectorAll('[title]')) {
      if (node.closest('button, a, select, input, summary, label, .season-sort-button') || node.closest('svg') && node.tagName === 'title') continue;
      node.dataset.tip = node.title; node.removeAttribute('title');
    }
    for (const mark of root.querySelectorAll('[data-tip]')) {
      const plot = mark.closest(TIP_GROUP) || mark.parentElement;
      mark.setAttribute('tabindex', mark === plot.querySelector('[data-tip]') ? '0' : '-1');
      if (mark.closest('svg,.season-dist')) {   // a chart mark: an image named by its value card, the plot a group
        mark.setAttribute('role', 'img');
        mark.setAttribute('aria-label', mark.dataset.tip.replaceAll('\n', ', '));
        plot.setAttribute('role', 'group');
      } else mark.setAttribute('aria-description', mark.dataset.tip.replaceAll('\n', ', '));   // a cell keeps its own content
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
      // The first line heads the card; a "label  value" line (two spaces apart) is a row of two aligned columns.
      tipCard.replaceChildren(el('b', null, head), ...rest.map(line => {
        const [k, ...v] = line.split(/\s{2,}/);
        if (!v.length) return el('span', null, line);
        const row = el('span', 'season-tip-row'); row.append(el('span', null, k), el('span', null, v.join('  '))); return row;
      }));
      tipCard.hidden = false;
      const w = tipCard.offsetWidth, h = tipCard.offsetHeight;
      tipCard.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, x + 14))}px`;
      // Above the pointer when it fits, otherwise below it: the card stays next to what it describes.
      const above = y - h - 12, below = y + 18;
      tipCard.style.top = `${Math.max(8, Math.min(innerHeight - h - 8, above >= 8 ? above : below))}px`;
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
      const marks = [...(mark.closest(TIP_GROUP) || mark.parentElement).querySelectorAll('[data-tip]')], index = marks.indexOf(mark);
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
  // area: a soft fill between each line and the zero line (as the season battle log), for a few series only.
  function lineChart(rounds, series, {title = '', invert = false, height = 260, width = 640, min = null, max = null, format = v => String(v), endLabels = 0, area = false} = {}) {
    // Every series is drawn in its team colour and named at its end (teammates dashed); with many series the chart grows so
    // the names, 13 px apart, never collide, and the points shrink so the lines stay readable.
    const named = endLabels && series.length > 1, dense = series.length > 8;
    const W = width, H = named ? Math.max(height, series.length * 19 + 60) : height, R = series.length === 1 ? 44 : named ? 52 : 12, T = 12, B = 48;
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
      if (area && series.length <= 3) {
        const base = y(Math.max(lo, Math.min(hi, 0))).toFixed(1);
        svg += `<path class="line-area" style="fill:${esc(s.colour)}" d="${d}L${pts.at(-1)[0].toFixed(1)} ${base}L${pts[0][0].toFixed(1)} ${base}Z"/>`;
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
  // Qualifying pace per round, like for like: each driver's lap in the last part they ran (Q3, Q2 or Q1) as a % gap to the
  // fastest lap in that same part, so a wet Q1 is never measured against a dry Q3 pole. A part reached only by eliminating
  // others keeps its own reference: a Q1 exit is compared with the Q1 benchmark. Laps over 107% of that benchmark (the
  // sport's own line for an unrepresentative lap) are left out.
  function qualiGapsByRound(done) {
    const quali = {};
    for (const r of done) {
      const parts = ['q3', 'q2', 'q1'], fastest = Object.fromEntries(parts.map(k => [k, Math.min(...r.qualifying.map(q => q[k]).filter(Number.isFinite))]));
      const rows = r.qualifying.map(q => { const k = parts.find(p => Number.isFinite(q[p])); return k && Number.isFinite(fastest[k]) ? [q.driver, q[k] / fastest[k]] : null; }).filter(Boolean);
      if (rows.length) quali[r.round] = Object.fromEntries(rows.filter(([, ratio]) => ratio <= 1.07).map(([d, ratio]) => [d, (ratio - 1) * 100]));
    }
    return quali;
  }
  const poleSeconds = r => Math.min(...r.qualifying.flatMap(q => [q.q1, q.q2, q.q3]).filter(Number.isFinite));
  // A driver's own outliers: rounds far above their typical gap (no real attempt before a grid penalty, damage, a car stuck
  // in the garage) are left out of their pace. A genuinely poor weekend is not an outlier: a round is left out only when it
  // is more than 2% of a lap (about 1.8 s on a 90 s lap) beyond the driver's median and also well outside their usual
  // spread (four times the median absolute deviation, scaled to a standard deviation). Returns {kept, dropped}.
  function trimOutliers(points) {
    if (points.length < 4) return {kept: points, dropped: []};
    const vals = points.map(([, v]) => v), med = median(vals), mad = median(vals.map(v => Math.abs(v - med)));
    const limit = med + Math.max(2, 4 * 1.4826 * mad);
    return {kept: points.filter(([, v]) => v <= limit), dropped: points.filter(([, v]) => v > limit)};
  }
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
      const seriesAll = id => rounds.filter(n => Number.isFinite(perRound[n][id])).map(n => [n, perRound[n][id]]);
      const series = id => trimOutliers(seriesAll(id)).kept;
      const toSeconds = ([n, pct]) => [n, pct / 100 * (Number.isFinite(poleTime[n]) ? poleTime[n] : 90)];
      const rankBy = upTo => ids.map(id => [id, rolling(series(id).filter(([n]) => n <= upTo).map(toSeconds))])
        .filter(([, v]) => v != null).sort((a, b) => a[1] - b[1]).map(([id]) => id);
      const last = rounds.at(-1), prev = rounds.at(-2);
      const now = rankBy(last), before = prev ? rankBy(prev) : [];
      const rows = now.map(id => {
        const pts = series(id), secs = pts.map(toSeconds), dropped = trimOutliers(seriesAll(id)).dropped;
        return {id, roll: rolling(secs), season: secs.reduce((a, [, v]) => a + v, 0) / secs.length, pct: rolling(pts), n: pts.length, secs, dropped,
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
        const cell = el('td', 'season-form-pace'); cell.title = `On average +${r.raw.toFixed(3)} s (+${r.pct.toFixed(2)}%) to each round’s quickest, weighted to recent rounds (${r.n} rounds)${r.dropped.length ? `
Left out as unrepresentative: ${r.dropped.map(([n, v]) => `${code(n)} +${v.toFixed(2)}%`).join(', ')}` : ''}`;
        cell.append(el('b', null, r.roll < 0.0005 ? 'quickest' : `+${r.roll.toFixed(3)}`), bar);
        const trend = el('td', 'season-form-trend'); trend.append(sparkline(r.secs.map(([, v]) => v), colour));
        trend.title = [`${driverCode(data, r.id)} · gap to each round’s quickest`, ...r.secs.map(([n, v]) => `${code(n)}  ${v < 0.0005 ? 'quickest' : '+' + v.toFixed(3) + ' s'}`)].join('\n');
        const move = el('td', `num season-form-move${r.move > 0 ? ' is-up' : r.move < 0 ? ' is-down' : ''}`, r.move > 0 ? `▲${r.move}` : r.move < 0 ? `▼${-r.move}` : '–');
        const name = el('td'); name.append(who(data, r.id, {team: false}));
        tr.append(el('td', 'num season-muted', String(i + 1)), name, cell, el('td', 'num', r.season < 0.0005 ? 'quickest' : `+${r.season.toFixed(3)}`), trend, move);
        tb.append(tr);
      });
      tbl.append(tb);
      return card(title, wrap(tbl), el('p', 'season-footnote', note));
    };
    const racePace = form && Object.keys(form.race).length
      ? paceTable('Race pace', form.race, `Each driver’s clean-air race pace (Car performance’s race analysis) as a gap to the quickest driver in that race, in seconds on that weekend’s pole lap. Rolling pace weighs recent races more (each earlier race counts ${ROLLING_DECAY} of the next); Season is the plain average; both read from the quickest driver on that measure. A race far outside a driver’s usual gap (damage, a stricken car) is left out of their figures; hover a value for which. Move: places gained or lost since the previous race.${form.failed ? ` ${form.failed} race${form.failed === 1 ? ' is' : 's are'} not analysed yet and not counted.` : ''}`)
      : card('Race pace', empty('The race pace analysis is not available here yet.'));
    const qualiPace = paceTable('Qualifying pace', quali, 'Each driver’s lap in the last part of qualifying they ran, against the fastest lap in that same part (so changing conditions between Q1 and Q3 do not count), in seconds. Laps over 107% are left out, and so is a session far outside a driver’s usual gap (no real attempt before a grid penalty, a car that stopped); hover a value for which. Rolling and Season as for race pace.')
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
    const two = el('div', 'season-two season-form-pair'); two.append(racePace, qualiPace);
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
  // Form's data for this season, kept for repaints (choosing a driver redraws the page without loading it again).
  let driversForm = null;
  function renderDrivers(data, form = null) {
    if (form) driversForm = {year: data.year, form}; else if (driversForm?.year === data.year) form = driversForm.form;
    const order = data.standings.drivers.at(-1)?.table.map(e => e.id) || Object.keys(data.drivers);
    if (!state.driver || !data.drivers[state.driver]) state.driver = order[0];
    const id = state.driver, s = data.driver_stats[id];
    if (!s) return [empty('No races yet this season.')];
    const pick = driverPicker(data, id, value => { state.driver = value; window.ApexUrl?.write('season', urlParams()); paint(() => renderDrivers(data)); });
    const standing = data.standings.drivers.at(-1)?.table.find(e => e.id === id);
    const table = data.standings.drivers.at(-1)?.table || [];
    const ahead = standing && table[standing.position - 2], behind = standing && table[standing.position];
    const mate = mainPair(data, id);
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
    tile('Average grid', s.average_grid != null ? s.average_grid.toFixed(2) : '—', 'start position, after penalties');
    {
      const qs = data.rounds.map(r => r.qualifying.find(x => x.driver === id)?.position).filter(Number.isFinite), mq = median(qs);
      if (qs.length) tile('Average qualifying', (qs.reduce((x, y) => x + y, 0) / qs.length).toFixed(2), `median P${Number.isInteger(mq) ? mq : mq.toFixed(1)}, before penalties`);
    }
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
    }).concat(driverExtras(data, id, mateId), fieldTable(data), form ? renderForm(data, form) : []);
  }
  const FIELD_STATS = {
    race: [['points', 'Points'], ['wins', 'Wins'], ['podiums', 'Podiums'], ['points_finishes', 'Points finishes'], ['average_finish', 'Average finish', true, 2],
      ['average_result', 'Average result', true, 2], ['finish_rate', 'Finish rate', false, 'pct'], ['retirements', 'Retirements', true], ['sprint_points', 'Sprint points'], ['gained', 'Places gained']],
    qualifying: [['poles', 'Poles'], ['front_rows', 'Front rows'], ['q3', 'Q3 appearances'], ['average_grid', 'Average grid', true, 2], ['best_qualifying', 'Best qualifying', true, 'P']],
  };
  function fieldTable(data) {
    // Every driver, every stat: a table in the Reliability look. Race or Qualifying pills choose the columns; each value
    // sits in a chip shaded by where it ranks in its column (deeper is better; for lower-is-better stats, lower is deeper).
    // Headers sort (best first, again for worst first, a third time back to points order). A row opens that driver above.
    const group = state.fieldGroup === 'qualifying' ? 'qualifying' : 'race';
    const stats = FIELD_STATS[group];
    const valueOf = (st, key) => key === 'gained'
      ? st.by_round.reduce((sum, r) => { const n = Number(r.finish); return sum + (r.grid && Number.isFinite(n) ? r.grid - n : 0); }, 0)
      : st[key];
    const show = (stat, v) => { const [key, , , fmt] = stat; if (!Number.isFinite(v)) return '—';
      return fmt === 'pct' ? `${Math.round(v * 100)}%` : fmt === 'P' ? `P${v}` : typeof fmt === 'number' ? v.toFixed(fmt) : key === 'gained' ? `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)}` : String(v); };
    const drivers = Object.entries(data.driver_stats).filter(([, st]) => st.starts);
    const range = stats.map(stat => { const v = drivers.map(([, st]) => valueOf(st, stat[0])).filter(Number.isFinite); return v.length ? [Math.min(...v), Math.max(...v)] : null; });
    const sort = state.fieldSort?.group === group ? state.fieldSort : null;
    const col = sort ? stats.findIndex(s => s[0] === sort.key) : -1;
    const rows = [...drivers].sort(([, x], [, y]) => {
      if (col >= 0) {
        const [key, , lower] = stats[col], vx = valueOf(x, key), vy = valueOf(y, key);
        if (!Number.isFinite(vx) || !Number.isFinite(vy)) return Number.isFinite(vx) ? -1 : Number.isFinite(vy) ? 1 : 0;
        const better = lower ? vx - vy : vy - vx;
        if (better) return sort.dir * better;
      }
      return y.points - x.points;
    });
    const table = el('table', 'season-table season-units season-field');
    const head = el('tr'), th0 = el('th', null, 'Driver'); th0.scope = 'col'; head.append(el('th', 'num season-field-rank', '#'), th0);
    const box = card('Every driver, every stat');
    const redraw = () => { const next = fieldTable(data); box.replaceWith(next); markTips(next); };
    stats.forEach(([key, label, lower], i) => {
      const th = el('th', 'num season-sortable'); th.scope = 'col';
      const b = el('button', 'season-sort-button', label); b.type = 'button'; b.setAttribute('aria-label', `Sort by ${label}`);
      if (i === col) th.setAttribute('aria-sort', (sort.dir === 1) === !lower ? 'descending' : 'ascending');
      if (lower) th.title = 'Lower is better';
      b.addEventListener('click', () => { state.fieldSort = i !== col ? {group, key, dir: 1} : sort.dir === 1 ? {group, key, dir: -1} : null; redraw(); });
      th.append(b); head.append(th);
    });
    const thead = el('thead'); thead.append(head); table.append(thead);
    const tb = el('tbody');
    rows.forEach(([id, st], n) => {
      const tr = el('tr', 'season-field-line'); if (state.driver === id) tr.setAttribute('aria-current', 'true');
      const open = el('button', 'season-row-toggle season-field-open'); open.type = 'button'; open.append(who(data, id, {team: false, family: true}));
      open.addEventListener('click', () => { state.driver = id; window.ApexUrl?.write('season', urlParams()); paint(() => renderDrivers(data)); });
      const name = el('td'); name.append(open);
      tr.append(el('td', 'num season-field-rank', String(n + 1)), name);
      stats.forEach((stat, i) => {
        const [key, , lower] = stat, v = valueOf(st, key), td = heatChip(el('td', 'num season-heat-cell', show(stat, v)));
        if (range[i] && Number.isFinite(v)) {
          const [lo, hi] = range[i], share = hi > lo ? (v - lo) / (hi - lo) : 0, heat = lower ? 1 - share : share;
          if (heat > 0) td.style.setProperty('--heat', String(heat));
        }
        tr.append(td);
      });
      tb.append(tr);
    });
    table.append(tb);
    const groupPills = el('div', 'season-segment season-zone-toggle'); groupPills.setAttribute('role', 'group'); groupPills.setAttribute('aria-label', 'Session');
    for (const [gid, text] of [['race', 'Race'], ['qualifying', 'Qualifying']]) {
      const btn = el('button', null, text); btn.type = 'button'; btn.setAttribute('aria-pressed', String(group === gid));
      btn.addEventListener('click', () => { if (group === gid) return; state.fieldGroup = gid; redraw(); });
      groupPills.append(btn);
    }
    box.append(groupPills, wrap(table), el('p', 'season-footnote', 'Drivers with at least one start. Deeper shading is better within the column (for average finish, grid and result, retirements and best qualifying, lower is better). Choose a column to sort, a driver to open them above.'));
    return box;
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
      const pair = mainPair(data, state.a);
      state.b = pair ? (pair.a === state.a ? pair.b : pair.a) : order.find(x => x !== state.a);
    }
    const a = state.a, b = state.b, sa = data.driver_stats[a], sb = data.driver_stats[b];
    const repaint = () => { window.ApexUrl?.write('season', urlParams()); paint(() => renderH2H(data)); };
    const toolbar = el('div', 'season-toolbar');
    toolbar.append(driverPicker(data, a, v => { state.a = v; if (state.b === v) state.b = null; repaint(); }, 'First driver'), el('span', 'season-vs', 'vs'),
      driverPicker(data, b, v => { state.b = v; repaint(); }, 'Second driver'));
    const result = compare(data, a, b);
    const ca = teamColour(data.drivers[a]?.team), cb0 = teamColour(data.drivers[b]?.team), cb = cb0 === ca ? (getComputedStyle(page).getPropertyValue('--ui-label').trim() || '#fff') : cb0;
    let rows = el('div', 'season-h2h');
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
    // The scoreboard: race weekends ahead large, then qualifying, race and sprint each as a split bar in the two drivers'
    // colours (the count on each side), and the median qualifying gap in words.
    const versus = el('div', 'season-h2h-score');
    versus.append(el('span', 'season-h2h-score-label', 'Race weekends ahead'), el('b', 'season-h2h-score-big', `${result.tally.race[0]} – ${result.tally.race[1]}`));
    const board = el('div', 'season-h2h-board');
    for (const [kind, label] of [['qualifying', 'Qualifying'], ['race', 'Race'], ['sprint', 'Sprint']]) {
      const [x, y] = result.tally[kind]; if (!(x + y)) continue;
      const row = el('div', 'season-h2h-tally'), bar = el('span', 'season-h2h-tally-bar'), fa = el('i'), fb = el('i');
      fa.style.flex = String(Math.max(x, .0001)); fb.style.flex = String(Math.max(y, .0001)); fa.style.background = ca; fb.style.background = cb;
      bar.append(fa, fb);
      row.append(el('b', x > y ? 'is-ahead' : null, String(x)), el('span', 'season-h2h-tally-name', label), el('b', y > x ? 'is-ahead' : null, String(y)), bar);
      board.append(row);
    }
    versus.append(board);
    const qGaps = data.rounds.map(r => qualiGap(r, a, b)).filter(Boolean);
    const qMedian = median(qGaps.map(g => g.seconds));
    if (qMedian != null) versus.append(el('span', 'season-h2h-pace', Math.abs(qMedian) < 0.0005 ? 'Level in qualifying' : `${driverCode(data, qMedian < 0 ? a : b)} quicker by ${Math.abs(qMedian).toFixed(3)} s`),
      el('small', 'season-muted', `median qualifying gap, ${qGaps.length} sessions`));
    const hero = el('div', 'season-h2h-hero'); hero.append(face(a, ca, false), versus, face(b, cb0, true));
    // Linear list rows: the measurement, then each driver's value either side of one split bar. The bar is the share of the
    // better quantity (for "lower is better" rows, the other driver's share of the total), so the longer side is the one ahead;
    // the leader's value is in the label colour and 590, the other in the secondary colour.
    let wonA = 0, wonB = 0;
    // The photo says who (the bars below carry the colour), so no colour dot.
    const nameCell = (id, colour, right) => { const n = el('span', `season-h2h-name${right ? ' is-right' : ''}`); n.append(avatar(data, id), el('b', null, family(data, id))); if (right) n.append(n.firstChild); return n; };
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
        // Never a missing bar: a zero (0 retirements against 3) still leaves the other side a short stub.
        const x = Math.abs(va), y = Math.abs(vb), raw = x + y === 0 ? .5 : lower ? y / (x + y) : x / (x + y), share = Math.min(.94, Math.max(.06, raw));
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
    // Two cards, as the sessions are: Qualifying and Race. Each has its own name row and comparison rows, then a strip of
    // every round's margin (one dot per round, on the side of whoever was ahead).
    const freshRows = () => { const r = el('div', 'season-h2h'); const h = el('div', 'season-h2h-row season-h2h-head'); h.append(nameCell(a, ca), el('span'), nameCell(b, cb0, true)); r.append(h); return r; };
    rows = freshRows();
    metric('Qualifying ahead', result.tally.qualifying[0], result.tally.qualifying[1]);
    metric('Poles', sa.poles, sb.poles, {key: 'poles'});
    metric('Front rows', sa.front_rows, sb.front_rows, {key: 'front_rows'});
    metric('Q3 appearances', sa.q3, sb.q3, {key: 'q3'});
    // Each driver's qualifying sessions: how often they reached Q2 and Q3 (share of sessions they took part in), went out
    // in Q1, and their mean and median qualifying position (before grid penalties).
    const qualiOf = id => data.rounds.map(r => r.qualifying.find(x => x.driver === id)).filter(Boolean);
    const qa = qualiOf(a), qb = qualiOf(b);
    const share = (rows, test) => (rows.length ? rows.filter(test).length / rows.length : null);
    const inQ2 = q => Number.isFinite(q.q2) || (q.position && q.position <= 15), inQ3 = q => Number.isFinite(q.q3) || (q.position && q.position <= 10);
    const pct = v => `${Math.round(v * 100)}%`;
    metric('Reached Q3', share(qa, inQ3), share(qb, inQ3), {format: pct});
    metric('Reached Q2', share(qa, inQ2), share(qb, inQ2), {format: pct});
    metric('Out in Q1', qa.filter(q => !inQ2(q)).length, qb.filter(q => !inQ2(q)).length, {lower: true});
    const places = rows => rows.map(q => q.position).filter(Number.isFinite);
    const meanOf = v => (v.length ? v.reduce((x, y) => x + y, 0) / v.length : null);
    metric('Mean qualifying', meanOf(places(qa)), meanOf(places(qb)), {lower: true, format: v => v.toFixed(2)});
    metric('Median qualifying', median(places(qa)), median(places(qb)), {lower: true, format: v => (Number.isInteger(v) ? `P${v}` : `P${v.toFixed(1)}`)});
    if (sa.best_qualifying && sb.best_qualifying) metric('Best qualifying', sa.best_qualifying, sb.best_qualifying, {lower: true, format: v => `P${v}`});
    metric('Average grid', sa.average_grid, sb.average_grid, {lower: true, format: v => v.toFixed(2), key: 'average_grid'});
    const qualiRows = rows;
    rows = freshRows();
    metric('Race ahead', result.tally.race[0], result.tally.race[1]);
    if (result.weekends.some(w => w.raceMechanical)) metric('Race ahead, car failures left out', result.clean[0], result.clean[1]);
    if (result.tally.sprint[0] + result.tally.sprint[1]) metric('Sprint ahead', result.tally.sprint[0], result.tally.sprint[1]);
    metric('Points', sa.points, sb.points, {key: 'points'});
    metric('Wins', sa.wins, sb.wins, {key: 'wins'});
    metric('Podiums', sa.podiums, sb.podiums, {key: 'podiums'});
    metric('Points finishes', sa.points_finishes, sb.points_finishes, {key: 'points_finishes'});
    metric('Average finish', sa.average_finish, sb.average_finish, {lower: true, format: v => v.toFixed(2), key: 'average_finish'});
    // Median classified finish, and places gained from the grid per classified finish.
    const raceOf = id => data.rounds.map(r => r.race.find(x => x.driver === id)).filter(x => x?.position);
    const ra = raceOf(a), rb = raceOf(b);
    metric('Median finish', median(ra.map(x => x.position)), median(rb.map(x => x.position)), {lower: true, format: v => (Number.isInteger(v) ? `P${v}` : `P${v.toFixed(1)}`)});
    const gained = rows => { const g = rows.filter(x => x.grid > 0); return g.length ? g.reduce((t, x) => t + (x.grid - x.position), 0) / g.length : null; };
    metric('Places gained per race', gained(ra), gained(rb), {format: v => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}`});
    if (sa.finish_rate != null && sb.finish_rate != null) metric('Finish rate', sa.finish_rate, sb.finish_rate, {format: v => `${Math.round(v * 100)}%`, key: 'finish_rate'});
    metric('Best finish', sa.best_finish, sb.best_finish, {lower: true, format: v => `P${v}`});
    metric('Retirements', sa.retirements, sb.retirements, {lower: true, key: 'retirements'});
    const raceRows = rows;
    // The strips: qualifying gap in seconds (last part both ran), race margin in finishing places.
    const qMargins = data.rounds.map(r => { const g = qualiGap(r, a, b); return g ? {round: r, v: -g.seconds, tip: `${r.name} (${g.session})\n${driverCode(data, g.seconds <= 0 ? a : b)} quicker by ${Math.abs(g.seconds).toFixed(3)} s`} : null; }).filter(Boolean);
    const rMargins = data.rounds.filter(r => r.race?.length).map(r => {
      const x = r.race.find(e => e.driver === a), y = r.race.find(e => e.driver === b);
      if (!x?.position || !y?.position) return null;
      return {round: r, v: y.position - x.position, tip: `${r.name}\n${driverCode(data, a)} P${x.position} · ${driverCode(data, b)} P${y.position}`};
    }).filter(Boolean);
    const qualiCard = card('Qualifying', qualiRows, el('p', 'season-chart-sub', 'Gap at each round · seconds'), marginStrip(qMargins, ca, cb, {unit: ' s', digits: 2, cap: 1, a: driverCode(data, a), b: driverCode(data, b)}));
    const raceCard = card('Race', raceRows, el('p', 'season-chart-sub', 'Margin at each round · finishing places, both classified'), marginStrip(rMargins, ca, cb, {unit: '', digits: 0, cap: 15, a: driverCode(data, a), b: driverCode(data, b)}));
    const sessionCards = el('div', 'season-two season-h2h-sessions'); sessionCards.append(qualiCard, raceCard);
    // Each weekend as a grid (the Recent form look): rounds across, then three rows. Qualifying: the gap in seconds, filled
    // in the quicker driver's colour, deeper for a bigger gap. Then each driver's race finish in the Standings grid colours.
    const weeks = el('table', 'season-table season-matrix season-grid season-h2h-grid');
    const gapMax = Math.max(0.3, Math.min(1, Math.max(...data.rounds.map(r => Math.abs(qualiGap(r, a, b)?.seconds ?? 0)))));
    const ghead = el('tr'); ghead.append(el('th', null, ''));
    for (const r of data.rounds) { const th = el('th', 'num'); th.append(roundMark(r)); ghead.append(th); }
    const gthead = el('thead'); gthead.append(ghead); weeks.append(gthead);
    const gbody = el('tbody');
    const qRow = el('tr'), qHead = el('th', null, 'Qualifying'); qHead.scope = 'row'; qRow.append(qHead);
    for (const r of data.rounds) {
      const g = !notRun(r) && qualiGap(r, a, b), td = el('td', 'num');
      if (notRun(r)) td.classList.add('is-upcoming');
      else if (g) {
        const quick = g.seconds <= 0 ? a : b;
        td.textContent = Math.abs(g.seconds) < 0.0005 ? '0.000' : Math.abs(g.seconds).toFixed(Math.abs(g.seconds) < 10 ? 3 : 1);
        td.classList.add('is-heat'); td.style.setProperty('--team', quick === a ? ca : cb);
        td.style.setProperty('--heat', String(0.35 + 0.3 * Math.min(Math.abs(g.seconds), gapMax) / gapMax));   // the quicker driver's colour reads at a glance; capped so text stays readable on a white team colour
        td.title = `${r.name}, ${g.session}: ${driverCode(data, quick)} quicker by ${Math.abs(g.seconds).toFixed(3)} s`;
      } else td.textContent = '—';
      qRow.append(td);
    }
    gbody.append(qRow);
    for (const id of [a, b]) {
      const tr = el('tr'), th = el('th'); th.scope = 'row'; th.append(who(data, id, {code: true, team: false})); tr.append(th);
      for (const r of data.rounds) {
        const td = el('td', 'num');
        if (notRun(r)) { td.classList.add('is-upcoming'); tr.append(td); continue; }
        const x = r.race.find(e => e.driver === id), n = x?.position;
        td.textContent = !x ? '—' : n ? String(n) : x.status === 'Did not start' ? 'DNS' : 'DNF';
        td.dataset.tone = !x ? 'none' : !n ? 'out' : n === 1 ? 'win' : n <= 3 ? 'podium' : x.points > 0 ? 'points' : 'none';
        const w = result.weekends.find(e => e.round === r.round);
        if (w && w.race != null && (w.race === 0) === (id === a)) td.classList.add('is-ahead');
        td.title = `${r.name}: ${driverCode(data, id)} ${!x ? 'did not race' : n ? 'P' + n : x.status}${w?.raceMechanical && !n ? ' (car failure)' : ''}`;
        tr.append(td);
      }
      gbody.append(tr);
    }
    weeks.append(gbody);
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
    // The driver with the better record (race weekends ahead, then qualifying) is named first, so every row reads leader
    // on the left: bright numbers and the solid part of each bar line up down the table.
    // Teams in the latest constructors' standings order; within a team, the pair with the most weekends together first.
    const teamRank = new Map((data.standings.teams?.at(-1)?.table || []).map(e => [e.id, e.position]));
    const ordered = data.teammates.map(q => {
      const t = compare(together(data, q), q.a, q.b).tally, swap = t.race[1] > t.race[0] || (t.race[1] === t.race[0] && t.qualifying[1] > t.qualifying[0]);
      return swap ? {...q, a: q.b, b: q.a} : q;
    }).sort((x, y) => (teamRank.get(x.team) ?? 99) - (teamRank.get(y.team) ?? 99) || together(data, y).rounds.length - together(data, x).rounds.length);
    for (const p of ordered) {
      const tr = el('tr', 'season-battle-row'), colour = teamColour(p.team);
      if (p.a === a && p.b === b || p.a === b && p.b === a) tr.setAttribute('aria-current', 'true');
      const open = el('button', 'season-row-toggle season-battle-open'); open.type = 'button';
      const mark = teamMark(data, p.team);
      open.append(mark, who(data, p.a, {code: true, team: false}), el('span', 'season-muted', 'vs'), who(data, p.b, {code: true, team: false}));
      open.append(el('span', 'visually-hidden', `, ${teamName(data, p.team)}. Compare this pair.`));
      const name = el('td'); name.append(open);
      const view = together(data, p);
      const gaps = view.rounds.map(r => qualiGap(r, p.a, p.b)?.seconds).filter(Number.isFinite), gm = median(gaps);
      const gap = el('td', 'num season-battle-gap', gm == null ? '—' : `${driverCode(data, gm <= 0 ? p.a : p.b)} ${Math.abs(gm).toFixed(3)} s`);
      const pts = view === data ? [data.driver_stats[p.a]?.points ?? 0, data.driver_stats[p.b]?.points ?? 0] : [pointsIn(data, view, p.a), pointsIn(data, view, p.b)];
      const ptsCell = el('td', 'num season-battle-points'); ptsCell.append(el('b', pts[0] > pts[1] ? 'is-better' : null, String(pts[0])), el('span', 'season-muted', '–'), el('b', pts[1] > pts[0] ? 'is-better' : null, String(pts[1])));
      const t = compare(view, p.a, p.b).tally;   // the same counting as the comparison below, over their weekends together
      if (view !== data) open.append(el('small', 'season-muted season-battle-span', `${view.rounds.length} weekend${view.rounds.length === 1 ? "" : "s"} together`));
      tr.append(name, score(...t.qualifying, colour), score(...t.race, colour), score(...t.sprint, colour), gap, ptsCell);
      tr.addEventListener('click', () => { state.a = p.a; state.b = p.b; repaint(); });   // the button's click bubbles here
      btb.append(tr);
    }
    battles.append(btb);
    const allBattles = card('Every teammate battle', wrap(battles), el('p', 'season-footnote', 'Weekends each driver finished ahead of their teammate (first-named driver first), the median qualifying gap, and each driver’s season points, including any scored for another team. Choose a pair to compare them below.'));
    const paceTwo = el('div', 'season-two'); paceTwo.append(h2hPace(data, a, b, ca, cb), practicePace(data, a, b, ca, cb));
    return [toolbar, allBattles, hero, sessionCards, paceTwo, h2hExtras(data, a, b, ca, cb), card('Weekend by weekend', wrap(weeks), el('p', 'season-footnote', `Qualifying: the gap in the last session both set a time in, filled in the quicker driver’s colour (deeper for a bigger gap; ${gapMax.toFixed(1)} s or more is the deepest). Race rows: each driver’s finish, purple a win, green a podium, white points, red a retirement; the one ahead that weekend is underlined.`))];
  }
  // Head-to-head pace: the two drivers' rolling race and qualifying pace and typical top speed (from Form's data), and
  // their race pace at every round. Filled in when the race analysis has loaded.
  function h2hPace(data, a, b, ca, cb) {
    const box = card('Pace', el('p', 'season-muted', 'Loading the race analysis…'));
    const done = data.rounds.filter(r => r.race?.length);
    loadForm(state.year, data).then(form => {
      if (state.a !== a || state.b !== b) return;
      const quali = qualiGapsByRound(done);
      const secs = (perRound, id) => {
        const kept = new Set(trimOutliers(done.filter(r => Number.isFinite(perRound[r.round]?.[id])).map(r => [r.round, perRound[r.round][id]])).kept.map(([n]) => n));
        return done.filter(r => kept.has(r.round)).map(r => [r.round, perRound[r.round][id] / 100 * (Number.isFinite(poleSeconds(r)) ? poleSeconds(r) : 90)]);
      };
      const raceA = secs(form.race || {}, a), raceB = secs(form.race || {}, b), qA = secs(quali, a), qB = secs(quali, b);
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
      head.append(el('span'), paceHead(data, a), paceHead(data, b), el('span'));
      rows.append(head);
      line('Rolling race pace', rolling(raceA), rolling(raceB), {note: 'gap to each race’s quickest, recent races weigh more'});
      line('Season race pace', raceA.length ? raceA.reduce((s, [, v]) => s + v, 0) / raceA.length : null, raceB.length ? raceB.reduce((s, [, v]) => s + v, 0) / raceB.length : null);
      line('Rolling qualifying pace', rolling(qA), rolling(qB), {note: 'gap to pole'});
      // Pace at every round, both drivers on one scale (lower is quicker): race or qualifying, chosen by pills. The scale
      // runs from zero to the next half second above the largest gap shown, so no point is cut off.
      const at = (list, n) => list.find(([m]) => m === n)?.[1] ?? null;
      const paceChart = kind => {
        const [la, lb] = kind === 'qualifying' ? [qA, qB] : [raceA, raceB];
        const rounds = done.map(r => r.round).filter(n => at(la, n) != null || at(lb, n) != null);
        if (rounds.length < 2) return el('p', 'season-muted', 'Not enough rounds yet.');
        const top = Math.max(.5, Math.ceil(Math.max(...[...la, ...lb].map(([, v]) => v)) * 2) / 2);
        return lineChart(rounds, [
          {id: a, label: driverCode(data, a), short: driverCode(data, a), colour: ca, values: rounds.map(n => at(la, n))},
          {id: b, label: driverCode(data, b), short: driverCode(data, b), colour: cb, values: rounds.map(n => at(lb, n))}],
        {title: kind === 'qualifying' ? 'Qualifying pace by round' : 'Race pace by round', height: 240, endLabels: 2, min: 0, max: top, format: v => `+${v.toFixed(1)}`, area: true});
      };
      const kind = state.h2hPaceKind === 'qualifying' ? 'qualifying' : 'race';
      const pills = el('div', 'season-segment season-zone-toggle'); pills.setAttribute('role', 'group'); pills.setAttribute('aria-label', 'Pace chart');
      const chartSlot = el('div'), chartTitle = el('h4', 'season-report-title');
      const drawPace = k => {
        chartTitle.textContent = k === 'qualifying' ? 'Qualifying pace at each round · seconds behind pole, lower is quicker' : 'Race pace at each round · seconds behind the quickest, lower is quicker';
        chartSlot.replaceChildren(paceChart(k)); markTips(chartSlot);
        pills.querySelectorAll('button').forEach(btn => btn.setAttribute('aria-pressed', String(btn.dataset.kind === k)));
      };
      for (const [id, label] of [['race', 'Race'], ['qualifying', 'Qualifying']]) {
        const btn = el('button', null, label); btn.type = 'button'; btn.dataset.kind = id;
        btn.addEventListener('click', () => { state.h2hPaceKind = id; drawPace(id); });
        pills.append(btn);
      }
      drawPace(kind);
      box.replaceChildren(el('h3', null, 'Pace'), rows, pills, chartTitle, chartSlot,
        el('p', 'season-footnote', 'Race pace: each driver’s clean-air pace in Car performance’s race analysis, as a gap to the quickest driver in that race, in seconds on that weekend’s pole lap. Qualifying pace: best lap against pole.'));
      markTips(box);
    }).catch(() => box.replaceChildren(el('h3', null, 'Pace'), el('p', 'season-muted', 'The race analysis is not available here yet.')));
    return box;
  }

  // One dot per round on a horizontal axis centred on zero: right of centre the first driver was ahead, left the second
  // (each in their colour); dots at the same spot stack. A margin beyond `cap` sits at the edge with an arrow.
  function marginStrip(points, ca, cb, {unit = '', digits = 2, cap = 1, a = '', b = ''} = {}) {
    if (!points.length) return el('p', 'season-muted', 'No rounds to compare yet.');
    // A dot histogram: every round a dot at its margin, rounds with the same margin stacked upward from the axis, so a
    // column's height is how many rounds ended that way.
    const W = 560, mid = W / 2, half = W / 2 - 28, r = 4.5, step = r * 2.2;
    const x = v => mid + Math.max(-1, Math.min(1, v / cap)) * half;
    const placed = [], stacks = [];
    for (const p of [...points].sort((m, n) => Math.abs(m.v) - Math.abs(n.v))) {
      const px = x(p.v); let k = 0;
      while (placed.some(([qx, qk]) => qk === k && Math.abs(qx - px) < r * 2.05)) k++;
      placed.push([px, k]); stacks.push([p, px, k]);
    }
    // Room above for the side labels, below for the numbered axis.
    const tall = Math.max(...stacks.map(([, , k]) => k)) + 1, H = Math.max(96, 26 + tall * step + 34), base = H - 34;
    let svg = `<svg class="season-chart season-strip-plot" viewBox="0 0 ${W} ${H}" role="img" aria-label="Margin at each round">`;
    svg += `<line class="grid" x1="${mid}" x2="${mid}" y1="6" y2="${base + 4}"/><line class="grid strip-axis" x1="${mid - half}" x2="${mid + half}" y1="${base + r + 3}" y2="${base + r + 3}"/>`;
    // Numbered ticks: five steps each side of zero (places, or tenths of the cap in seconds), the margin without a sign.
    const tickStep = cap >= 10 ? 5 : cap / 2, ticks = [];
    for (let v = -cap; v <= cap + 1e-9; v += tickStep) ticks.push(Math.round(v * 100) / 100);
    for (const v of ticks) {
      const tx = x(v).toFixed(1);
      svg += `<line class="grid" x1="${tx}" x2="${tx}" y1="${base + r + 3}" y2="${base + r + 8}"/><text class="axis strip-tick" x="${tx}" y="${base + r + 20}" text-anchor="middle">${v === 0 ? '0' : `${Math.abs(v)}${unit.trim() ? unit.trim() : ''}`}</text>`;
    }
    for (const [p, px, k] of stacks) {
      const py = base - k * step;
      const colour = p.v > 0 ? ca : p.v < 0 ? cb : 'var(--ui-tertiary)';
      svg += `<circle class="strip-dot${Math.abs(p.v) > cap ? ' is-beyond' : ''}" cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" style="--c:${esc(colour)}" data-tip="${esc(p.tip)}"/>`;
    }
    svg += `<text class="label strip-side" x="${mid - half}" y="12" text-anchor="start" style="fill:${esc(cb)}">← ${esc(b)} ahead</text><text class="label strip-side" x="${mid + half}" y="12" text-anchor="end" style="fill:${esc(ca)}">${esc(a)} ahead →</text>`;
    const med = median(points.map(p => p.v));
    svg += `</svg>`;
    const box = el('div', 'season-strip-wrap'); box.append(htmlNode(svg));
    box.append(el('p', 'season-footnote', med == null ? '' : `Median ${med === 0 ? 'level' : `${med > 0 ? a : b} ahead by ${Math.abs(med).toFixed(digits)}${unit}`} over ${points.length} rounds.`));
    return box;
  }
  // Season battle log: the race margin at every round, places between the two (above the line the first driver finished
  // ahead, below the second), the area to zero filled flat in the colour of whoever was ahead. A round where only one
  // finished is a triangle at the edge on the finisher's side; neither finished leaves a gap.
  function battleLog(data, a, b, ca, cb) {
    const rounds = data.rounds.filter(r => r.race?.length), cap = 12;
    const W = 760, H = 300, L = 40, R = 16, T = 14, B = 48;
    // The scale runs a little past the cap, so the edge rows hold the side labels and never a dot.
    const E = cap + 2.5, x = i => L + (rounds.length < 2 ? 0 : i / (rounds.length - 1) * (W - L - R)), y = v => T + (E - v) / (E * 2) * (H - T - B);
    const pts = rounds.map((r, i) => {
      const p = r.race.find(e => e.driver === a), q = r.race.find(e => e.driver === b);
      if (p?.position && q?.position) return {i, r, v: Math.max(-cap, Math.min(cap, q.position - p.position)), raw: q.position - p.position, p, q};
      if (p?.position && q) return {i, r, edge: 1, p, q};
      if (q?.position && p) return {i, r, edge: -1, p, q};
      return {i, r, none: true};
    });
    let svg = `<svg class="season-chart season-battle-log" viewBox="0 0 ${W} ${H}" role="img" aria-label="Race margin at each round">`;
    for (const t of [-10, -5, 0, 5, 10]) svg += `<line class="grid${t === 0 ? ' is-zero' : ''}" x1="${L}" x2="${W - R}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"/><text class="axis" x="${L - 8}" y="${(y(t) + 3.5).toFixed(1)}" text-anchor="end">${t === 0 ? '0' : Math.abs(t)}</text>`;
    // The filled areas, one polygon per run of rounds on the same side of zero.
    const finite = pts.filter(p => p.v != null);
    for (let k = 0; k < finite.length - 1; k++) {
      const p = finite[k], q = finite[k + 1], x0 = x(p.i), x1 = x(q.i), z = y(0);
      if (q.i !== p.i + 1) continue;   // a round between them without a margin: no fill across it
      if (p.v >= 0 && q.v >= 0 || p.v <= 0 && q.v <= 0) {
        const side = p.v + q.v >= 0 ? ca : cb;
        svg += `<path class="battle-fill" style="fill:${esc(side)}" d="M${x0.toFixed(1)} ${z}L${x0.toFixed(1)} ${y(p.v).toFixed(1)}L${x1.toFixed(1)} ${y(q.v).toFixed(1)}L${x1.toFixed(1)} ${z}Z"/>`;
      } else {
        const xc = x0 + (x1 - x0) * (p.v / (p.v - q.v));
        svg += `<path class="battle-fill" style="fill:${esc(p.v > 0 ? ca : cb)}" d="M${x0.toFixed(1)} ${z}L${x0.toFixed(1)} ${y(p.v).toFixed(1)}L${xc.toFixed(1)} ${z}Z"/>`;
        svg += `<path class="battle-fill" style="fill:${esc(q.v > 0 ? ca : cb)}" d="M${xc.toFixed(1)} ${z}L${x1.toFixed(1)} ${y(q.v).toFixed(1)}L${x1.toFixed(1)} ${z}Z"/>`;
      }
    }
    svg += `<path class="line battle-line" d="${finite.map((p, k) => `${k && finite[k - 1].i === p.i - 1 ? 'L' : 'M'}${x(p.i).toFixed(1)} ${y(p.v).toFixed(1)}`).join('')}"/>`;
    const slot = rounds.length > 1 ? (W - L - R) / (rounds.length - 1) : 40;
    for (const p of pts) {
      const name = p.r.name;
      if (p.v != null) {
        const colour = p.v > 0 ? ca : p.v < 0 ? cb : 'var(--ui-tertiary)';
        svg += `<circle class="battle-dot" cx="${x(p.i).toFixed(1)}" cy="${y(p.v).toFixed(1)}" style="--c:${esc(colour)}"/>`;
      } else if (p.edge) {
        const up = p.edge > 0, ty = y(up ? cap - 1 : -cap + 1), cx = x(p.i), colour = up ? ca : cb;   // inside the frame
        svg += `<path class="battle-edge" style="--c:${esc(colour)}" d="M${(cx - 6).toFixed(1)} ${(ty + (up ? 5 : -5)).toFixed(1)}L${(cx + 6).toFixed(1)} ${(ty + (up ? 5 : -5)).toFixed(1)}L${cx.toFixed(1)} ${(ty + (up ? -6 : 6)).toFixed(1)}Z"/>`;
      }
      const fin = e => (!e ? '—' : e.position ? `P${e.position}` : 'DNF');
      const tip = `${name}\n${driverCode(data, a)}  ${fin(p.p)}\n${driverCode(data, b)}  ${fin(p.q)}${p.raw != null && Math.abs(p.raw) > cap ? `\nMargin ${Math.abs(p.raw)} places (beyond the chart)` : ''}`;
      svg += `<rect class="hit" x="${(x(p.i) - slot / 2).toFixed(1)}" y="${T}" width="${slot.toFixed(1)}" height="${H - T - B}" data-tip="${esc(tip)}"/>`;
    }
    svg += `<text class="label" x="${W - R}" y="${(y(E) + 11).toFixed(1)}" text-anchor="end" style="fill:${esc(ca)}">${esc(driverCode(data, a))} ahead ↑</text><text class="label" x="${W - R}" y="${(y(-E) - 5).toFixed(1)}" text-anchor="end" style="fill:${esc(cb)}">${esc(driverCode(data, b))} ahead ↓</text>`;
    const chart = htmlNode(svg + xLabels(rounds.map(r => r.round), x, H, slot) + '</svg>');
    const [wa, wb] = [pts.filter(p => p.v > 0 || p.edge > 0).length, pts.filter(p => p.v < 0 || p.edge < 0).length];
    return card('Season battle log', el('p', 'season-chart-sub', `Race margin at each round, in places · ${driverCode(data, a)} ahead ${wa}, ${driverCode(data, b)} ahead ${wb}`), chart,
      el('p', 'season-footnote', `Above the line ${family(data, a)} finished ahead, below ${family(data, b)}; the shading is the margin. A triangle: only one of them finished. Margins beyond ${cap} places are drawn at the edge (exact on hover).`));
  }
  // Practice pace: each driver's best timed lap in every practice session of the last six weekends (the published session
  // data), as the gap between the two. The latest weekend session by session, then every session as a strip.
  const practiceCache = new Map();
  function loadPractice(data) {
    const request = window.apexDataRequest, year = data.year;
    if (practiceCache.has(year)) return practiceCache.get(year);
    const job = typeof request !== 'function' ? Promise.resolve([]) : seasonEvents(year).then(events => {
      const rounds = data.rounds.filter(r => r.race?.length), jobs = [];
      for (const r of rounds) for (const name of ['Practice 1', 'Practice 2', 'Practice 3']) {
        const event = events.find(e => e.round === r.round);
        if (event && (event.sessions || []).includes(name)) jobs.push({r, name, event});
      }
      const out = [], queue = [...jobs];
      return Promise.all(Array.from({length: 4}, async () => {
        while (queue.length) {
          const {r, name, event} = queue.shift();
          const session = await request('/api/session?' + new URLSearchParams({year, gp: event.name, session: name, round: r.round})).catch(() => null);
          const best = {};
          for (const d of session?.drivers || []) {
            const t = (d.laps || []).filter(l => Number.isFinite(l.time) && l.time > 0 && !l.deleted && !l.in_lap && !l.out_lap).map(l => l.time);
            if (t.length) best[d.code] = Math.min(...t);
          }
          out.push({r, name, best});
        }
      })).then(() => out.sort((m, n) => m.r.round - n.r.round || m.name.localeCompare(n.name)));
    });
    practiceCache.set(year, job);
    return job;
  }
  // A pace table column heading: the driver's photo and code (the column says who; no colour needed).
  const paceHead = (data, id) => { const h = el('b', 'season-pace-who'); h.append(avatar(data, id), driverCode(data, id)); return h; };
  function practicePace(data, a, b, ca, cb) {
    const box = card('Practice pace', el('p', 'season-muted', 'Loading the season\u2019s practice sessions\u2026'));
    const codeA = driverCode(data, a), codeB = driverCode(data, b);
    loadPractice(data).then(sessions => {
      if (state.a !== a || state.b !== b) return;
      const both = sessions.filter(x => Number.isFinite(x.best[codeA]) && Number.isFinite(x.best[codeB]));
      if (!both.length) { box.replaceChildren(el('h3', null, 'Practice pace'), el('p', 'season-muted', 'No practice session with a timed lap from both yet.')); return; }
      // Per weekend: the median of (B - A) over its practice sessions, so above zero the first driver was quicker.
      const rounds = [...new Set(both.map(x => x.r))];
      const perRound = rounds.map(r => { const g = both.filter(x => x.r === r).map(x => x.best[codeB] - x.best[codeA]); return {r, v: median(g), n: g.length}; });
      const aAhead = both.filter(x => x.best[codeA] < x.best[codeB]).length, med = median(both.map(x => x.best[codeB] - x.best[codeA]));
      const summary = el('div', 'season-practice-summary');
      const stat = (big, small) => { const d = el('div'); d.append(el('b', null, big), el('span', 'season-muted', small)); summary.append(d); };
      stat(`${aAhead}–${both.length - aAhead}`, `practice sessions quicker (${codeA}–${codeB})`);
      stat(med == null || Math.abs(med) < .0005 ? 'level' : `${med > 0 ? codeA : codeB} ${Math.abs(med).toFixed(3)} s`, 'median gap, best laps');
      stat(String(rounds.length), 'weekends with both timed');
      const chart = barChart(perRound.map(x => x.r.round), perRound.map(x => x.v), {height: 200, clip: true,
        colour: v => (v >= 0 ? ca : cb), format: v => signed(v, 2, ' s'),
        tips: perRound.map(x => `${x.r.name}\n${x.v >= 0 ? codeA : codeB} quicker by ${Math.abs(x.v).toFixed(3)} s\nmedian of ${x.n} session${x.n === 1 ? '' : 's'}`), title: 'Practice gap by weekend'});
      box.replaceChildren(el('h3', null, 'Practice pace'), summary, el('p', 'season-chart-sub', `Gap at each weekend · above zero ${codeA} quicker, below ${codeB}`), chart,
        el('p', 'season-footnote', 'Each driver\u2019s best timed lap in every practice session (in- and out-laps left out); a weekend\u2019s bar is the median gap over its sessions. Practice runs differ in fuel and tyres, so a gap here is a hint, not a ranking.'));
      markTips(box);
    });
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
    // Two views: the gap between the pair (running total and each weekend), or each driver's gap to the championship leader.
    const pointsView = ['leader', 'points'].includes(state.pointsGapView) ? state.pointsGapView : 'pair';
    const gapPills = el('div', 'season-segment season-zone-toggle'); gapPills.setAttribute('role', 'group'); gapPills.setAttribute('aria-label', 'Points gap view');
    let pointsCard;
    if (pointsView === 'points') {
      const evo = data.standings.drivers || [];
      const at = id => evo.map(st => st.table.find(e => e.id === id)?.points ?? 0);
      const pointsLine = lineChart(evo.map(st => st.round), [
        {id: a, label: driverCode(data, a), short: driverCode(data, a), colour: ca, values: at(a)},
        {id: b, label: driverCode(data, b), short: driverCode(data, b), colour: cb, values: at(b)}],
      {title: 'Championship points after each round', height: 240, endLabels: 2, area: true});
      pointsCard = card('Points', gapPills, el('p', 'season-chart-sub', 'Championship points after each round'), pointsLine);
    } else if (pointsView === 'leader') {
      const evo = data.standings.drivers || [];
      const behind = id => evo.map(st => { const lead = Math.max(0, ...st.table.map(e => e.points)); return (st.table.find(e => e.id === id)?.points ?? 0) - lead; });   // 0 leads, below zero is behind
      const leaderLine = lineChart(evo.map(st => st.round), [
        {id: a, label: driverCode(data, a), short: driverCode(data, a), colour: ca, values: behind(a)},
        {id: b, label: driverCode(data, b), short: driverCode(data, b), colour: cb, values: behind(b)}],
      {title: 'Points behind the championship leader', height: 240, endLabels: 2, max: 0, area: true, format: v => (v < 0 ? `−${Math.abs(Math.round(v))}` : '0')});
      pointsCard = card('Points gap', gapPills, sub('Points behind the leader after each round'), leaderLine, el('p', 'season-footnote', 'Zero: leading the championship after that round.'));
    } else pointsCard = card('Points gap', gapPills, sub('Running total'), gapLine, sub('Each weekend, sprint included'), perBars, el('p', 'season-footnote', `Above zero: ${family(data, a)} ahead.`));
    for (const [id, label] of [['points', 'Points'], ['pair', 'Between them'], ['leader', 'To the leader']]) {
      const btn = el('button', null, label); btn.type = 'button'; btn.setAttribute('aria-pressed', String(pointsView === id));
      btn.addEventListener('click', () => { if (pointsView === id) return; state.pointsGapView = id; const next = h2hExtras(data, a, b, ca, cb); pointsCard.closest('.season-h2h-extras')?.replaceWith(next); markTips(next); });
      gapPills.append(btn);
    }
    const q = data.rounds.filter(r => r.qualifying.length).map(r => ({round: r.round, name: r.name, gap: qualiGap(r, a, b)}));
    const values = q.map(g => (g.gap ? -g.gap.percent : null));
    const med = median(values);
    const finish = rounds.map(r => { const x = r.race.find(y => y.driver === a)?.position, y = r.race.find(z => z.driver === b)?.position; return x && y ? y - x : null; });
    const two = el('div', 'season-h2h-extras'); two.append(pointsCard, battleLog(data, a, b, ca, cb));
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

  // A teammate pair counts only the weekends both drove for that team (a driver moved mid-season: Lawson's three Red Bull
  // weekends are his battle with Verstappen, not the whole season). The season seen through those rounds only.
  const teamOf = (r, id) => (r.race.find(x => x.driver === id) || r.qualifying.find(x => x.driver === id))?.team;
  function together(data, p) {
    const rounds = data.rounds.filter(r => teamOf(r, p.a) === p.team && teamOf(r, p.b) === p.team);
    return rounds.length === data.rounds.filter(r => teamOf(r, p.a) || teamOf(r, p.b)).length ? data : {...data, rounds};
  }
  // Points scored in those rounds (race and sprint).
  const pointsIn = (data, view, id) => { const rounds = new Set(view.rounds.map(r => r.round)); return (data.driver_stats[id]?.by_round || []).filter(x => rounds.has(x.round)).reduce((sum, x) => sum + (x.race_points || 0) + (x.sprint_points || 0), 0); };
  // The pair a driver belongs to for the most weekends.
  const mainPair = (data, id) => data.teammates.filter(p => p.a === id || p.b === id).sort((x, y) => together(data, y).rounds.length - together(data, x).rounds.length)[0];

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
      {label: 'Distance run', value: g => (g.possible ? g.laps / g.possible : 0), text: g => (g.possible ? `${(g.laps / g.possible * 100).toFixed(1)}%` : '—'), title: 'Laps completed as a share of the winner’s laps in the races started'},
      {label: 'PU failures', value: g => g.pu, heat: 'up', title: 'Race retirements blamed on the power unit: engine, battery or ERS, cooling, fuel'},
      {label: 'Other failures', value: g => g.mechanical, heat: 'up', title: 'Other mechanical retirements: gearbox, brakes, suspension, hydraulics…'},
      {label: 'Incidents', value: g => g.incident, heat: 'up', title: 'Retirements after an accident, collision or damage'},
      {label: 'Did not start', value: g => g.dns, heat: 'up'},
      {label: 'Quali, no time', value: g => g.noTime, heat: 'up', title: 'Qualifying sessions where the car set no time'},
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
