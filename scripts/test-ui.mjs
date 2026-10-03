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
  assert.match(h.run("raceResultMarkup({result:{status:'Finished',gap:'+1.271'}})"), /\+1\.271s/);
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

test('actual circuit identity resolves Sepang despite the Bahrain event name', () => {
  const h=context();
  h.sandbox.document.querySelector = selector => ({value:selector==='#gp'?'16':'2026'});
  h.run("calendar=[{round:16,name:'Bahrain Grand Prix',location:'Kuala Lumpur',circuit_key:12}]; sessionEventName='Bahrain Grand Prix'; sessionYear=2026; sessionCircuitKey=12; sessionLocation='Kuala Lumpur'");
  assert.equal(h.run('isSepangCircuit(calendar[0])'),true);
  assert.equal(h.run('markerRowsForCurrentCircuit([]).length'),15);
  assert.equal(h.run('markerRowsForCurrentCircuit([]).at(-1).number'),'15');
  assert.equal(h.run("markerRowsForCurrentCircuit([{number:'1',fraction:.1}]).length"),1);
  h.run("sessionCircuitKey=63;sessionLocation='Sakhir'");
  assert.equal(h.run('isSepangCircuit({circuit_key:63,location:"Sakhir"})'),false);
  assert.equal(h.run('isSepangCircuit({circuit_key:63,location:"Kuala Lumpur"})'),false);
  assert.equal(h.run('markerRowsForCurrentCircuit([]).length'),0);
  h.sandbox.coords=JSON.parse(readFileSync('assets/circuits/f1-circuits.geojson','utf8')).features.find(f=>f.properties.id==='my-1999').geometry.coordinates;
  for (const width of [400,640,1000]) {
    const labels=[];
    h.sandbox.ctx=new Proxy({measureText:t=>({width:t.length*7}),fillText:t=>labels.push(t)}, {get:(o,k)=>o[k]||(()=>{})});
    h.sandbox.rect={width,height:400};
    h.run(`lightThemeActive=()=>false;canvasFont=()=>'';
      drawApiCircuitGuide(ctx,{x:coords.map(p=>p[0]),y:coords.map(p=>p[1]),
        corners:SEPANG_MAP_CORNERS.map(c=>({...c,trackPosition:{x:coords[c.outlineIndex][0],y:coords[c.outlineIndex][1]}}))},rect)`);
    assert.equal(labels.length,15,`all Sepang labels at ${width}px`);
  }
});

test('current calendar bypasses browser response cache', async () => {
  const h=context(); let calls=0;
  Object.assign(h.sandbox,{URL,AbortController,DOMException,structuredClone,setTimeout,clearTimeout});
  h.sandbox.fetch=async()=>{calls++;return {status:200,ok:true,headers:{get:()=>null},text:async()=>JSON.stringify([{round:16}])};};
  const url=`https://example.test/api/events?year=${new Date().getFullYear()}&status=result-v3`;
  await h.run(`requestApiData(${JSON.stringify(url)})`);
  await h.run(`requestApiData(${JSON.stringify(url)})`);
  assert.equal(calls,2);
});

test('session selection uses fresh cancellable retrieval with no speculative load', () => {
  assert.match(app, /for \(let y = currentYear; y >= 2018; y--\)/);
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
  assert.match(imports, /@layer focus, legacy, interface/);
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
  assert.match(html, /app\.js\?v=euv2-release-[\w-]+/);
  assert.match(html, /alignment\.js\?v=euv2-release-[\w-]+/);
});

test('pit laps can be selected and a later corner cannot snap to an earlier pass', () => {
  const h = context();
  assert.match(h.run("lapText({lap:8,in_lap:true,out_lap:true,time:null})"), /^IN\/OUT L8/);
  h.run("renderAll=()=>{}; renderStints=()=>{}; realDrivers.set('VER',{laps:[{lap:8,time:null,out_lap:true,display_time:133}]}); toggleLoadedLap('VER',8)");
  assert.equal(h.run('loaded.length'), 1);
  assert.equal(h.run('loaded[0].real.out_lap'), true);
  assert.equal(h.run('loaded[0].time'), null);
  h.run(`markerRowsForCurrentCircuit=rows=>rows;
    testCornerSamples=[
      {Distance:0,X:0,Y:0}, {Distance:1000,X:100,Y:0},
      {Distance:1100,X:110,Y:0}, {Distance:3000,X:300,Y:0},
      {Distance:4000,X:130,Y:0}
    ];
    testCornerRows=[
      {number:'5',x:100,y:0}, {number:'6',x:110,y:0},
      {number:'19',x:300,y:0}, {number:'20',x:105,y:0}
    ];`);
  assert.equal(h.run("resolveCornerMarkers(testCornerSamples,4000,testCornerRows).find(row=>row.number==='20').fraction"), 1);
});

