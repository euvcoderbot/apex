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

test('race result display distinguishes points, lapped finishes, retirements and missing data', () => {
  const h = context();
  assert.match(h.run("raceResultMarkup({result:{points:0,status:'Retired'}})"), /0 pts.*DNF/);
  assert.match(h.run("raceResultMarkup({result:{points:null,status:'Finished'}})"), /—/);
  h.run("raceResultView='gap'");
  assert.match(h.run("raceResultMarkup({result:{status:'Finished',gap:1.271}})"), /\+1\.271s/);
  assert.match(h.run("raceResultMarkup({result:{status:'+1 Lap',gap:null}})"), /\+1 lap/);
  assert.match(h.run("raceResultMarkup({result:{status:'Did not start'}})"), /DNS/);
  assert.match(h.run("raceResultMarkup({result:{status:'Disqualified'}})"), /DSQ/);
});

test('colour overrides isolate laps of the same driver', () => {
  const h = context();
  h.run("drivers = [['VER',3,'Max','#4781d7'],['NOR',1,'Lando','#ff8000']]; lapColorOverrides.set('VER:17','#ff00aa')");
  assert.equal(h.run("getLapColor({code:'VER',lap:17})"), '#ff00aa');
  assert.equal(h.run("getLapColor({code:'VER',lap:8})"), '#4781d7');
  assert.equal(h.run("getDriverColor('VER')"), '#4781d7');
  h.run("lapColorOverrides.set('VER:8','#00aaff')");
  assert.equal(h.run("getLapColor({code:'VER',lap:17})"), '#ff00aa');
  assert.equal(h.run("getLapColor({code:'VER',lap:8})"), '#00aaff');
  assert.equal(h.run("getLapColor({code:'NOR',lap:18})"), '#ff8000');
});

test('selecting a lap opens comparison while manual guide choice survives redraws', () => {
  const h=context();
  h.run("renderAll=()=>{}; renderStints=()=>{}; realDrivers.set('VER',{laps:[{lap:17,time:90}]}); mapView='guide'; toggleLoadedLap('VER',17)");
  assert.equal(h.run('mapView'),'comparison');
  h.run("mapView='guide'; renderAll()");
  assert.equal(h.run('mapView'),'guide');
});

test('sector guide uses timed boundaries and rejects insufficient data', () => {
  const h=context();
  h.run(`resolveCornerMarkers=()=>[];
    testLap={time:30,s1:8.15,s2:10.2,s3:11.65};
    testSamples=Array.from({length:121},(_,i)=>({X:Math.cos(i/120*2*Math.PI)*1000,Y:Math.sin(i/120*2*Math.PI)*1000,Distance:i*40,ElapsedSeconds:i/4}));`);
  assert.equal(h.run('makeSectorGuide(testLap,testSamples,[]).segmentSectors.includes(2)'),true);
  assert.equal(h.run('makeSectorGuide(testLap,testSamples,[]).x.length'),123);
  assert.equal(h.run('makeSectorGuide({...testLap,s3:null},testSamples,[])'),null);
  assert.equal(h.run('makeSectorGuide({...testLap,time:32},testSamples,[])'),null);
  assert.equal(h.run('makeSectorGuide(testLap,testSamples.filter((_,i)=>i<30||i>40),[])'),null);
  assert.equal(h.run('makeSectorGuide(testLap,testSamples.map(p=>({...p,Y:null})),[])'),null);
  assert.equal(h.run('makeSectorGuide(testLap,testSamples.slice(8),[])'),null);
});

test('session selection uses fresh cancellable retrieval with no speculative load', () => {
  const prepare = app.slice(app.indexOf('function prepareSelectedSession'), app.indexOf('function notify'));
  assert.doesNotMatch(prepare, /loadApiData|fetchSessionData|setTimeout/);
  assert.match(app, /api\/session\?\$\{requestedQuery\}&fresh=true/);
  assert.match(app, /signal: request.signal, cache: 'no-store'/);
  assert.match(app, /query\.set\('driver_number', driver\.number\)/);
  assert.match(app, /query\.set\('lap_start_seconds', lapInfo\.lap_start_seconds\)/);
  assert.match(app, /query\.set\('lap_end_seconds', lapInfo\.lap_end_seconds\)/);
  const fastest = app.slice(app.indexOf("$('#compareAllFastest').onclick"), app.indexOf("root.querySelectorAll('.stint').forEach(button"));
  assert.match(fastest, /mapView = 'comparison'/);
});

