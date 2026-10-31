import {appSource} from './app-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source = readFileSync('url-state.js', 'utf8');
function browser(search = '', pathname = '/apex/') {
  const calls = [], listeners = {};
  const location = {pathname, search, hash: ''};
  const history = {
    pushState: (state, title, url) => { calls.push(['push', url]); Object.assign(location, split(url)); },
    replaceState: (state, title, url) => { calls.push(['replace', url]); Object.assign(location, split(url)); }
  };
  const split = url => { const [path, query = ''] = url.split('?'); return {pathname: path, search: query ? '?' + query : ''}; };
  const box = {location, history, URLSearchParams, addEventListener: (type, fn) => listeners[type] = fn, window: {}, document: {title: 'F1 Apex Data — Telemetry Analytics'}};
  vm.createContext(box); vm.runInContext(source, box);
  return {url: box.window.ApexUrl, location, calls, document: box.document, popstate: () => listeners.popstate()};
}

test('each view reads only its own parameters; unknown views fall back to session analysis', () => {
  assert.deepEqual({...browser('?view=cars&year=2026&metric=corners&laps=VER.1').url.read().params}, {year: '2026', metric: 'corners'});
  const session = browser('?year=2026&round=17&session=Qualifying&laps=VER.11,NOR.16&metric=x').url.read();
  assert.equal(session.view, 'session');
  assert.deepEqual({...session.params}, {year: '2026', round: '17', session: 'Qualifying', laps: 'VER.11,NOR.16'});
  assert.equal(browser('?view=nonsense&year=2025').url.read().view, 'session');
});

test('the category is the path; legacy ?view=cars links still read', () => {
  const path = browser('?year=2026&scope=tracks&races=16,17&run=1', '/apex/cars/corners').url.read();
  assert.equal(path.view, 'cars');
  assert.deepEqual({...path.params}, {year: '2026', scope: 'tracks', races: '16,17', run: '1', metric: 'corners'});
  assert.equal(browser('', '/apex/cars').url.read().view, 'cars');
  assert.equal(browser('', '/apex/index.html').url.read().view, 'session');
  const legacy = browser('?view=cars&year=2026&metric=braking');
  assert.deepEqual({...legacy.url.read().params}, {year: '2026', metric: 'braking'});
  legacy.url.write('cars', {year: '2026', metric: 'braking'});
  assert.deepEqual(legacy.calls.at(-1), ['replace', '/apex/cars/braking?year=2026'], 'rewritten to the path in place');
});

test('navigation adds a history entry, filters replace it, and defaults stay out of the link', () => {
  const b = browser('');
  b.url.write('cars', {year: '2026', metric: 'corners', subject: '', run: '1'});
  assert.deepEqual(b.calls.at(-1), ['push', '/apex/cars/corners?year=2026&run=1']);
  b.url.write('cars', {year: '2026', metric: 'corners', subject: 'driver', run: '1'});
  assert.equal(b.calls.at(-1)[0], 'replace', 'a subject change is a filter');
  b.url.write('cars', {year: '2026', metric: 'braking', subject: 'driver', run: '1'});
  assert.equal(b.calls.at(-1)[0], 'push', 'a category change is navigation');
  const count = b.calls.length;
  b.url.write('cars', {year: '2026', metric: 'braking', subject: 'driver', run: '1'});
  assert.equal(b.calls.length, count, 'an unchanged state writes nothing');
  b.url.write('session', {year: '2026', round: '17', session: 'Qualifying', laps: 'VER.11'});
  assert.deepEqual(b.calls.at(-1), ['push', '/apex/?year=2026&round=17&session=Qualifying&laps=VER.11']);
  assert.deepEqual({...b.url.remembered('cars')}, {year: '2026', metric: 'braking', subject: 'driver', run: '1'});
  b.url.write('cars', {year: '2026', metric: 'pace'});
  assert.equal(b.calls.at(-1)[1], '/apex/cars?year=2026', 'the default category is /apex/cars');
});