test('confirmed 2026 compounds correct stale API nominations', () => {
  const h = context();
  for (const event of ['Barcelona Grand Prix', 'Dutch Grand Prix', 'Spanish Grand Prix', 'Bahrain Grand Prix']) {
    assert.equal(h.run(`verifiedTireNominations(2026, ${JSON.stringify(event)}, ['C1','C2','C3']).join(',')`), 'C2,C3,C4');
  }
  assert.equal(h.run("verifiedTireNominations(2026, 'Azerbaijan Grand Prix', ['C3','C4','C5']).join(',')"), 'C3,C4,C5');
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
  h.run("var bakuCalendar=[{round:15,name:'Azerbaijan Grand Prix',date:'2026-09-26',sessions:['Practice 2','Race'],session_end_dates:{'Practice 2':'2026-09-24T13:00:00Z',Race:'2026-09-26T13:00:00Z'},session_statuses:{'Practice 2':'unknown',Race:'unknown'}}]");
  assert.equal(h.run("latestCompletedSelection(bakuCalendar, Date.parse('2026-09-28T02:00:00Z')).session"), 'Race');
  h.run(`var statuses=[
    {round:1,name:'Finished GP',sessions:['Qualifying','Race'],session_end_dates:{Qualifying:'2026-09-20T15:00:00Z',Race:'2026-09-21T15:00:00Z'},session_statuses:{Qualifying:'completed',Race:'completed'}},
    {round:2,name:'Interrupted GP',sessions:['Practice 1','Practice 2','Qualifying','Race'],session_end_dates:{'Practice 1':'2026-09-28T10:00:00Z','Practice 2':'2026-09-28T14:00:00Z',Qualifying:'2026-09-28T17:00:00Z',Race:'2026-09-29T14:00:00Z'},session_statuses:{'Practice 1':'completed','Practice 2':'interrupted',Qualifying:'live',Race:'upcoming'}},
    {round:3,name:'Cancelled GP',sessions:['Race'],session_end_dates:{Race:'2026-09-27T12:00:00Z'},session_statuses:{Race:'cancelled'}}]`);
  assert.equal(h.run("latestCompletedSelection(statuses, Date.parse('2026-09-29T07:00:00Z')).event.name"), 'Interrupted GP');
  assert.equal(h.run("latestCompletedSelection(statuses, Date.parse('2026-09-29T07:00:00Z')).session"), 'Practice 1');
  h.run("statuses[1].session_statuses['Practice 1']='unknown'");
  assert.equal(h.run("latestCompletedSelection(statuses, Date.parse('2026-09-29T07:00:00Z')).event.name"), 'Finished GP');
  h.run("statuses[1].session_end_dates['Practice 1']='2026-09-20T10:00:00Z'");
  assert.equal(h.run("latestCompletedSelection(statuses, Date.parse('2026-09-29T07:00:00Z')).event.name"), 'Finished GP');
  h.run("statuses[1].session_end_dates['Practice 1']='2026-09-22T10:00:00Z'");
  assert.equal(h.run("latestCompletedSelection(statuses, Date.parse('2026-09-29T07:00:00Z')).session"), 'Practice 1');
  h.run("statuses[1].session_statuses['Practice 1']='completed'; statuses[1].session_end_dates['Practice 1']='2026-09-30T10:00:00Z'");
  assert.equal(h.run("latestCompletedSelection(statuses, Date.parse('2026-09-29T07:00:00Z')).event.name"), 'Finished GP');
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
  assert.match(performance, /Settled straight-section performance/);
  assert.match(performance, /Exit-inclusive lap attribution \(previous chart\)/);
  assert.match(performance, /Extra slowing time/);
  assert.match(performance, /data-braking-view="approach"/);
  assert.match(performance, /Approach time gap/);
  assert.match(performance, /valueKey: selectedBrakeView==='approach'\?'approachS':'slowingS'/);
  assert.match(performance, /Extra seconds per measured zone to shed the same speed/);
  assert.match(html, /\+0\.102 s means about a tenth of a second longer per measured braking zone/);
  assert.match(performance, /50_100.*100_150.*300_350/);
  assert.match(performance, /Show explanations/);
  assert.match(performance, /Time lost across all corners in each band/);
  assert.match(html, /not brake pressure/);
});

test('qualifying top speed is a GP-relative speed deficit, independent of traversal', () => {
  const source=readFileSync('car-performance.js','utf8');
  const body=source.slice(source.indexOf('function eventTelemetry(event)'),source.indexOf('function seasonTelemetry('));
  const sandbox={finite:Number.isFinite,avg:a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null,median:a=>a.length?a[0]:null};
  vm.createContext(sandbox);vm.runInContext(body,sandbox);
  const teams=['A','B','C'].map(team=>({team}));
  const traces={A:{corners:[],braking:[],top_speed:350,straight_traversal_delta:1},B:{corners:[],braking:[],top_speed:343,straight_traversal_delta:0},C:{corners:[],braking:[],top_speed:null}};
  const result=sandbox.eventTelemetry({Q:{teams},traces});
  assert.equal(result.rows.get('A').topDeficit,0);
  assert.ok(Math.abs(result.rows.get('B').topDeficit-2)<1e-9);
  assert.equal(result.rows.get('C').topDeficit,null);
  assert.equal(result.rows.get('B').trace.straight_traversal_delta,0);
  assert.match(source,/topSpeed:eventAdjustedScores\(targetReports,row=>row.topDeficit,mode\)/);
  assert.match(source,/Qualifying top speeds by Grand Prix/);
});

