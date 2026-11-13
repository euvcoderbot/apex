/* Shareable URLs for both views, written with the History API. The page is
   one document; both servers serve it for any extension-less /apex/ path, and
   <base href="/apex/"> keeps its relative asset links working there.

     session analysis  /apex/?year=2026&round=17&session=Qualifying&laps=VER.11,NOR.16
     car performance   /apex/cars/corners?year=2026&scope=tracks&races=15,16,17
                       &subject=team&session=qualy&pill=straight&run=1

   The category is the path (/apex/cars, /apex/cars/braking, ...); older
   ?view=cars&metric= links are still read and rewritten to the path.

   Changing what you look at (view, category, GP, laps) adds a history entry,
   so the back button steps through it; changing a filter replaces the entry.
   Unknown or missing parameters fall back to the defaults. */
(() => {
  const VIEWS = {
    session: ['year', 'round', 'session', 'laps'],
    cars: ['year', 'scope', 'races', 'metric', 'subject', 'session', 'pill', 'basis', 'run'],
    // /apex/season/<tab>?year=2026&driver=antonelli&a=antonelli&b=russell&team=ferrari
    season: ['year', 'tab', 'driver', 'a', 'b', 'team', 'track']
  };
  // Changes to these move to a new "page" and get their own history entry.
  const NAVIGATION = {session: ['year', 'round', 'session', 'laps'], cars: ['year', 'scope', 'races', 'metric', 'run'], season: ['year', 'tab', 'driver', 'a', 'b']};
  const restorers = {};
  const memory = {};
  // The app's root path: /apex/ on both servers; elsewhere (tests, catalog) the page's own folder.
  const BASE = /^\/apex(\/|$)/.test(location.pathname) ? '/apex/' : location.pathname.replace(/[^/]*$/, '') || '/';

  function parse(pathname, search) {
    const query = new URLSearchParams(search);
    const segments = (pathname.startsWith(BASE) ? pathname.slice(BASE.length) : '').split('/').filter(Boolean);
    // The bare address (no path, no query) is the Home page; Session analysis has its own path, /apex/session, and the old
    // /apex/?year=…&round=… links (they carry a query) still open the session they name.
    const home = !segments.length && ![...query.keys()].length;
    const view = segments[0] === 'cars' || query.get('view') === 'cars' ? 'cars' : segments[0] === 'season' || home ? 'season' : 'session';
    const params = {};
    for (const key of VIEWS[view]) {
      const value = query.get(key);
      if (value !== null && value !== '') params[key] = value;
    }
    if (view === 'cars' && segments[0] === 'cars' && segments[1]) params.metric = decodeURIComponent(segments[1]);
    if (view === 'season' && segments[1]) params.tab = decodeURIComponent(segments[1]);
    if (home) params.tab = 'home';
    return {view, params};
  }

  function href(view, params) {
    const query = new URLSearchParams();
    for (const key of VIEWS[view]) {
      if ((view === 'cars' && key === 'metric') || (view === 'season' && key === 'tab')) continue;  // the category is the path
      const value = params?.[key];
      if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
    }
    // Commas are safe in a query string; keep lists readable (races=16,17).
    const text = query.toString().replace(/%2C/gi, ',');
    const metric = params?.metric && params.metric !== 'pace' ? '/' + encodeURIComponent(params.metric) : '';
    if (view === 'season' && params?.tab === 'home') return BASE + location.hash;   // Home lives at the bare address
    if (view === 'season') return BASE + 'season' + (params?.tab ? '/' + encodeURIComponent(params.tab) : '') + (text ? '?' + text : '') + location.hash;
    return (view === 'cars' ? BASE + 'cars' + metric : BASE + 'session') + (text ? '?' + text : '') + location.hash;
  }

  function read() { return parse(location.pathname, location.search); }

  // One document serves every route, so the title says where you are (history entries, tabs, bookmarks).
  const SITE = 'F1 Apex Data';
  const CATEGORY_TITLES = {pace: 'Pace', corners: 'Cornering', straight: 'Straight line', braking: 'Braking', pits: 'Pit stops',
    tyres: 'Tyre trend', trend: 'Development & updates', results: 'Reliability & results'};
  const SEASON_TITLES = {home: 'Home', schedule: 'Schedule', results: 'Results', standings: 'Standings', form: 'Form', drivers: 'Driver stats',
    h2h: 'Head-to-head', upgrades: 'Upgrades', units: 'Power units', tracks: 'Tracks'};
  function titleFor(view, params) {
    if (view === 'season' && params?.tab === 'home') return `${SITE} — Formula 1 analysis`;
    if (view === 'season') return `${SEASON_TITLES[params?.tab] || 'Schedule'} · Season${params?.year ? ' ' + params.year : ''} — ${SITE}`;
    if (view === 'cars') return `${CATEGORY_TITLES[params?.metric] || CATEGORY_TITLES.pace} · Car performance${params?.year ? ' ' + params.year : ''} — ${SITE}`;
    const where = [params?.year, params?.round ? 'round ' + params.round : '', params?.session].filter(Boolean).join(' ');
    return where ? `${where} · Session analysis — ${SITE}` : `Session analysis — ${SITE}`;
  }
  function showTitle(view, params) { if (typeof document !== 'undefined') document.title = titleFor(view, params); }

  function write(view, params) {
    if (!VIEWS[view]) return;
    memory[view] = {...params};
    showTitle(view, params);
    const next = href(view, params);
    if (next === location.pathname + location.search + location.hash) return;
    const current = read();
    const navigated = current.view !== view
      || NAVIGATION[view].some(key => String(current.params[key] ?? '') !== String(params?.[key] ?? ''));
    history[navigated ? 'pushState' : 'replaceState']({apexView: view}, '', next);
  }

  // The parameters a view last wrote, so switching views and back restores it.
  function remembered(view) { return memory[view] ? {...memory[view]} : null; }

  function onRestore(view, restore) { restorers[view] = restore; }

  // With <base href>, "#id" links would resolve to /apex/#id and leave a
  // deeper path. Keep in-page links (skip links) in place: focus the target.
  addEventListener('click', event => {
    const link = event.target?.closest?.('a[href^="#"]');
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
    const target = document.getElementById(link.getAttribute('href').slice(1));
    if (!target) return;
    event.preventDefault();
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus();
    target.scrollIntoView({block: 'start'});
  });

  addEventListener('popstate', () => {
    const {view, params} = read();
    memory[view] = {...params};
    showTitle(view, params);
    restorers[view]?.(params, {fromHistory: true});
  });
  {
    const {view, params} = read();
    if (location.pathname !== BASE || location.search) showTitle(view, params);
  }

  window.ApexUrl = {read, write, remembered, onRestore, parse, href, titleFor};
})();