test('map labels exclude whole track segments and stroke clearance', () => {
  const h = context();
  assert.equal(h.run('trackIntersectsLabel({x:40,y:40,width:20,height:18}, [{x:0,y:50},{x:100,y:50}])'), true);
  assert.equal(h.run('trackIntersectsLabel({x:40,y:40,width:20,height:18}, [{x:0,y:34},{x:100,y:34}])'), true);
  assert.equal(h.run('trackIntersectsLabel({x:40,y:40,width:20,height:18}, [{x:0,y:20},{x:100,y:20}])'), false);
});

test('corner leaders are omitted nearby and cannot cross or enter another label', () => {
  const h = context();
  assert.equal(h.run('cornerLabelConnector({x:0,y:0},{x:10,y:-8,width:20,height:16},[],[]).line'), null);
  assert.equal(h.run('cornerLabelConnector({x:0,y:0},{x:50,y:-8,width:20,height:16},[{a:{x:25,y:-20},b:{x:25,y:20}}],[])'), null);
  assert.equal(h.run('cornerLabelConnector({x:0,y:0},{x:50,y:-8,width:20,height:16},[],[{x:20,y:-8,width:10,height:16}])'), null);
  assert.equal(h.run('cornerLabelConnector({x:0,y:0},{x:50,y:-8,width:20,height:16},[],[]).line.b.x'), 50);
});

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