test('the back button hands the restored parameters to the view that owns them', () => {
  const b = browser('?year=2025', '/apex/cars/pits');
  let restored = null;
  b.url.onRestore('cars', params => restored = {...params});
  b.popstate();
  assert.deepEqual(restored, {year: '2025', metric: 'pits'});
});

test('both views write and restore their state through the shared module', () => {
  const read = file => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const app = appSource().replace(/\r\n/g, '\n'), cars = read('car-performance.js'), page = read('index.html');
  assert.ok(page.indexOf('url-state.js') < page.indexOf('session-state.js'), 'loaded before the views');
  assert.match(app, /function renderAll\(\) \{[\s\S]*?syncSessionUrl\(\);\n\}/);
  assert.match(app, /ApexUrl\?\.onRestore\('session'/);
  assert.match(cars, /ApexUrl\?\.onRestore\('cars'/);
  assert.match(cars, /restorePerformanceUI\(root,state\);[\s\S]*?syncCarUrl\(\);/);
});

test('the hosted app shell does not redirect away from a shared deep link', async () => {
  const worker = readFileSync('worker/index.ts', 'utf8');
  const branch = worker.match(/if \(url\.pathname\.startsWith\("\/apex\/"\)[\s\S]*?\n    \}/)?.[0];
  assert.ok(branch, 'exercise the actual Worker fallback');
  const run = new (Object.getPrototypeOf(async function(){}).constructor)('request', 'env', 'url', branch);
  for (const path of ['/apex/', '/apex/cars', '/apex/cars/corners']) {
    const request = new Request('https://example.test' + path + '?year=2026&races=15,16,17&run=1');
    const response = await run(request, {ASSETS: {fetch: async internal => {
      // Cloudflare's pretty-HTML asset handler redirects index.html to /apex/.
      return new URL(internal.url).pathname === '/apex/'
        ? new Response('<html>app shell</html>')
        : Response.redirect('https://example.test/apex/', 307);
    }}}, new URL(request.url));
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get('location'), null, 'keep the browser path and filters intact');
  }
});

test('the document title says where you are, on load, on navigation and on back', () => {
  assert.equal(browser().document.title, 'F1 Apex Data — Telemetry Analytics', 'the home page keeps the page title');
  assert.equal(browser('?year=2026&round=19&session=Practice+2').document.title, '2026 round 19 Practice 2 · Session analysis — F1 Apex Data');
  assert.equal(browser('?year=2026', '/apex/cars/braking').document.title, 'Braking · Car performance 2026 — F1 Apex Data');
  assert.equal(browser('', '/apex/cars').document.title, 'Pace · Car performance — F1 Apex Data');
  const page = browser();
  page.url.write('cars', {year: '2026', metric: 'results'});
  assert.equal(page.document.title, 'Reliability & results · Car performance 2026 — F1 Apex Data');
  page.url.write('session', {year: '2026', round: '3', session: 'Race'});
  assert.equal(page.document.title, '2026 round 3 Race · Session analysis — F1 Apex Data');
  Object.assign(page.location, {pathname: '/apex/cars/pits', search: '?year=2025'});
  page.popstate();
  assert.equal(page.document.title, 'Pit stops · Car performance 2025 — F1 Apex Data');
});

test('the page declares a canonical URL, social previews, structured data, robots and a sitemap', () => {
  const html = readFileSync('index.html', 'utf8'), site = 'https://f1apexdata.eufrandota14.chatgpt.site/apex/';
  for (const tag of [`rel="canonical" href="${site}"`, 'property="og:title"', 'property="og:image"', 'name="twitter:card"', 'application/ld+json', 'name="robots"'])
    assert.ok(html.includes(tag), tag);
  JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.match(readFileSync('public/robots.txt', 'utf8'), /Disallow: \/api\/[\s\S]*Sitemap: https:\/\/f1apexdata\.eufrandota14\.chatgpt\.site\/sitemap\.xml/);
  const sitemap = readFileSync('public/sitemap.xml', 'utf8');
  assert.equal((sitemap.match(/<loc>/g) || []).length, 9);
  assert.ok(sitemap.includes(`<loc>${site}cars/results</loc>`));
});