test('qualifying braking time ranks shared zones and leaves unsupported teams unscored', () => {
  const source = readFileSync('car-performance.js', 'utf8');
  const body = source.slice(source.indexOf('function eventTelemetry(event)'), source.indexOf('function seasonTelemetry('));
  const sandbox = {
    brakingQualityMode:'supported',
    finite: value => typeof value === 'number' && Number.isFinite(value),
    avg: values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null,
    median: values => {
      const a = values.filter(Number.isFinite).sort((x, y) => x - y);
      return a.length ? a[Math.floor(a.length / 2)] : null;
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(body, sandbox);
  const makeZones = (time, decel, distance, count = 3) => Array.from({ length: count }, (_, i) => ({
    corner: `T${i + 1}`, start: i * 1000 + 50, corridor_time: time,
    corridor_ref_time: 2, normalized_decel_g: decel, distance,
    method:'matched-speed-v1', mode:'straight', quality:'supported', entry_speed:280, exit_speed:180,
    early_g: decel, mean_g: decel, duration: time, approach_time:time*1.3,
    sampling_resolution_m: 20
  }));
  const entrants = ['A', 'B', 'C', 'D'].map(team => ({ team, color: '#123456' }));
  const traces = Object.fromEntries(entrants.map(({ team }, i) => [team, {
    corners: [], braking: makeZones(2 + i * .2, 3 - i * .2, 80 + i * 5, i === 3 ? 1 : 3),
    lap_distance: 5000, reference_lap_time: 90
  }]));
  const result = sandbox.eventTelemetry({ Q: { teams: entrants }, traces });
  traces.D.braking[0].approach_comparable=false;
  const screened=sandbox.eventTelemetry({Q:{teams:entrants},traces});
  assert.equal(screened.rows.get('D').brakingApproachMs,null,
    'a rejected boundary-speed comparison must not enter the approach ranking');
  assert.ok(Number.isFinite(screened.rows.get('B').brakingApproachMs));
  assert.equal(result.rows.get('A').brakingScoreZones, 3);
  assert.ok(result.rows.get('A').brakingScore < result.rows.get('B').brakingScore);
  assert.ok(result.rows.get('B').brakingScore < result.rows.get('C').brakingScore);
  assert.ok(result.rows.get('A').brakingApproachMs < result.rows.get('B').brakingApproachMs);
  assert.ok(Math.abs(result.rows.get('B').brakingApproachMs/1000-.26)<.001,
    'a 260 ms approach gap should display as +0.260 s');
  assert.ok(Math.abs(result.rows.get('B').brakingSlowingS-.2)<.001,
    '2.2 seconds versus 2.0 seconds should show +0.200 s per matched braking zone');
  assert.ok(Math.abs(100*Math.expm1(result.rows.get('B').brakingScore/100)-10)<.001,
    '2.2 seconds versus 2.0 seconds should be 10% longer, independent of lap time');
  assert.equal(result.rows.get('D').brakingScoreZones, 1);
  assert.equal(result.rows.get('A').brakeZones, 3);
  assert.equal(result.rows.get('D').brakeDistance, 95);
  traces.A.braking.forEach(z=>z.quality='provisional');
  assert.equal(sandbox.eventTelemetry({Q:{teams:entrants},traces}).rows.get('A').brakingScore,undefined);
  sandbox.brakingQualityMode='all';
  assert.ok(Number.isFinite(sandbox.eventTelemetry({Q:{teams:entrants},traces}).rows.get('A').brakingScore));
  traces.A.braking.forEach(z=>delete z.method);
  assert.equal(sandbox.eventTelemetry({Q:{teams:entrants},traces}).rows.get('A').brakingScore,undefined,
    'legacy corridor-time payloads must not be silently ranked by the new method');
});

test('braking retains zones measured by three teams without requiring every entrant', () => {
  const source = readFileSync('car-performance.js', 'utf8');
  const body = source.slice(source.indexOf('function eventTelemetry(event)'), source.indexOf('function seasonTelemetry('));
  const sandbox = {
    brakingQualityMode:'supported',
    finite: value => typeof value === 'number' && Number.isFinite(value),
    avg: values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null,
    median: values => {
      const a = values.filter(Number.isFinite).sort((x, y) => x - y);
      return a.length ? a[Math.floor(a.length / 2)] : null;
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(body, sandbox);
  const teams=['A','B','C','D'].map(team=>({team,color:'#123456'}));
  const traces=Object.fromEntries(teams.map(({team},i)=>[team,{
    corners:[],lap_distance:5000,reference_lap_time:90,
    braking:Array.from({length:i===3?1:3},(_,j)=>({corner:`T${j+1}`,corridor_time:2+i*.1,
      method:'matched-speed-v1',mode:'straight',quality:'supported',entry_speed:280,exit_speed:180,duration:2+i*.1,
      distance:60+i,mean_g:2+i*.1,normalized_decel_g:2+i*.1}))
  }]));
  const rows=sandbox.eventTelemetry({Q:{teams},traces}).rows;
  assert.equal(rows.get('A').brakeZones,3);
  assert.equal(rows.get('B').brakeZones,3);
  assert.equal(rows.get('D').brakingScoreZones,1);
  assert.equal(rows.get('A').brakeDistance,60);
  delete traces.D.corners;
  assert.equal(sandbox.eventTelemetry({Q:{teams},traces}).rows.has('D'),true);
});

test('season telemetry retains partial qualifying cohorts instead of intersecting all teams', () => {
  const source=readFileSync('car-performance.js','utf8');
  const body=source.slice(source.indexOf('function eventAdjustedScores('),source.indexOf('// Circuit Discrepancy Reconciliation Box'));
  const summaries=[
    {rows:new Map([['A',{team:'A',color:'#111',categories:{},trace:{lap_gap:0}}],['B',{team:'B',color:'#222',categories:{},trace:{lap_gap:.2}}]])},
    {rows:new Map([['B',{team:'B',color:'#222',categories:{},trace:{lap_gap:.1}}],['C',{team:'C',color:'#333',categories:{},trace:{lap_gap:.3}}]])}
  ];
  const sandbox={events:[{name:'One'},{name:'Two'}],context:{season:true},STRAIGHT_BANDS:[],finite:v=>typeof v==='number'&&Number.isFinite(v),avg:values=>values.length?values.reduce((a,b)=>a+b,0)/values.length:null,eventTelemetry:()=>summaries.shift()};
  vm.createContext(sandbox);
  vm.runInContext(body,sandbox);
  const result=sandbox.seasonTelemetry();
  assert.equal(result.length,3);
  assert.equal(result.find(row=>row.team==='B').events,2);
  assert.equal(result.commonEvents.length,2);
});

test('season effects bridge unequal circuit coverage through shared teams', () => {
  const source=readFileSync('car-performance.js','utf8');
  const body=source.slice(source.indexOf('function eventAdjustedScores('),source.indexOf('function seasonTelemetry('));
  const sandbox={finite:v=>typeof v==='number'&&Number.isFinite(v),avg:values=>values.reduce((a,b)=>a+b,0)/values.length};
  vm.createContext(sandbox);
  vm.runInContext(body,sandbox);
  const reports=[
    {event:{name:'One'},summary:{rows:new Map([['A',{team:'A',value:0}],['B',{team:'B',value:1}],['C',{team:'C',value:2}]])}},
    {event:{name:'Two'},summary:{rows:new Map([['B',{team:'B',value:0}],['C',{team:'C',value:1}],['D',{team:'D',value:2}]])}}
  ];
  const scores=sandbox.eventAdjustedScores(reports,row=>row.value);
  assert.ok(Math.abs(scores.get('A'))<.001);
  assert.ok(Math.abs(scores.get('B')-1)<.001);
  assert.ok(Math.abs(scores.get('C')-2)<.001);
  assert.ok(Math.abs(scores.get('D')-3)<.001);
  sandbox.median=values=>{const x=[...values].sort((a,b)=>a-b);return x.length%2?x[(x.length-1)/2]:(x[x.length/2-1]+x[x.length/2])/2;};
  const robust=sandbox.eventAdjustedScores(reports,row=>row.value,'median');
  assert.ok(Math.abs(robust.get('B')-1)<.001);
  reports.push({event:{name:'Isolated'},summary:{rows:new Map(['E','F','G'].map((team,i)=>[team,{team,value:i}]))}});
  const separated=sandbox.eventAdjustedScores(reports,row=>row.value);
  assert.equal(separated.size,4);
  assert.equal(separated.has('E'),false);
  sandbox.telemetryCoverageMode='common';
  const common=sandbox.eventAdjustedScores(reports.slice(0,2),row=>row.value);
  assert.equal(common.size,3,'common mode never infers the fourth constructor');
  assert.deepEqual(Array.from(common.coverage.events),['One']);
  assert.equal(common.has('D'),false);
});

test('qualifying evolution excludes compound changes, unknown tyres and rainy laps', () => {
  const source=readFileSync('car-performance.js','utf8');
  const body=source.slice(source.indexOf('function qualifyingEvolutionSample('),source.indexOf('function aggregate('));
  const sandbox={finite:Number.isFinite};vm.createContext(sandbox);vm.runInContext(body,sandbox);
  const team={team:'A',phase_details:['Q1','Q2','Q3'].map((phase,i)=>({phase,driver:'AAA',time:90-i*.3,compound:'SOFT'}))};
  assert.equal(sandbox.qualifyingEvolutionSample([team]).length,3);
  team.phase_details[1].compound='MEDIUM';
  assert.equal(sandbox.qualifyingEvolutionSample([team]).length,0);
  team.phase_details[1].compound=null;
  assert.equal(sandbox.qualifyingEvolutionSample([team]).length,0);
  team.phase_details[1].compound='SOFT';team.phase_details[1].rain=true;
  assert.equal(sandbox.qualifyingEvolutionSample([team]).length,0);
});

test('race trap season ranking uses event-relative speed and paired qualifying ST', () => {
  const source=readFileSync('car-performance.js','utf8');
  const body=source.slice(source.indexOf('function eventAdjustedScores('),source.indexOf('function seasonTelemetry('));
  const sandbox={finite:v=>typeof v==='number'&&Number.isFinite(v),avg:values=>values.length?values.reduce((a,b)=>a+b,0)/values.length:null};
  vm.createContext(sandbox);
  vm.runInContext(body,sandbox);
  const entry=(team,speed)=>({team,color:'#123456',race_speed_trap_matched:speed,race_speed_trap_matched_laps:12});
  const qEntry=(team,speed)=>({team,speed_trap:speed});
  const events=[
    {name:'Fast circuit',R:{teams:[entry('A',330),entry('B',320),entry('C',310)]},Q:{teams:[qEntry('A',335),qEntry('B',325),qEntry('C',315)]}},
    {name:'Slow circuit',R:{teams:[entry('B',280),entry('C',270),entry('D',260)]},Q:{teams:[qEntry('B',285),qEntry('C',275),qEntry('D',265)]}}
  ];
  const rows=sandbox.seasonRaceTrapRows(events);
  const byTeam=new Map(rows.map(row=>[row.team,row]));
  assert.ok(byTeam.get('A').raceDeficit<byTeam.get('B').raceDeficit);
  assert.ok(byTeam.get('B').raceDeficit<byTeam.get('C').raceDeficit);
  assert.ok(byTeam.get('C').raceDeficit<byTeam.get('D').raceDeficit);
  assert.equal(byTeam.get('B').events,2);
  assert.equal(byTeam.get('B').paired,2);
  assert.ok(Number.isFinite(byTeam.get('B').qualyDeficit));
});

test('overall tyre chart shows sparse matched evidence as provisional', () => {
  const source=readFileSync('car-performance.js','utf8');
  const body=source.slice(source.indexOf('function renderRace(teams)'),source.indexOf('function renderResults('));
  assert.match(body,/minimumCompoundEvents=1/);
  assert.match(body,/\.filter\(c => c && c\.events\.length >= minimumCompoundEvents\)/);
  assert.match(body,/compoundNorm\.length \? avg\(compoundNorm\) : null/);
  assert.match(body,/!r\.complete\?`<small>Provisional/);
});

test('tyre-age view aggregates own stints for teams and individual drivers', () => {
  const source=readFileSync('car-performance.js','utf8');
  const body=source.slice(source.indexOf('function tyreViewControls()'),source.indexOf('function renderRace(teams)'));
  const sandbox={tyreMetric:'age',tyreSubject:'team',tyreView:'OVERALL',tyreSeasonStat:'mean',tyreLapMode:'all',tyreCorrection:'fuel',tyreFuelRate:.060,tyreWeighting:'balanced',tyreRunKey:'',tyrePlotTeam:'',tyrePlotDriver:'',tyrePlotEvent:'',sortKey:'tyreAgeValue',sortDirection:1,
    tyreConditionMode:'all',context:{year:'2026'},events:[{round:1,R:{}},{round:2,R:{}}],
    VERIFIED_DRY_ALLOCATIONS:{2026:['345','234']},TYRE_ALLOCATION_SOURCES:{2026:'https://press.pirelli.com/'},
    finite:n=>typeof n==='number'&&Number.isFinite(n),avg:a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null,
    summarize:(a)=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null,
    sorted:(items,getters,key)=>[...items].sort((a,b)=>getters[key](a)-getters[key](b)),
    teamLabel:r=>r.displayName,card:(_title,_note,content)=>content,table:(_headers,rows)=>JSON.stringify(rows),
    sortHeader:(_key,label)=>label,color:v=>v,signed:(n)=>n.toFixed(3),escape:v=>String(v),eventLabel:v=>v,fmt:n=>n.toFixed(3)};
  vm.createContext(sandbox);
  vm.runInContext(body,sandbox);
  const teams=[{team:'Example',color:'#123456',tyreAgeStints:[
    {driver:'AAA',event:'One',compound:'SOFT',compound_grade:'C5',fuel_adjusted_slope:.12,samples:8,min_age:1,max_age:8,points:[{lap:3,age:1,time:90.123},{lap:4,age:2,time:90.183},{lap:5,age:3,time:90.243}]},
    {driver:'BBB',event:'One',compound:'SOFT',compound_grade:'C5',fuel_adjusted_slope:.04,samples:8,min_age:1,max_age:8},
    {driver:'AAA',event:'Two',compound:'MEDIUM',compound_grade:'C3',fuel_adjusted_slope:.02,samples:10,min_age:1,max_age:10}
  ]}];
  const team=sandbox.renderTyreAge(teams);
  assert.match(team,/0\.050/); // equal event weighting: C5 (.08), then C3 (.02)
  assert.match(team,/2 C grades/);
  assert.match(team,/C5/);
  assert.match(team,/90\.123 s observed/);
  assert.match(team,/data-tyre-run=/);
  assert.doesNotMatch(team,/NaN|Infinity/);
  assert.match(team,/data-tyre-plot-filter="team"/);
  sandbox.tyreFuelRate=.080;
  assert.match(sandbox.renderTyreAge(teams),/performance-tyre-age-value">0\.070/);
  sandbox.tyreFuelRate=.060;
  const other={team:'Other',color:'#654321',tyreAgeStints:[{driver:'CCC',event:'Three',compound_grade:'C5',fuel_adjusted_slope:.04,samples:8,min_age:1,max_age:8,points:[{lap:3,age:1,time:92},{lap:4,age:2,time:92.04},{lap:5,age:3,time:92.08}]}]};
  sandbox.tyrePlotTeam='Other';
  const selected=sandbox.renderTyreAge([...teams,other]);
  assert.match(selected,/CCC · Three/);
  assert.match(selected,/2 teams available/);
  sandbox.tyrePlotTeam='';
  sandbox.tyreView='C3';
  assert.match(sandbox.renderTyreAge(teams),/0\.020/);
  assert.doesNotMatch(sandbox.renderTyreAge(teams),/performance-tyre-age-value">0\.080/);
  sandbox.tyreView='OVERALL';
  sandbox.tyreSubject='driver';
  const drivers=sandbox.renderTyreAge(teams);
  assert.match(drivers,/AAA · Example/);
  assert.match(drivers,/BBB · Example/);
  sandbox.tyreSubject='team';sandbox.tyreView='C5';
  teams[0].tyreAgeStints[0].samples=32;
  assert.match(sandbox.renderTyreAge(teams),/0\.080/); // driver weights stay equal
  sandbox.tyreWeighting='laps';
  assert.match(sandbox.renderTyreAge(teams),/0\.104/);
  sandbox.tyreWeighting='balanced';sandbox.tyreCorrection='raw';
  teams[0].tyreAgeStints[0].raw_slope=.06;teams[0].tyreAgeStints[1].raw_slope=-.02;
  assert.match(sandbox.renderTyreAge(teams),/0\.020/);
  sandbox.tyreCorrection='fuel';sandbox.tyreLapMode='clear';
  teams[0].tyreAgeStints[0].clean_air={supported:true,samples:12,fuel_adjusted_slope:.03,min_age:1,max_age:14};
  assert.match(sandbox.renderTyreAge(teams),/0\.030/);
});

test('tyre GP summaries handle skew and explain every sparse P75 blank', () => {
  const source=readFileSync('car-performance.js','utf8');
  const body=source.slice(source.indexOf('function tyreViewControls()'),source.indexOf('function renderRace(teams)'));
  const sandbox={tyreMetric:'age',tyreSubject:'team',tyreView:'C3',tyreSeasonStat:'mean',tyreLapMode:'all',tyreCorrection:'fuel',tyreFuelRate:.060,tyreWeighting:'balanced',tyreRunKey:'',tyrePlotTeam:'',tyrePlotDriver:'',tyrePlotEvent:'',sortKey:'tyreAgeValue',sortDirection:1,
    tyreConditionMode:'all',context:{year:2026},events:[1,2,3,4].map(round=>({round,R:{}})),
    VERIFIED_DRY_ALLOCATIONS:{2026:['123','123','123','123']},TYRE_ALLOCATION_SOURCES:{2026:'https://press.pirelli.com/'},
    finite:Number.isFinite,avg:a=>{const x=a.filter(Number.isFinite);return x.length?x.reduce((s,v)=>s+v,0)/x.length:null;},
    summarize:(a,mode)=>{const x=a.filter(Number.isFinite).sort((v,w)=>v-w);if(!x.length)return null;if(mode==='median')return(x[Math.floor((x.length-1)/2)]+x[Math.ceil((x.length-1)/2)])/2;if(mode==='p75'){const i=(x.length-1)*.75,l=Math.floor(i),h=Math.ceil(i);return x[l]+(x[h]-x[l])*(i-l);}return x.reduce((s,v)=>s+v,0)/x.length;},
    sorted:(rows,getters,key)=>[...rows].sort((a,b)=>(getters[key](a)??Infinity)-(getters[key](b)??Infinity)),
    teamLabel:r=>r.displayName,card:(_title,_note,body)=>body,table:(_headers,rows)=>JSON.stringify(rows),sortHeader:(_key,label)=>label,
    color:v=>v,signed:n=>n.toFixed(3),escape:v=>String(v),eventLabel:v=>v,fmt:n=>n.toFixed(3)};
  vm.createContext(sandbox);vm.runInContext(body,sandbox);
  const slopes=[.01,.02,.03,.5];
  const teams=[{team:'Measured',color:'#123456',tyreAgeStints:slopes.map((s,i)=>({event:`GP ${i+1}`,compound_grade:'C3',fuel_adjusted_slope:s,samples:8}))},
    {team:'Missing',color:'#888888',tyreAgeStints:[]}];
  for(const [mode,expected] of [['mean','0.140'],['median','0.025'],['p75','0.147']]){
    sandbox.tyreSeasonStat=mode;
    assert.match(sandbox.renderTyreAge(teams),new RegExp(expected));
  }
  sandbox.tyreSeasonStat='p75';
  teams[0].tyreAgeStints.pop();
  const sparse=sandbox.renderTyreAge(teams);
  assert.match(sparse,/C3: 3\/4 GPs/);
  assert.match(sparse,/Missing/);
  sandbox.tyreView='OVERALL';
  teams[0].tyreAgeStints.push({event:'GP 4',compound_grade:'C3',fuel_adjusted_slope:.5,samples:8});
  teams[0].tyreAgeStints.push({event:'GP 1',compound_grade:'C2',fuel_adjusted_slope:.04,samples:8});
  assert.match(sandbox.renderTyreAge(teams),/C2: 1\/4 GPs/);
});

test('tyre-age C grades use the race-year Pirelli allocation, including skipped 2025 grades', () => {
  const source=readFileSync('car-performance.js','utf8');
  const body=source.slice(source.indexOf('const VERIFIED_DRY_ALLOCATIONS'),source.indexOf('// Team marks'));
  const sandbox={};
  vm.createContext(sandbox);
  vm.runInContext(body,sandbox);
  assert.equal(sandbox.verifiedDryGrade(2026,7,'MEDIUM'),'C3'); // Barcelona C2/C3/C4
  assert.equal(sandbox.verifiedDryGrade(2026,15,'HARD'),'C3'); // Baku C3/C4/C5
  assert.equal(sandbox.verifiedDryGrade(2025,17,'SOFT'),'C6'); // Baku C4/C5/C6
  assert.equal(sandbox.verifiedDryGrade(2025,19,'HARD'),'C1'); // Austin skips C2
  assert.equal(sandbox.verifiedDryGrade(2025,20,'MEDIUM'),'C4'); // Mexico skips C3
  assert.equal(sandbox.verifiedDryGrade(2024,1,'SOFT'),'C3');
  assert.equal(sandbox.verifiedDryGrade(2023,1,'SOFT'),'C3');
  assert.equal(sandbox.verifiedDryGrade(2022,3,'SOFT'),'C5'); // Australia skips C4
  assert.equal(sandbox.verifiedDryGrade(2021,8,'HARD'),'C2'); // Styrian GP
  assert.equal(sandbox.verifiedDryGrade(2021,9,'HARD'),'C3'); // Austrian GP
  assert.equal(sandbox.verifiedDryGrade(2020,1,'SOFT'),null);
  assert.equal(sandbox.verifiedDryGrade(2026,1,'INTERMEDIATE'),null);
});

test('tyre-age trend screens residuals and reports exclusions without an age window', () => {
  const api=readFileSync('performance.py','utf8');
  const view=readFileSync('car-performance.js','utf8');
  assert.match(api,/individual_rows = \[r for r in valid_all/);
  assert.match(api,/residual-residual_mid/);
  assert.match(api,/'outlier_laps': len\(laps\)-len\(used\)/);
  assert.match(view,/Outlier laps removed/);
  assert.doesNotMatch(view.slice(view.indexOf('function renderTyreAge'),view.indexOf('function renderRace')),/Tyre-age range/);
});

test('pit category keeps stationary and lane averages separate by team and driver', () => {
  const source=readFileSync('car-performance.js','utf8');
  const body=source.slice(source.indexOf('function pitSummary'),source.indexOf('function huberRegression'));
  const sandbox={avg:a=>{const found=a.filter(Number.isFinite);return found.length?found.reduce((x,y)=>x+y,0)/found.length:null;},
    median:a=>{const x=a.filter(Number.isFinite).sort((v,w)=>v-w);return x.length?(x.length%2?x[(x.length-1)/2]:(x[x.length/2-1]+x[x.length/2])/2):null;},
    percentile:(a,p)=>{const x=a.filter(Number.isFinite).sort((v,w)=>v-w);if(!x.length)return null;const i=(x.length-1)*p,l=Math.floor(i),h=Math.ceil(i);return x[l]+(x[h]-x[l])*(i-l);},
    pitVisitMode:'all',finite:Number.isFinite,completed:()=>true};
  vm.createContext(sandbox);
  vm.runInContext(body,sandbox);
  const events=[{name:'Example GP',R:{teams:[{team:'McLaren',drivers:['NOR','PIA']}]},
    pits:{source:'OpenF1',visits:[
      {driver:'NOR',lap:20,lane_duration:22,stop_duration:2},
      {driver:'NOR',lap:40,lane_duration:28,stop_duration:null},
      {driver:'PIA',lap:21,lane_duration:25,stop_duration:3}
    ]}}];
  const result=sandbox.pitSummary(events,[{team:'McLaren',color:'#ff8000'}]);
  assert.equal(result.teams[0].avgStop,2.5);
  assert.equal(result.teams[0].avgLane,25);
  assert.equal(result.teams[0].stopCount,2);
  assert.equal(result.teams[0].laneCount,3);
  assert.equal(result.teams[0].stop.median,2.5);
  assert.equal(result.teams[0].stop.fastest,2);
  assert.equal(result.teams[0].stop.p25,2.25);
  assert.equal(result.teams[0].stop.p75,2.75);
  assert.equal(result.teams[0].lane.median,25);
  assert.equal(result.teams[0].lane.fastest,22);
  assert.equal(result.teams[0].lane.p90,null);
  assert.equal(result.teams[0].lane.p10,null);
  assert.equal(result.teams[0].laneRelative.mean,0);
  sandbox.pitVisitMode='service';
  const serviceOnly=sandbox.pitSummary(events,[{team:'McLaren'}]);
  assert.equal(serviceOnly.teams[0].laneCount,2);
  assert.equal(serviceOnly.teams[0].avgLane,23.5);
  assert.equal(serviceOnly.visits.length,3,'unknown visits remain in evidence');
  sandbox.pitVisitMode='all';
  assert.equal(sandbox.pitMiddleSpread(result.teams[0].stop),null); // two stops cannot establish consistency
  assert.ok(Math.abs(sandbox.pitMiddleSpread({count:4,p25:2.1,p75:2.7})-.6)<1e-9);
  assert.match(source,/sortHeader\('pitSpread','Middle 50% spread'\)/);
  assert.match(source,/pitSpread:r=>pitMiddleSpread\(r\[measure\]\)/);
  assert.equal(result.drivers.find(d=>d.driver==='NOR').avgStop,2);
  assert.equal(result.drivers.find(d=>d.driver==='NOR').avgLane,25);
  const withoutRaceLaps=sandbox.pitSummary([{name:'2026 GP',pits:{source:'OpenF1',visits:[
    {driver:'NOR',team:'McLaren',lap:20,lane_duration:21.3,stop_duration:null}
  ]}}],[]);
  assert.equal(withoutRaceLaps.teams[0].avgLane,21.3);
  assert.equal(withoutRaceLaps.teams[0].avgStop,null);
  assert.equal(withoutRaceLaps.loaded,1);
  const differentLanes=sandbox.pitSummary([
    {name:'Short GP',pits:{source:'OpenF1',visits:[{driver:'AAA',team:'A',lap:10,lane_duration:20,stop_duration:2},{driver:'BBB',team:'B',lap:10,lane_duration:24,stop_duration:2.4}]}},
    {name:'Long GP',pits:{source:'OpenF1',visits:[{driver:'AAA',team:'A',lap:10,lane_duration:40,stop_duration:2},{driver:'BBB',team:'B',lap:10,lane_duration:44,stop_duration:2.4}]}}
  ],[]);
  assert.equal(differentLanes.teams.find(t=>t.team==='A').lane.mean,30);
  assert.equal(differentLanes.teams.find(t=>t.team==='A').laneRelative.mean,-2);
  assert.equal(differentLanes.teams.find(t=>t.team==='B').laneRelative.mean,2);
  assert.match(source,/data-pit-measure="stop"/);
  assert.match(source,/data-pit-measure="lane"/);
  assert.match(source,/data-pit-subject="team"/);
  assert.match(source,/data-pit-subject="driver"/);
  assert.match(source,/data-pit-chart="mean"/);
  assert.match(source,/data-pit-chart="median"/);
  assert.match(source,/data-pit-chart="spread"/);
  assert.match(source,/data-pit-chart="p90"/);
  assert.match(source,/data-pit-chart="p10"/);
  assert.match(source,/data-pit-lane-basis="event"/);
  assert.match(source,/chartValue:pitChartMetric==='spread'\?pitMiddleSpread/);
  assert.match(source,/Exact times for individual pit visits/);
  assert.match(source,/if\(activeMetric==='pits'\) loadPitData\(\);/);
  assert.doesNotMatch(source,/pitRunning \|\| !context \|\| running/);
  assert.match(source,/activeMetric==='pits'\?renderPits\(teams\)/);
  assert.match(source,/api\/performance\/pits/);
});

test('pit summaries keep raw visits weighted, relative GPs equal, and percentile boundaries exact', () => {
  const source=readFileSync('car-performance.js','utf8');
  const body=source.slice(source.indexOf('function pitSummary'),source.indexOf('function huberRegression'));
  const sandbox={pitVisitMode:'all',finite:Number.isFinite,completed:()=>true,
    avg:a=>{const x=a.filter(Number.isFinite);return x.length?x.reduce((s,v)=>s+v,0)/x.length:null;},
    median:a=>{const x=a.filter(Number.isFinite).sort((a,b)=>a-b);return x.length?x.length%2?x[(x.length-1)/2]:(x[x.length/2-1]+x[x.length/2])/2:null;},
    percentile:(a,p)=>{const x=a.filter(Number.isFinite).sort((a,b)=>a-b);if(!x.length)return null;const i=(x.length-1)*p,l=Math.floor(i),h=Math.ceil(i);return x[l]+(x[h]-x[l])*(i-l);}};
  vm.createContext(sandbox);vm.runInContext(body,sandbox);
  const visit=(driver,team,lap,lane,stop)=>({driver,team,lap,lane_duration:lane,stop_duration:stop});
  const events=[
    {name:'GP 1',pits:{source:'OpenF1',visits:[...Array.from({length:10},(_,i)=>visit('AAA','A',i+1,22,2)),visit('BBB','B',1,20,2.4)]}},
    {name:'GP 2',pits:{source:'OpenF1',visits:[visit('AAA','A',1,40,3),visit('BBB','B',1,28,2.6)]}}
  ];
  const data=sandbox.pitSummary(events,[]), a=data.teams.find(r=>r.team==='A'), b=data.teams.find(r=>r.team==='B');
  assert.equal(a.lane.count,11);assert.equal(a.laneRelative.count,2);
  assert.ok(a.lane.mean<b.lane.mean); // 11 visits versus B's two
  assert.ok(a.laneRelative.mean>b.laneRelative.mean); // GP medians, each GP once
  assert.equal(a.laneRelative.mean,3.5);assert.equal(b.laneRelative.mean,-3.5);
  assert.equal(data.drivers.find(r=>r.driver==='AAA').laneRelative.mean,3.5);
  assert.equal(a.stop.mean,23/11);assert.equal(a.stop.fastest,2);
  assert.equal(a.stop.p10,2);assert.equal(a.stop.p90,2);
  const nine=sandbox.pitSummary([{name:'GP',pits:{visits:Array.from({length:9},(_,i)=>visit('AAA','A',i+1,i+1,i+1))}}],[]).teams[0];
  const ten=sandbox.pitSummary([{name:'GP',pits:{visits:Array.from({length:10},(_,i)=>visit('AAA','A',i+1,i+1,i+1))}}],[]).teams[0];
  assert.equal(nine.stop.p10,null);assert.equal(nine.stop.p90,null);
  assert.equal(ten.stop.p10,1.9);assert.equal(ten.stop.p90,9.1);
  assert.equal(ten.stop.p25,3.25);assert.equal(ten.stop.p75,7.75);
  assert.equal(sandbox.pitMiddleSpread(ten.stop),4.5);
  assert.equal(data.visits.length,13); // exact visit rows retain all source visits
  assert.match(source,/data-pit-chart="fastest"/);
  assert.match(source,/preserveSignedValues:relativeLane/);
});

test('pit chart, sortable table and exact rows show the same selected measurement', () => {
  const source=readFileSync('car-performance.js','utf8');
  const chart=source.slice(source.indexOf('function renderHorizontalBarChart'),source.indexOf('function lapShareChart'));
  const body=source.slice(source.indexOf('function pitSummary'),source.indexOf('function huberRegression'));
  const captured=[];
  const sandbox={finite:Number.isFinite,completed:()=>true,events:[],context:{scope:'tracks',selectedTracks:[1]},
    pitVisitMode:'all',pitMeasure:'lane',pitLaneBasis:'event',pitSubject:'team',pitChartMetric:'mean',sortKey:'pitMean',sortDirection:1,
    avg:a=>{const x=a.filter(Number.isFinite);return x.length?x.reduce((s,v)=>s+v,0)/x.length:null;},
    median:a=>{const x=a.filter(Number.isFinite).sort((v,w)=>v-w);return x.length?x.length%2?x[(x.length-1)/2]:(x[x.length/2-1]+x[x.length/2])/2:null;},
    percentile:(a,p)=>{const x=a.filter(Number.isFinite).sort((v,w)=>v-w);if(!x.length)return null;const i=(x.length-1)*p,l=Math.floor(i),h=Math.ceil(i);return x[l]+(x[h]-x[l])*(i-l);},
    fmt:(n,d=3,u='')=>Number.isFinite(n)?n.toFixed(d)+u:'—',signed:(n,d=3,u='')=>Number.isFinite(n)?`${n>0?'+':''}${n.toFixed(d)}${u}`:'—',
    color:v=>v||'#888888',escape:v=>String(v),teamLabel:r=>r.team||r.driver,eventLabel:v=>v,
    exactSeconds:n=>Number.isFinite(n)?`${n} s`:'—',card:(_title,_note,content)=>content,
    sortHeader:(_key,label)=>label,table:(headers,rows)=>{captured.push({headers,rows});return '';},
    sorted:(rows,getters,key)=>[...rows].sort((a,b)=>{const av=getters[sandbox.sortKey in getters?sandbox.sortKey:key](a),bv=getters[sandbox.sortKey in getters?sandbox.sortKey:key](b);return av==null?1:bv==null?-1:(av-bv)*sandbox.sortDirection;})};
  sandbox.events=[
    {name:'GP 1',pits:{source:'OpenF1',visits:[{driver:'AAA',team:'A',lap:1,lane_duration:22,stop_duration:2},{driver:'BBB',team:'B',lap:1,lane_duration:20,stop_duration:2.5}]}},
    {name:'GP 2',pits:{source:'OpenF1',visits:[{driver:'AAA',team:'A',lap:2,lane_duration:40,stop_duration:3},{driver:'BBB',team:'B',lap:2,lane_duration:28,stop_duration:2.4}]}}
  ];
  vm.createContext(sandbox);vm.runInContext(chart+body,sandbox);
  let html=sandbox.renderPits([]);
  assert.match(html,/\+3\.500 s/);assert.match(html,/-3\.500 s/);
  assert.equal(captured[0].rows[0][0],'B');assert.equal(captured[0].rows[0][2],'-3.500 s');
  assert.equal(captured[1].rows.length,4);
  assert.equal(captured[1].rows[0][5],'22 s');
  captured.length=0;sandbox.pitChartMetric='fastest';html=sandbox.renderPits([]);
  assert.match(html,/Best GP gap/);assert.equal(captured[0].rows[0][3],'-6.000 s');
  captured.length=0;sandbox.pitSubject='driver';sandbox.pitMeasure='stop';sandbox.pitLaneBasis='raw';sandbox.pitChartMetric='median';
  html=sandbox.renderPits([]);
  assert.match(html,/stationary stop/);assert.equal(captured[0].rows[0][0],'BBB');
  assert.equal(captured[1].rows[0][4],'2 s');
  sandbox.pitSubject='team';sandbox.events=[{name:'Ten-stop GP',pits:{source:'OpenF1',visits:[
    ...Array.from({length:10},(_,i)=>({driver:'AAA',team:'A',lap:i+1,lane_duration:20+i,stop_duration:i+1})),
    ...Array.from({length:10},(_,i)=>({driver:'BBB',team:'B',lap:i+1,lane_duration:21+i,stop_duration:i+2}))
  ]}}];
  for(const [metric,expected,column] of [['p10','1.900 s',5],['p90','9.100 s',6],['spread','4.500 s',4]]){
    captured.length=0;sandbox.pitChartMetric=metric;html=sandbox.renderPits([]);
    assert.match(html,new RegExp(expected.replace('.','\\.')));
    assert.match(captured[0].rows.find(row=>row[0]==='A')[column],new RegExp(expected.replace('.','\\.')));
    assert.equal(captured[1].rows.length,20);
  }
});

test('Sepang corners use GPS geometry and aligned fractions, not outline chainage', () => {
  const h=context();
  const coords=JSON.parse(readFileSync('assets/circuits/f1-circuits.geojson','utf8')).features.find(f=>f.properties.id==='my-1999').geometry.coordinates;
  h.sandbox.samples=coords.slice(0,-1).flatMap((a,i)=>Array.from({length:10},(_,j)=>{
    const t=j/10,b=coords[i+1],f=(i+t)/(coords.length-1);
    return {X:(a[0]+(b[0]-a[0])*t)*1e6-1e8,Y:(a[1]+(b[1]-a[1])*t)*1e6,
      Distance:5543*f*f,AlignedFraction:f};
  }));
  const markers=h.run('projectSepangCorners(samples)');
  assert.equal(markers.length,15);
  const indices=[6,14,24,35,44,52,57,60,66,71,78,83,89,94,100];
  markers.forEach((m,i)=>assert.ok(Math.abs(m.fraction-indices[i]/(coords.length-1))<.003,`Turn ${i+1} must sit on its spatial anchor`));
  assert.equal(h.run('projectSepangCorners(samples.slice(0,20)).length'),0);
  assert.match(app,/resolveCornerMarkers\(reference, totalDistance, spatial\?\.lap\?\.cornerMarkers\)/);
});

test('focused speed chart reserves an independent control row with sufficient specificity', () => {
  const css=readFileSync('trace-focus.css','utf8');
  const root=postcss.parse(css);
  const rule=root.nodes.find(n=>n.selector==='body.trace-focus #charts > .chart.speed-chart:nth-child(1)');
  assert.ok(rule);
  assert.ok(rule.nodes.some(n=>n.prop==='grid-template-rows'&&n.value==='auto auto minmax(0, 1fr)'));
  assert.match(css,/\.speed-chart-controls \{ min-height: min-content; \}/);
  assert.match(css,/@layer focus/);
  assert.match(readFileSync('scripts/sync-static.mjs','utf8'),/@layer focus, legacy, interface/);
});

test('native corner projection follows the aligned comparison grid', () => {
  const h=context();
  h.sandbox.document.querySelector=()=>({value:'1'});
  h.run("calendar=[];sessionCircuitKey=63;samples=[{Distance:0,AlignedFraction:0},{Distance:500,AlignedFraction:.6},{Distance:1000,AlignedFraction:1}]");
  assert.equal(h.run("resolveCornerMarkers(samples,1000,[{number:'1',fraction:.5,source:'lap_projection'}])[0].fraction"),.6);
});

test('one optional speed-annotation control combines native minima, corner carry and straight peaks', () => {
  const h=context();
  assert.equal(h.run('showSpeedAnnotations'),false);
  assert.equal((app.match(/id="speedAnnotationToggle"/g)||[]).length,1);
  assert.match(app,/Corner numbers<\/span><\/label>\s*<label[^\n]+id="speedAnnotationToggle"/);
  h.sandbox.entries=['A','B'].map((code,index)=>({lap:{code,lap:1},samples:Array.from({length:1001},(_,i)=>({Distance:i*5,AlignedFraction:i/1000,
    Speed:(i>=190&&i<=210?80+Math.abs(i-200):i>=590&&i<=610?240+(i-590)/2:300)-index*5,
    Throttle:100,Brake:0}))}));
  h.sandbox.zones=[{number:'1',apex:.2,minimumSpeed:80,apexStart:.19,apexEnd:.21,start:.15,end:.25},
    {number:'2',apex:.6,minimumSpeed:240,apexStart:.59,apexEnd:.61,start:.55,end:.65}];
  const results=h.run('buildSpeedAnnotations(entries,zones,5000)');
  assert.ok(results.some(r=>r.kind==='peak'));
  assert.equal(results.find(r=>r.title==='T1 min').values[0].speed,80);
  assert.equal(results.find(r=>r.title==='T2 carry').values[0].speed,250);
  assert.equal(results.find(r=>r.title==='T2 carry').fraction,.61);
  assert.equal(results.find(r=>r.title==='T1 min').values[1].speed,75);
  h.run('entries[0].samples=entries[0].samples.filter(p=>p.AlignedFraction<.194||p.AlignedFraction>.206)');
  assert.equal(h.run("buildSpeedAnnotations(entries,zones,5000).find(r=>r.title==='T1 min').values.length"),1);
  assert.equal(h.run("buildSpeedAnnotations(entries,zones,5000).find(r=>r.title==='T1 min').missing[0].code"),'A');
  // A gap in the middle of a straight must not discard a measured peak elsewhere.
  assert.equal(h.run("buildSpeedAnnotations(entries,zones,5000).filter(r=>r.kind==='peak').every(r=>r.values.length===2)"),true);
});

test('speed annotation labels avoid open trace segments without closing the lap', () => {
  const h=context();
  h.sandbox.box={x:45,y:45,width:10,height:10};
  h.sandbox.points=[{x:0,y:0},{x:0,y:100},{x:100,y:100}];
  assert.equal(h.run('trackIntersectsLabel(box,points,0,false)'),false);
  assert.equal(h.run('trackIntersectsLabel(box,points,0,true)'),true);
  assert.match(app,/trackIntersectsLabel\(box,trace\.points,4,false\)/);
  assert.match(app,/const identity=lap=>lap\.code/);
});

test('performance categories expose only defensible alternative summaries', () => {
  const source=readFileSync('car-performance.js','utf8');
  for(const key of ['pace-stat','telemetry-stat','tyre-stat','results-chart','trend-view'])
    assert.match(source,new RegExp(`data-${key}=`));
  assert.match(source,/data-results-chart="mechanicalRate"/);
  assert.match(source,/pitChartMetric==='p90'/);
  assert.match(source,/timed\.length>=10\?percentile\(timed,\.9\):null/);
  assert.match(source,/gpSlopes\.length<4\|\|p75Shortfall\.length/);
  assert.match(source,/seasonTelemetry\(telemetrySeasonStat\)/);
});
