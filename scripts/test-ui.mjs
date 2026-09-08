import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import postcss from 'postcss';

const app = readFileSync('app.js', 'utf8');
function context(reduced = false) {
  const sandbox = { console, URLSearchParams,
    document: { addEventListener() {}, querySelector() {}, activeElement: null },
    window: { matchMedia: () => ({ matches: reduced }) } };
  vm.createContext(sandbox);
  vm.runInContext(app, sandbox);
  return { sandbox, run: code => vm.runInContext(code, sandbox) };
}

test('one interface font family for canvas and every HTML descendant', () => {
  const css = postcss.parse(readFileSync('apple-ui.css', 'utf8'));
  const fonts = [];
  css.walkDecls('font-family', declaration => fonts.push(declaration.value));
  assert.ok(fonts.length > 0 && fonts.every(font => font === 'var(--font-sans)'));
  assert.ok(!/ctx\.font\s*=\s*['"]/.test(app));
  assert.match(context().run('canvasFont(12)'), /12px -apple-system/);
  const imports = readFileSync('styles.css', 'utf8');
  assert.match(imports, /@layer legacy, interface/);
  assert.match(imports, /apple-ui\.css[^;]+layer\(interface\)/);
});

test('every mapped Grand Prix country has a local SVG; option markup is escaped', () => {
  const h = context();
  const codes = h.run('[...new Set([...Object.values(COUNTRY_FLAG_CODES), ...GRAND_PRIX_FLAG_RULES.map(row => row[1])])]');
  for (const code of codes) {
    const path = `assets/flags/${code.toLowerCase()}.svg`;
    assert.ok(existsSync(path), `Missing ${code}`);
    const svg = readFileSync(path, 'utf8');
    assert.match(svg, /<svg/);
    assert.doesNotMatch(svg, /<script|\bonload\s*=/i);
  }
  assert.equal(h.run("grandPrixCountryCode({name:'British Grand Prix',country:'United Kingdom'})"),'GB');
  assert.equal(h.run("grandPrixCountryCode({name:'São Paulo Grand Prix'})"),'BR');
  const result = h.run(`selectOptionContent({textContent:'R1 · <script>',dataset:{country:'GB'}})`);
  assert.match(result, /assets\/flags\/gb\.svg/);
  assert.match(result, /&lt;script&gt;/);
  assert.doesNotMatch(h.run(`selectOptionContent({textContent:'Unknown',dataset:{country:'../bad'}})`), /<img/);
});

test('replacement UI restores focus without scrolling and honours reduced motion', () => {
  for (const reduced of [false, true]) {
    const h = context(reduced), animations = [], focus = [], attrs = [];
    const node = { dataset: { motionKey: 'driver-NOR' }, classList: { contains: c => c === 'selected' },
      getBoundingClientRect: () => ({left:12,top:24,width:120,height:44}), parentElement:null,
      matches: () => true, setAttribute: (...args) => attrs.push(args), focus: options => focus.push(options),
      animate: (...args) => animations.push(args) };
    let changed = false;
    h.sandbox.root = { querySelectorAll: () => changed ? [node] : [],
      set innerHTML(value) { changed = true; }, contains: () => false };
    h.sandbox.document.activeElement = { dataset: { motionKey: 'driver-NOR' } };
    h.run("replaceUI(root,'new markup')");
    assert.equal(focus[0].preventScroll, true);
    assert.deepEqual(attrs[0], ['aria-pressed','true']);
    assert.equal(animations.length, reduced ? 0 : 1);
  }
});

test('compact corner choices, grouped laps and motion accessibility are explicit', () => {
  const css=postcss.parse(readFileSync('apple-ui.css','utf8'));
  const corner=css.nodes.find(node=>node.type==='rule'&&node.selector==='.corner-pick');
  assert.ok(corner.nodes.some(d=>d.prop==='height'&&d.value==='32px'));
  assert.ok(css.nodes.some(n=>n.type==='atrule'&&n.params.includes('prefers-reduced-motion')));
  assert.ok(css.nodes.some(n=>n.type==='atrule'&&n.params.includes('prefers-reduced-transparency')));
  const html=readFileSync('index.html','utf8');
  assert.match(html,/comparison-summary-heading/);
  assert.match(html,/corner-collapse-region/);
  assert.ok(html.indexOf('class="dashboard-card session-controls"') < html.indexOf('<aside'));
});

test('Grand Prix open rule overrides its GP-specific closed rule', () => {
  const css = postcss.parse(readFileSync('apple-ui.css', 'utf8'));
  const rule = css.nodes.find(n => n.type === 'rule' && n.selector.includes('.select-shell.is-open:has(#gp) .select-menu'));
  assert.ok(rule, 'GP needs an open selector at least as specific as its closed selector');
  for (const [prop, value] of [['visibility', 'visible'], ['pointer-events', 'auto'], ['opacity', '1']]) {
    assert.ok(rule.nodes.some(d => d.prop === prop && d.value === value), prop);
  }
});

test('corner navigation precedes detail/map siblings and retains map height', () => {
  const html = readFileSync('index.html', 'utf8');
  const css = readFileSync('apple-ui.css', 'utf8');
  assert.ok(html.indexOf('id="cornerPickerRow"') < html.indexOf('id="cornerMetricGrid"'));
  assert.ok(html.indexOf('id="cornerMetricGrid"') < html.indexOf('id="dominanceCanvas"'));
  assert.equal((html.match(/id="dominanceCanvas"/g) || []).length, 1);
  assert.match(css, /@container \(min-width: 940px\)/);
  assert.match(css, /#dominanceCanvas\s*\{[^}]*height: clamp\(280px, 24vw, 420px\)/);
  assert.match(app, /positionCornerIndicator\(pickerRoot, pickerState\)/);
});

test('official graphics resolve only to verified local assets', () => {
  const h = context();
  const marks = h.run('[...new Set(Object.values(officialTeamMarks))]');
  assert.equal(marks.length, 11);
  for (const mark of marks) assert.ok(existsSync(`assets/teams/official/${mark}`));
  assert.match(h.run("teamLogoMarkup('Haas F1 Team')"), /haasf1team.webp/);
  assert.doesNotMatch(h.run("teamLogoMarkup('Kick Sauber')"), /audi/);
  assert.doesNotMatch(h.run("teamLogoMarkup('<img>')"), /<img/);
  for (const compound of ['hard','medium','soft','intermediate','wet']) {
    assert.ok(existsSync(`assets/tyres/official/${compound}.png`));
    assert.match(h.run(`tyreImageMarkup('${compound}')`), /class="tyre-image"/);
  }
});

test('driver list has fixed leading columns and stretched left-aligned names', () => {
  const css = postcss.parse(readFileSync('apple-ui.css', 'utf8'));
  const identity = css.nodes.find(n => n.type === 'rule' && n.selector === '.driver-pill-identity');
  for (const [prop, value] of [['justify-self','stretch'], ['width','100%'], ['text-align','left']]) {
    assert.ok(identity.nodes.some(d => d.prop === prop && d.value === value), prop);
  }
  assert.doesNotMatch(app, /class="pill driver-pill/);
  const logo = css.nodes.find(n => n.type === 'rule' && n.selector === '.team-logo');
  assert.ok(logo.nodes.some(d => d.prop === 'margin' && d.value === '0'));
  assert.ok(logo.nodes.some(d => d.prop === 'background' && d.value === 'transparent'));
});

test('site-wide elevation and independent comparison actions are retained', () => {
  const css = readFileSync('apple-ui.css','utf8');
  for (const token of ['--shadow-main', '--shadow-raised', '--shadow-inset']) {
    assert.ok((css.match(new RegExp(token + ':', 'g')) || []).length === 2, `${token} needs both themes`);
  }
  assert.match(app, /<button class="loaded-lap-main/);
  assert.match(app, /<button class="remove"/);
  assert.doesNotMatch(app, /<i class="remove"/);
  assert.match(css, /\.trace-driver-chip\.is-visible::after/);
});

test('scrollbars stay discoverable in both themes without changing layout', () => {
  const css = readFileSync('apple-ui.css','utf8');
  assert.equal((css.match(/--scroll-thumb:/g) || []).length, 2);
  assert.match(css, /html \{ scrollbar-gutter: stable;/);
  assert.match(css, /\.sidebar, \.select-menu \{ scrollbar-gutter: stable;/);
  assert.doesNotMatch(css, /scrollbar-width: none/);
  assert.doesNotMatch(css, /::-webkit-scrollbar\s*\{\s*display: none/);
  assert.match(css, /forced-colors: active/);
  assert.match(css, /:root body \* \{ scrollbar-width: auto; scrollbar-color: auto;/);
  assert.match(css, /\.sidebar \{ position: static; max-height: none; overflow: visible;/);
});

test('compact sector rows, contrasting logos and section boundary bars', () => {
  const css = readFileSync('apple-ui.css','utf8');
  assert.match(css, /filter: invert\(1\)/);
  assert.doesNotMatch(css, /filter: brightness\(0\)/);
  assert.match(app, /class="sector-delta-slot"/);
  assert.match(app, /highlightedCornerZone.start, highlightedCornerZone.end/);
  assert.doesNotMatch(app, /drawHighlightPath/);
  assert.match(app, /compoundBadgeMarkup\(lap.compound\)/);
  assert.match(app, /class="compound-badge".*role="img"/);
});

test('dense lap identity, editable trace colours and automatic map recovery', () => {
  assert.match(app, /const flag = `L\$\{lap.lap\}`/);
  assert.doesNotMatch(app, /<small>Pit → line<\/small>/);
  assert.match(app, /class="trace-swatch"/);
  assert.match(app, /new ResizeObserver/);
  assert.doesNotMatch(app, /Track map could not be sized/);
  assert.match(app, /e.clientX - tipRect.width - 15/);
  const h = context();
  assert.match(h.run("compoundBadgeMarkup('SOFT')"), /aria-label="soft"/);
});

test('driver selection never loads a lap; generic map uses independent geometry', () => {
  const driverSection = app.slice(app.indexOf('function renderDrivers()'), app.indexOf('function renderStintsLegacy()'));
  assert.doesNotMatch(driverSection, /loaded.push|fetchTelemetry|fastestTimedLap/);
  const mapSection = app.slice(app.indexOf('function renderGenericCircuit('), app.indexOf('function renderMiniSectorMap()'));
  assert.doesNotMatch(mapSection, /fetchTelemetry|fastestTimedLap/);
  assert.match(mapSection, /assets\/circuits\/f1-circuits.geojson/);
  const data = JSON.parse(readFileSync('assets/circuits/f1-circuits.geojson','utf8'));
  assert.ok(data.features.length > 30);
});

test('corner rankings are best-first, stable, null-safe and do not mutate reference order', () => {
  const h = context();
  h.run("var sampleMetrics = [{id:'a',metric:{sectionTime:6,minimumSpeed:140}},{id:'b',metric:{sectionTime:5,minimumSpeed:130}},{id:'c',metric:{sectionTime:null,minimumSpeed:null}}]");
  assert.equal(h.run("rankCornerMetrics(sampleMetrics,'time').map(x=>x.id).join()"), 'b,a,c');
  assert.equal(h.run("rankCornerMetrics(sampleMetrics,'delta').map(x=>x.id).join()"), 'b,a,c');
  assert.equal(h.run("rankCornerMetrics(sampleMetrics,'minimum').map(x=>x.id).join()"), 'a,b,c');
  assert.equal(h.run("sampleMetrics.map(x=>x.id).join()"), 'a,b,c');
  assert.match(app, /item.lap === referenceLap/);
  assert.doesNotMatch(app, /const compassCentre/);
  assert.match(app, /class="map-north"/);
});

test('data requests retry transient errors but not valid missing-data responses', async () => {
  const h = context(); let calls = 0;
  Object.assign(h.sandbox, {AbortController, DOMException, setTimeout: (fn, ms) => ms < 2000 ? setTimeout(fn, 0) : setTimeout(fn, ms), clearTimeout});
  h.sandbox.fetch = async () => ({status: ++calls < 3 ? 503 : 200, text: async()=>''});
  assert.equal((await h.run("fetchSessionData('/test')")).status, 200);
  assert.equal(calls, 3);
  calls = 0; h.sandbox.fetch = async () => {calls++;return {status:404};};
  assert.equal((await h.run("fetchSessionData('/missing')")).status, 404);
  assert.equal(calls, 1);
});