test('qualifying run pills show every compound and lap state precedes the time', () => {
  assert.match(app, /new Set\(laps\.map\(lap => String\(lap\.compound/);
  assert.match(app, /class="run-compounds">\$\{compoundBadges\}/);
  assert.match(app, /class="lap-token">\$\{flag\}\$\{context/);
  assert.match(app, /class="lap-clock">\$\{duration\}<\/span>/);
  const html = readFileSync('index.html', 'utf8');
  assert.match(html, /app\.js\?v=euv2-release-20260918/);
  assert.match(html, /alignment\.js\?v=euv2-release-20260917-2/);
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
  h.sandbox.fetch = async () => ({status: ++calls < 2 ? 503 : 200, text: async()=>''});
  assert.equal((await h.run("fetchSessionData('/test')")).status, 200);
  assert.equal(calls, 2);
  calls = 0; h.sandbox.fetch = async () => {calls++;return {status:404};};
  assert.equal((await h.run("fetchSessionData('/missing')")).status, 404);
  assert.equal(calls, 1);
});

test('reopening telemetry avoids network requests and cached samples stay immutable', async () => {
  const h = context(); let calls = 0;
  Object.assign(h.sandbox, {AbortController, DOMException, structuredClone, URL, setTimeout, clearTimeout});
  h.sandbox.fetch = async () => { calls++; return {status:200,ok:true,headers:{get:()=> 'public, max-age=86400'},text:async()=>JSON.stringify({samples:[{Speed:123}]})}; };
  const result = await h.run("loadApiData('https://example.test/api/telemetry?year=2025&driver=VER&lap=1')");
  result.samples[0].Speed = 999;
  const repeat = await h.run("loadApiData('https://example.test/api/telemetry?year=2025&driver=VER&lap=1')");
  assert.equal(repeat.samples[0].Speed, 123);
  assert.equal(calls, 1);
});

test('latest event selection follows the newest completed session timestamp', () => {
  const h = context();
  h.run(`var selectionCalendar = [
    {round: 9, name:'Older', date:'2026-09-01', sessions:['Race'], session_dates:{Race:'2026-09-01 14:00:00Z'}},
    {round: 11, name:'Future', date:'2026-09-20', sessions:['Practice 1','Race'], session_dates:{'Practice 1':'2026-09-20 10:00:00Z',Race:'2026-09-22 14:00:00Z'}},
    {round: 10, name:'Current', date:'2026-09-12', sessions:['Practice 1','Practice 2','Qualifying'], session_dates:{'Practice 1':'2026-09-11 10:00:00Z','Practice 2':'2026-09-11T14:00:00Z',Qualifying:'2026-09-12 14:00:00Z'}}
  ]`);
  assert.equal(h.run("latestCompletedSelection(selectionCalendar, Date.parse('2026-09-12T12:00:00Z')).event.name"), 'Current');
  assert.equal(h.run("latestCompletedSelection(selectionCalendar, Date.parse('2026-09-12T12:00:00Z')).session"), 'Practice 2');
  h.run("selectionCalendar[2].session_statuses={'Practice 1':'completed','Practice 2':'completed',Qualifying:'unknown'}");
  assert.equal(h.run("latestCompletedSelection(selectionCalendar, Date.parse('2026-09-13T12:00:00Z')).session"), 'Practice 2');
  h.sandbox.currentCalendar = JSON.parse(readFileSync('assets/data/events/2026.json', 'utf8'));
  assert.equal(h.run("latestCompletedSelection(currentCalendar, Date.parse('2026-09-17T00:00:00Z')).event.round"), 14);
  assert.equal(h.run("latestCompletedSelection(currentCalendar, Date.parse('2026-09-17T00:00:00Z')).session"), 'Race');
  h.sandbox.historicalCalendar = JSON.parse(readFileSync('assets/data/events/2021.json', 'utf8'));
  assert.equal(h.run("latestCompletedSelection(historicalCalendar, Date.parse('2026-09-17T00:00:00Z')).event.round"), 22);
  assert.equal(h.run("latestCompletedSelection(historicalCalendar, Date.parse('2026-09-17T00:00:00Z')).session"), 'Race');
});

test('Madrid rejects inherited Barcelona corner rows but accepts a 22-turn set', () => {
  const h = context();
  h.sandbox.document.querySelector = selector => selector === '#year'
    ? { value:'2026' }
    : selector === '#gp' ? { value:'14' } : null;
  h.run("calendar = [{round:14,name:'Spanish Grand Prix'}]");
  h.run("var barcelonaRows = Array.from({length:14}, (_,i)=>({number:String(i+1)})); var madridRows = Array.from({length:22}, (_,i)=>({number:String(i+1)}));");
  assert.equal(h.run('markerRowsForCurrentCircuit(barcelonaRows).length'), 24);
  assert.equal(h.run('markerRowsForCurrentCircuit([]).length'), 24);
  assert.equal(h.run("markerRowsForCurrentCircuit([]).filter(r => r.letter === 'A').length"), 2);
  assert.equal(h.run("markerRowsForCurrentCircuit([]).find(r => r.number === '7').distance"), 1924);
  assert.equal(h.run("markerRowsForCurrentCircuit([]).find(r => r.number === '16').distance"), 3928);
  assert.equal(h.run('markerRowsForCurrentCircuit([]).every((r,i,a) => r.approximate && r.fraction > 0 && r.fraction < 1 && (!i || r.fraction > a[i-1].fraction))'), true);
  assert.equal(h.run('markerRowsForCurrentCircuit(madridRows).length'), 22);
  assert.equal(h.run('resolveCornerMarkers([{Distance:0},{Distance:5414}],5414,[]).length'), 24);
  h.run("sessionYear = 2025; sessionEventName = 'Spanish Grand Prix'");
  assert.equal(h.run('markerRowsForCurrentCircuit(barcelonaRows).length'), 14);
  h.run("sessionYear = 2026; sessionEventName = 'Barcelona Grand Prix'");
  assert.equal(h.run('markerRowsForCurrentCircuit(barcelonaRows).length'), 14);
});

test('car performance controls hide irrelevant GP and expose sortable methodology', () => {
  const performance = readFileSync('car-performance.js', 'utf8');
  const css = readFileSync('car-performance.css', 'utf8');
  const html = readFileSync('index.html', 'utf8');
  assert.match(css, /\.performance-toolbar \[hidden\]\s*\{\s*display:none!important/);
  assert.match(performance, /performanceEventField.*hidden=.*performanceScope.*season/);
  assert.match(performance, /data-performance-sort/);
  assert.match(performance, /Sustained full-throttle speed \(P95\)/);
  assert.match(performance, /Only corners present for every compared team/);
  assert.match(html, /does not provide brake pressure/);
});
