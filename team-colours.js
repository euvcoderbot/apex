/* Team colours as Formula 1 shows them on formula1.com (its --f1-team-colour, 2026 season, read 2026-11-05).
   Session data carries the live-timing feed's palette, which differs for several teams (Red Bull #4781D7 in the feed,
   #3671C6 on formula1.com). This maps each feed colour to the formula1.com one when a colour is drawn; the data is not changed.
   Haas's #DEE1E2 is almost white, so on light backgrounds it uses formula1.com's own accessible Haas colour instead.
   Teams that no longer race (Sauber, AlphaTauri, Alfa Romeo, Racing Point…) keep their own feed colour: formula1.com has none for them.
   Colours a person picks for a lap (lap colour overrides) never pass through here. */
(() => {
  // Every shade the timing feed has used for a current team (2018-2026), mapped to that team's formula1.com colour.
  const TEAMS = {
    '#3671c6': ['#4781d7', '#0600ef', '#3671c6'],            // Red Bull Racing
    '#e8002d': ['#ed1131', '#dc0004', '#e80020'],            // Ferrari
    '#27f4d2': ['#00d7b6', '#00d2be', '#27f4d2'],            // Mercedes
    '#ff8000': ['#f47600', '#ff9800', '#ff8000'],            // McLaren
    '#6692ff': ['#6c98ff'],                                  // Racing Bulls (and RB)
    '#ff2d00': ['#f50537'],                                  // Audi
    '#aaaaad': ['#909090'],                                  // Cadillac
    '#dee1e2': ['#9c9fa2', '#b6babd', '#ffffff'],            // Haas F1 Team
    '#00a1e8': ['#0090ff', '#0093cc'],                       // Alpine
    '#229971': ['#006f62'],                                  // Aston Martin
    '#1868db': ['#005aff', '#64c4ff'],                       // Williams
  };
  const OFFICIAL = Object.fromEntries(Object.entries(TEAMS).flatMap(([official, feed]) => feed.map(hex => [hex, official])));
  const ON_LIGHT = {'#dee1e2': '#667175'};
  function apexTeamColour(value) {
    const hex = String(value || '').toLowerCase();
    const official = OFFICIAL[hex] || hex;
    return document.documentElement.dataset.theme === 'light' ? ON_LIGHT[official] || official : official;
  }
  window.apexTeamColour = apexTeamColour;
})();

/* Driver photos for the session views (the season hub's set in assets/drivers, listed in credits.json), matched by name:
   sessions name drivers "Max VERSTAPPEN", the credits "Max Verstappen". apexDriverFaces.img(name) is an <img> or ''; the
   list loads once, and 'apex-driver-photos' fires on window when it arrives so views can redraw with the photos. */
(() => {
  let byName = null, request = null;
  const plain = v => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]+/g, ' ').trim();
  function load() {
    request ||= fetch('assets/drivers/credits.json').then(r => (r.ok ? r.json() : {})).then(c => {
      byName = new Map(Object.entries(c.photos || {}).map(([id, x]) => [plain(x.name), id]));
      window.dispatchEvent(new Event('apex-driver-photos'));
    }).catch(() => { byName = new Map(); });
    return request;
  }
  function id(name) {
    if (!byName) { load(); return null; }
    const n = plain(name);
    if (byName.has(n)) return byName.get(n);
    const family = n.split(' ').at(-1);
    return [...byName].find(([k]) => k.split(' ').at(-1) === family)?.[1] || null;
  }
  const src = name => { const i = id(name); return i ? `assets/drivers/${encodeURIComponent(i)}.webp` : null; };
  const img = name => { const s = src(name); return s ? `<img class="driver-face-img" src="${s}" alt="" loading="lazy" decoding="async">` : ''; };
  window.apexDriverFaces = {id, src, img, load};
})();
