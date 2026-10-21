/* Shareable URLs for both views, with no server routes: the page always
   loads at /apex/ and its state lives in the query string, written with the
   History API. Each view owns its own parameters:

     session analysis  ?year=2026&round=17&session=Qualifying&laps=VER.11,NOR.16
     car performance   ?view=cars&year=2026&scope=tracks&races=15,16,17
                       &metric=corners&subject=team&session=qualy&pill=straight&run=1

   Changing what you look at (view, category, GP, laps) adds a history entry,
   so the back button steps through it; changing a filter replaces the entry.
   Unknown or missing parameters fall back to the defaults. */
(() => {
  const VIEWS = {
    session: ['year', 'round', 'session', 'laps'],
    cars: ['year', 'scope', 'races', 'metric', 'subject', 'session', 'pill', 'run']
  };
  // Changes to these move to a new "page" and get their own history entry.
  const NAVIGATION = {session: ['year', 'round', 'session', 'laps'], cars: ['year', 'scope', 'races', 'metric', 'run']};
  const restorers = {};
  const memory = {};

  function parse(search) {
    const query = new URLSearchParams(search);
    const view = query.get('view') === 'cars' ? 'cars' : 'session';
    const params = {};
    for (const key of VIEWS[view]) {
      const value = query.get(key);
      if (value !== null && value !== '') params[key] = value;
    }
    return {view, params};
  }

  function href(view, params) {
    const query = new URLSearchParams();
    if (view === 'cars') query.set('view', 'cars');
    for (const key of VIEWS[view]) {
      const value = params?.[key];
      if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
    }
    // Commas are safe in a query string; keep lists readable (races=16,17).
    const text = query.toString().replace(/%2C/gi, ',');
    return location.pathname + (text ? '?' + text : '') + location.hash;
  }

  function read() { return parse(location.search); }

  function write(view, params) {
    if (!VIEWS[view]) return;
    memory[view] = {...params};
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

  addEventListener('popstate', () => {
    const {view, params} = read();
    memory[view] = {...params};
    restorers[view]?.(params, {fromHistory: true});
  });

  window.ApexUrl = {read, write, remembered, onRestore, parse, href};
})();
