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
  const box = {location, history, URLSearchParams, addEventListener: (type, fn) => listeners[type] = fn, window: {}};
  vm.createContext(box); vm.runInContext(source, box);
  return {url: box.window.ApexUrl, location, calls, popstate: () => listeners.popstate()};
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
