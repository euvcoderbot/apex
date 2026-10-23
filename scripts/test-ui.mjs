import {performanceSource,offersControl} from './view-source.mjs';
import {appSource} from './app-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import postcss from 'postcss';
import {gzipSync,gunzipSync} from 'node:zlib';

const app = appSource();
test('pit entrants stay visible without loading race pace or inventing a missing stop',()=>{
  const source=readFileSync('car-performance.js','utf8');
  const box={pitVisitMode:'service',finite:Number.isFinite,completed:()=>true,
    avg:a=>a.length?a.reduce((s,n)=>s+n,0)/a.length:null,
    median:a=>a.length?[...a].sort((x,y)=>x-y)[Math.floor(a.length/2)]:null,
    percentile:(a,p)=>a.length?[...a].sort((x,y)=>x-y)[Math.floor((a.length-1)*p)]:null};
  vm.createContext(box);vm.runInContext(source.slice(source.indexOf('function pitSummary('),source.indexOf('function pitMiddleSpread(')),box);
  const data=box.pitSummary([{name:'Singapore',pits:{entrants:[{driver:'VER',team:'Red Bull Racing'},
    {driver:'COL',team:'Alpine'}],visits:[{driver:'VER',team:'Red Bull Racing',lap:32,
      lane_duration:23.727,stop_duration:2.2,visit_type:'service'}]}}],[]);
  assert.equal(data.drivers.length,2);assert.equal(data.teams.length,2);
  assert.equal(data.drivers.find(r=>r.driver==='COL').stop.count,0);
  assert.equal(data.drivers.find(r=>r.driver==='COL').stop.mean,null);
  assert.equal(data.drivers.find(r=>r.driver==='VER').stop.mean,2.2);
  assert.match(source,/if\(retry\)params.set\('fresh','true'\)/);
  assert.match(readFileSync('src/views/PitsView.tsx','utf8'),/Refresh missing timing/);
  assert.match(readFileSync('src/views/PitsView.tsx','utf8'),/Needs 4 \$\{unit\}/);
});

test('only the aligned telemetry implementation is shipped as the active classic-script dependency',()=>{
  const html=readFileSync('index.html','utf8'),alignment=readFileSync('alignment.js','utf8');
  assert.ok(html.indexOf('src="alignment.js')>html.indexOf('src="session-state.js'));
  for(const name of ['fetchTelemetry','interpolate']){
    assert.doesNotMatch(app,new RegExp('(?:async )?function '+name+'\\('));
    assert.match(alignment,new RegExp('(?:async )?function '+name+'\\('));
  }
  assert.doesNotMatch(html,/src="(?:real-data|enhancements)\.js/);
});
test('performance redraw retains scroll, evidence disclosure and keyboard focus',()=>{
  const source=readFileSync('car-performance.js','utf8');
  const focused={attributes:[{name:'data-pace-stat',value:'median'}]};
  const makeTable=heading=>({matches:()=>true,querySelector:()=>({textContent:heading}),scrollLeft:184,scrollTop:62,focus(options){this.focused=options;}});
  const before=makeTable('Team Qualifying ▲');
  const open={querySelector:()=>({textContent:'Show lap evidence'})};
  const root={contains:()=>true,querySelectorAll:s=>s==='details[open]'?[open]:[before]};
  const box={document:{activeElement:focused},CSS:{escape:s=>s}};
  vm.createContext(box);
  vm.runInContext(source.slice(source.indexOf('function performanceUIKey('),source.indexOf('function render() {')),box);
  const saved=box.capturePerformanceUI(root);
  const after=makeTable('Team Qualifying ▼');after.scrollLeft=0;after.scrollTop=0;
  const detail={open:false,querySelector:()=>({textContent:'Show lap evidence'})};
  const replacement={disabled:false,focus(options){this.focused=options;}};
  box.restorePerformanceUI({querySelectorAll:s=>s==='details'?[detail]:[after],querySelector:()=>replacement},saved);
  assert.equal(after.scrollLeft,184);assert.equal(after.scrollTop,62);
  assert.equal(detail.open,true);assert.equal(replacement.focused.preventScroll,true);
});
test('UI density uses component sizing and responsive chart rows rather than page scaling',()=>{
  const shared=readFileSync('apple-ui.css','utf8'),performance=readFileSync('car-performance.css','utf8');
  postcss.parse(shared);postcss.parse(performance);
  assert.match(shared,/body \{ zoom: 1; \}/);
  assert.match(shared,/--ui-control-height: 44px/);
  assert.match(performance,/\.performance-bar-track, \.performance-tyre-age-track \{ grid-column: 1 \/ -1; grid-row: 2;/);
  assert.match(performance,/focus-visible \{ outline: 3px solid var\(--accent\)/);
  const source=readFileSync('car-performance.js','utf8');
  assert.match(source,/role="region" aria-label="Measurement table/);
  assert.match(source,/aria-controls="performanceMetricPanel" tabindex=/);
  assert.match(source,/\['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'\]/);
  assert.match(source,/event.ctrlKey\|\|event.metaKey\|\|event.altKey/);
});

test('corner client consumes cached measurements and explicit retry retains fastest lap identity',async()=>{
  const source=readFileSync('car-performance.js','utf8'),calls=[],event={name:'Test GP',round:1,Q:{teams:[]}};
  const box={URLSearchParams,AbortController,Map,Number,finite:Number.isFinite,context:{year:2026},events:[event],generation:1,
    activeMetric:'corners',cornerSession:'qualy',telemetrySubject:'team',qualifyingMetricsRunning:false,
    render(){},scheduleRender(){},updateStatus(){},loadActiveTelemetry(){},firstTelemetryAttempt:()=>true,
    get:async path=>{calls.push(path);const retry=path.includes('refresh=1');return {
      entrants:[{team:'A',driver:'AAA',lap:{lap:5}},{team:'B',driver:'BBB',lap:{lap:5}}],markers:[{corner:'1',band:'low',speed:80}],
      requested:2,received:2,complete:retry,requestErrors:[],
      traces:{AAA:{selection:{driver:'AAA',lap:5},corners:[{corner:'1'}],corner_missing:[]},
        BBB:{selection:{driver:'BBB',lap:5},corners:retry?[{corner:'1'}]:[],corner_missing:retry?[]:['1']}}};}};
  vm.createContext(box);vm.runInContext(source.slice(source.indexOf('async function loadQualifyingMetrics('),source.indexOf('let raceCornerRunning=')),box);
  await box.loadQualifyingMetrics();assert.equal(calls.length,1);assert.match(calls[0],/qualifying-corners/);
  assert.equal(event.cornerAudit.team.incomplete.join(','),'B');
  await box.loadQualifyingMetrics(true);assert.equal(calls.length,2);assert.match(calls[1],/refresh=1/);
  assert.equal(event.cornerAudit.team.incomplete.length,0);assert.equal(event.cornerMeasurements.team.B.selection.lap,5);
});

test('development table allocates all six columns without inflating rows',()=>{
  const css=readFileSync('car-performance.css','utf8');
  const widths=[...css.matchAll(/\.performance-trend-table \.performance-table th:nth-child\((\d)\) \{ width: (\d+)%; \}/g)];
  assert.deepEqual(widths.map(m=>Number(m[1])),[1,2,3,4,5,6]);
  assert.equal(widths.reduce((sum,m)=>sum+Number(m[2]),0),100);
  assert.match(css,/\.performance-trend-table \.performance-table tbody td \{ padding: 8px 12px; height: auto; \}/);
});
function context(reduced = false) {
  const sandbox = { console, URL, URLSearchParams,
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
  // A single 1.25 s packet gap (typical ~4 Hz feed) still yields a sector map.
  h.run('testDense=Array.from({length:241},(_,i)=>({X:Math.cos(i/240*2*Math.PI)*1000,Y:Math.sin(i/240*2*Math.PI)*1000,Distance:i*20,ElapsedSeconds:i/8}))');
  assert.ok(h.run('makeSectorGuide(testLap,testDense.filter((_,i)=>i<100||i>109),[])'));
  assert.equal(h.run('makeSectorGuide(testLap,testSamples.map(p=>({...p,Y:null})),[])'),null);
  assert.equal(h.run('makeSectorGuide(testLap,testSamples.slice(8),[])'),null);
});

test('circuit annotations recover named corners without a timing archive or provider chainage', async () => {
  const h=context(); let calls=0;
  Object.assign(h.sandbox,{AbortSignal});
  h.sandbox.fetch=async()=>{calls++;return {ok:true,json:async()=>({corners:[
    {number:1,length:7000,trackPosition:{x:100,y:0}},
    {number:2,length:8000,trackPosition:{x:200,y:0}},
    {number:3,trackPosition:{x:null,y:0}}
  ]})};};
  const [a,b]=await Promise.all([h.run('loadCircuitAnnotations(39,2026)'),h.run('loadCircuitAnnotations(39,2026)')]);
  assert.equal(calls,1);assert.equal(a,b);
  h.sandbox.guide=a;
  const rows=h.run('circuitAnnotationRows(guide)');
  assert.equal(rows.length,2);assert.equal(rows[0].distance,undefined);
  h.sandbox.rows=rows;
  h.run("document.querySelector=()=>({value:'13'});calendar=[];sessionCircuitKey=39;corners=rows");
  const markers=h.run('resolveCornerMarkers([{Distance:0,X:0,Y:0},{Distance:100,X:100,Y:0},{Distance:200,X:200,Y:0},{Distance:300,X:300,Y:0}],300)');
  assert.equal(markers.length,2);assert.equal(markers[0].fraction,1/3);assert.equal(markers[1].fraction,2/3);
  await h.run('loadCircuitAnnotations(39,2026)');assert.equal(calls,1);
});

test('sector guide decodes raw DRS codes, keeps unknown states closed and hides 2026 aero mode',()=>{
  const h=context();vm.runInContext(readFileSync('analysis-core.js','utf8'),h.sandbox);
  h.run(`resolveCornerMarkers=()=>[];sessionYear=2025;
    testLap={time:30,s1:8.15,s2:10.2,s3:11.65};
    testSamples=Array.from({length:121},(_,i)=>({X:Math.cos(i/120*2*Math.PI)*1000,Y:Math.sin(i/120*2*Math.PI)*1000,Distance:i*40,ElapsedSeconds:i/4,DRS:i<40?8:i<80?12:null}));`);
  assert.equal(h.run('makeSectorGuide(testLap,testSamples,[]).drs[0]'),false);
  assert.equal(h.run('makeSectorGuide(testLap,testSamples,[]).drs.at(-1)'),false);
  assert.ok(h.run('makeSectorGuide(testLap,testSamples,[]).drs.some(Boolean)'));
  assert.equal(h.run('makeSectorGuide(testLap,testSamples.map(p=>({...p,DRS:8})),[]).drs'),null);
  assert.ok(h.run('makeSectorGuide(testLap,testSamples.map(p=>({...p,DRS:1})),[],true).drs.every(Boolean)'));
  h.run('sessionYear=2026');assert.equal(h.run('makeSectorGuide(testLap,testSamples,[]).drs'),null);
});

test('weekend session order respects dated schedules and historical sprint formats',()=>{
  const h=context();
  h.sandbox.event={sessions:['Race','Qualifying','Sprint','Practice 1','Sprint Qualifying']};
  assert.equal(h.run('orderedWeekendSessions(event,2026).join()'),'Practice 1,Sprint Qualifying,Sprint,Qualifying,Race');
  h.sandbox.event={sessions:['Race','Sprint','Qualifying','Practice 1','Sprint Shootout']};
  assert.equal(h.run('orderedWeekendSessions(event,2023).join()'),'Practice 1,Qualifying,Sprint Shootout,Sprint,Race');
  h.sandbox.event={sessions:['Race','Sprint','Qualifying','Practice 2','Practice 1']};
  assert.equal(h.run('orderedWeekendSessions(event,2021).join()'),'Practice 1,Qualifying,Practice 2,Sprint,Race');
  h.sandbox.event={sessions:['Qualifying','Practice 3'],session_dates:{Qualifying:'2026-07-01T10:00:00Z','Practice 3':'2026-07-01T14:00:00Z'}};
  assert.equal(h.run('orderedWeekendSessions(event,2026).join()'),'Qualifying,Practice 3');
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

test('disabled upstream calendar falls back to a saved schedule without caching it as live status',async()=>{
  const h=context();let calls=0;
  Object.assign(h.sandbox,{URL,AbortController,DOMException,structuredClone,setTimeout,clearTimeout});
  h.sandbox.fetch=async url=>{
    calls++;
    return String(url).includes('assets/data/events/')
      ? {ok:true,json:async()=>[{round:17,name:'Singapore Grand Prix'}]}
      : {status:402,ok:false,headers:{get:()=> 'application/json'},text:async()=>JSON.stringify({detail:'Backend disabled'})};
  };
  const url=`https://example.test/api/events?year=${new Date().getFullYear()}`;
  const first=await h.run(`requestApiData(${JSON.stringify(url)})`);
  assert.equal(first[0].calendar_status_source,'saved-schedule');
  await h.run(`requestApiData(${JSON.stringify(url)})`);assert.equal(calls,4);
});

test('saved native driver packs keep exact identity, duration and immutable per-lap reads',async()=>{
  const h=context();let calls=0;const cacheModes=[];
  const payload={sessionKey:11384,laps:{7:{driver:'COL',lap:7,samples:[{ElapsedSeconds:0,Speed:200},{ElapsedSeconds:93.261,Speed:250}]}}};
  Object.assign(h.sandbox,{URL,Response,DecompressionStream,structuredClone});
  h.sandbox.window.APEX_SOURCE_VERSION='source-test';
  h.sandbox.fetch=async (url,options)=>{
    calls++;
    cacheModes.push(options?.cache);
    return String(url).endsWith('index.json')
      ? {ok:true,json:async()=>({sourceRevision:'source-test',entries:{'2026:Singapore Grand Prix:Qualifying:COL':'col.json.gz'}})}
      : new Response(gzipSync(JSON.stringify(payload)));
  };
  const path='https://example.test/api/telemetry?year=2026&gp=Singapore+Grand+Prix&session=Q&driver=COL&lap=7&lap_time=93.261&session_key=11384';
  const first=await h.run(`preparedTelemetryData(new URL(${JSON.stringify(path)}))`);first.samples[0].Speed=999;
  const second=await h.run(`preparedTelemetryData(new URL(${JSON.stringify(path)}))`);
  assert.equal(second.samples[0].Speed,200);assert.equal(calls,2);
  assert.deepEqual(cacheModes,['no-cache','no-cache'],'newly published snapshots revalidate their index and pack');
  assert.equal(await h.run(`preparedTelemetryData(new URL(${JSON.stringify(path.replace('11384','11388'))}))`),null);
  assert.equal(await h.run(`preparedTelemetryData(new URL(${JSON.stringify(path.replace('93.261','94'))}))`),null);
});

test('COTA practice loads a captured local summary and every drivers fastest native lap',()=>{
  const index=JSON.parse(readFileSync('assets/data/prerendered/index.json'));
  const query='/api/session?gp=United+States+Grand+Prix&round=18&session=Practice+1&year=2026';
  const summary=JSON.parse(gunzipSync(readFileSync('assets/data/prerendered/'+index.entries[query])));
  assert.equal(summary.session,'Practice 1');assert.equal(summary.openf1_session_key,11389);
  assert.equal(summary.drivers.length,22);
  assert.ok(Date.parse(summary.local_export.captured_at)>Date.parse(summary.local_export.session_ended_at));
  const telemetry=JSON.parse(readFileSync('assets/data/telemetry/index.json'));
  assert.equal(telemetry.sourceRevision,index.sourceRevision);
  for(const driver of summary.drivers){
    const fastest=driver.laps.filter(lap=>!lap.out_lap&&lap.time>20&&lap.time<300).sort((a,b)=>a.time-b.time)[0];
    const file=telemetry.entries[`2026:United States Grand Prix:Practice 1:${driver.code}`];
    assert.ok(file,driver.code);
    const pack=JSON.parse(gunzipSync(readFileSync('assets/data/telemetry/'+file)));
    const lap=pack.laps[fastest.lap];assert.ok(lap,`${driver.code} L${fastest.lap}`);
    assert.equal(pack.sessionKey,11389);assert.equal(lap.driver,driver.code);
    assert.ok(lap.samples.length>250);assert.equal(lap.samples[0].ElapsedSeconds,0);
    assert.ok(Math.abs(lap.samples.at(-1).ElapsedSeconds-fastest.time)<.005);
  }
});

test('the five reported Singapore laps are retained native traces, not estimated replacements',()=>{
  const index=JSON.parse(readFileSync('assets/data/telemetry/index.json'));
  for(const [driver,lap] of [['COL',7],['SAI',12],['RUS',19],['BOR',15],['PIA',21]]){
    const file=index.entries[`2026:Singapore Grand Prix:Qualifying:${driver}`];assert.ok(file,driver);
    const data=JSON.parse(gunzipSync(readFileSync('assets/data/telemetry/'+file))).laps[lap];
    assert.equal(data.driver,driver);assert.equal(data.lap,lap);assert.ok(data.samples.length>250);
    assert.equal(data.position_complete,true);assert.equal(data.samples[0].ElapsedSeconds,0);
  }
});

test('session selection reuses versioned source cache with no speculative load', () => {
  assert.match(app, /for \(let y = currentYear; y >= 2018; y--\)/);
  assert.doesNotMatch(app, /prepareSelectedSession|prefetchSessionTimer/);
  assert.match(app, /loadApiData\(apiUrl\(`\/api\/session\?\$\{requestedQuery\}`\), \{signal:request.signal\}\)/);
  assert.match(app, /window.APEX_DATA_VERSION/);
  const telemetry=readFileSync('alignment.js','utf8');
  assert.match(telemetry, /query\.set\('driver_number', driverNumber\)/);
  assert.match(telemetry, /query\.set\('lap_start_seconds',meta\.lap_start_seconds\)/);
  assert.match(telemetry, /query\.set\('lap_end_seconds',meta\.lap_end_seconds\)/);
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
  // Canvas labels share the interface stack and use a compact readable size.
  assert.match(context().run('canvasFont(12)'), /13px -apple-system/);
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
  assert.match(html,/aria-label="Selected lap sector times"/);
  assert.match(html,/corner-collapse-region/);
  assert.ok(html.indexOf('class="dashboard-card session-controls"') < html.indexOf('<aside class="sidebar"'));
  assert.ok(html.indexOf('<aside class="app-sidebar" id="sessionSidebar"') < html.indexOf('class="dashboard-card session-controls"'));
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
  assert.match(app, /updateCornerPicker\(pickerRoot,/);
  assert.doesNotMatch(app,/positionCornerIndicator|corner-pick\.selected'\)\?\.focus/);
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
  assert.match(app, /highlightedCornerWindows.flatMap\(window => \[window.start, window.end\]\)/);
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
  assert.doesNotMatch(app,/lap-selection-mark/);
  assert.match(app, /class="lap-clock">\$\{duration\}<\/span>/);
  const html = readFileSync('index.html', 'utf8');
  // Split session scripts; sync-static stamps ?v=<revision> on every script it publishes.
  assert.match(html, /src="session-state\.js"[\s\S]*src="session-tyres\.js"/);
  assert.match(html, /alignment\.js\?v=euv2-release-[\w-]+/);
});

test('pit laps can be selected and a later corner cannot snap to an earlier pass', () => {
  const h = context();
  assert.match(app, /lap.in_lap && lap.out_lap/);
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
  const driverSection = app.slice(app.indexOf('function renderDrivers()'), app.indexOf('function fastestTimedLap('));
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

test('cold data and calendar bootstrap outlive the hosted Worker budget', () => {
  const h = context();
  Object.assign(h.sandbox, {URL});
  for (const path of ['/api/events', '/api/session', '/api/telemetry', '/api/performance', '/api/performance/trace-batch', '/api/performance/sprint', '/api/race-corners', '/api/qualifying-corners'])
    assert.equal(h.run(`dataRequestTimeout(${JSON.stringify('https://example.test' + path + '?year=2026')})`), 310000, path);
  assert.equal(h.run("dataRequestTimeout('/unrelated-resource')"), 30000);
  h.sandbox.window.APEX_LOCAL_MODE = true;
  assert.equal(h.run("dataRequestTimeout('/api/session?year=2026')"), 180000);
});

test('a calendar taking longer than 30 seconds is not aborted before it responds', async () => {
  const h=context(),timers=[];
  let finish,requestSignal;
  Object.assign(h.sandbox,{URL,AbortController,DOMException,
    setTimeout:(fn,ms)=>{const timer={fn,ms,active:true};timers.push(timer);return timer;},
    clearTimeout:timer=>{timer.active=false;},
    fetch:(_url,options)=>{requestSignal=options.signal;return new Promise(resolve=>{finish=()=>resolve({status:200});});}});
  const pending=h.run("fetchSessionData('/api/events?year=2026')");
  for(const timer of timers)if(timer.active&&timer.ms<=35000)timer.fn();
  assert.equal(requestSignal.aborted,false,'a cold calendar must survive the old 30-second cutoff');
  finish();
  assert.equal((await pending).status,200);
  assert.ok(timers.every(timer=>!timer.active),'successful requests clean up their deadline');
});

test('data requests retry transient errors but not valid missing-data responses', async () => {
  const h = context(); let calls = 0;
  const waits = [];
  Object.assign(h.sandbox, {AbortController, DOMException, setTimeout: (fn, ms) => { if (ms >= 2000 && ms < 30000) waits.push(ms); return setTimeout(fn, 0); }, clearTimeout});
  h.sandbox.fetch = async () => ({status: ++calls < 2 ? 503 : 200, text: async()=>''});
  assert.equal((await h.run("fetchSessionData('/test')")).status, 200);
  assert.equal(calls, 2);
  calls = 0; h.sandbox.fetch = async () => {calls++;return {status:404};};
  assert.equal((await h.run("fetchSessionData('/missing')")).status, 404);
  assert.equal(calls, 1);
  // The hosting platform's own HTML 500 (request time limit while the data
  // Worker still computes) is retried after a real wait; our API's JSON 500 is not.
  const page = {status: 500, headers: {get: () => 'text/html'}, text: async () => '<!DOCTYPE html><html lang="en-US">'};
  calls = 0; waits.length = 0;
  h.sandbox.fetch = async () => ++calls < 3 ? page : {status: 200, headers: {get: () => 'application/json'}, text: async () => '{}'};
  assert.equal((await h.run("fetchSessionData('/api/data?path=x')")).status, 200);
  assert.equal(calls, 3); assert.deepEqual(waits, [5000, 15000]);
  calls = 0; h.sandbox.fetch = async () => {calls++; return {status: 500, headers: {get: () => 'application/json'}, text: async () => '{"detail":"x"}'};};
  assert.equal((await h.run("fetchSessionData('/api/data?path=y')")).status, 500);
  assert.equal(calls, 1);
  // Still failing: a readable message, never the HTML page.
  h.sandbox.page = page;
  await assert.rejects(h.run('readApiResponse(page)'), error => /stopped before this session finished computing/.test(error.message) && !/DOCTYPE/.test(error.message) && error.status === 500);
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
  assert.doesNotMatch(performance, /Exit-inclusive lap attribution \(previous chart\)/);
  assert.match(html, /\+0\.102 s means about a tenth of a second longer per measured braking zone/);
  assert.match(readFileSync('index.html','utf8'), /id="explanationsToggle"[^>]+>[\s\S]*?Show explanations/);
  assert.doesNotMatch(performance,/data-performance-explain\s/);
  assert.match(performance, /data-telemetry-subject/);
  assert.match(performance, /data-corner-session/);
  assert.doesNotMatch(performance, /\['raceCorners','Race cornering'\]/, 'race cornering belongs inside Cornering');
  assert.match(html, /not brake pressure/);
});







test('season effects bridge unequal circuit coverage through shared teams', () => {
  const source=readFileSync('car-performance.js','utf8');
  const body=source.slice(source.indexOf('function eventAdjustedScores('),source.indexOf('const STRAIGHT_PILLS='));
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

test('straight common coverage retains the widest field before extra GPs',()=>{
  const source=readFileSync('car-performance.js','utf8');
  const box={finite:Number.isFinite,avg:a=>a.reduce((s,v)=>s+v,0)/a.length};
  vm.createContext(box);vm.runInContext(source.slice(source.indexOf('function eventAdjustedScores('),source.indexOf('const STRAIGHT_PILLS=')),box);
  const reports=[['One','ABCD'],['Two','ABC'],['Three','ABC']].map(([name,cars])=>({event:{name},summary:{rows:new Map([...cars].map((team,i)=>[team,{team,value:i}]))}}));
  const previous=box.eventAdjustedScores(reports,r=>r.value,'mean','common');
  const corrected=box.eventAdjustedScores(reports,r=>r.value,'mean','common','teams');
  assert.equal(previous.size,3);assert.equal(corrected.size,4);
  assert.deepEqual([...corrected.coverage.events],['One']);
});

test('temporary telemetry errors retry, permanent failures and cancellation do not',async()=>{
  const source=readFileSync('car-performance.js','utf8');let requests=0;
  const box={window:{},URLSearchParams,refreshPerformance:false,DOMException,setTimeout:fn=>{queueMicrotask(fn);return 1;},clearTimeout(){},
    fetch:async()=>({ok:++requests===3,status:503,json:async()=>({detail:'busy'})})};
  vm.createContext(box);vm.runInContext(source.slice(source.indexOf('async function get('),source.indexOf('function completed(')),box);
  await box.get('/api/telemetry');assert.equal(requests,3);
  requests=0;box.fetch=async()=>{requests++;return {ok:false,status:422,json:async()=>({detail:'unsupported'})};};
  await assert.rejects(()=>box.get('/api/telemetry'),/unsupported/);assert.equal(requests,1);
  const controller=new AbortController();controller.abort();
  box.fetch=async()=>{requests++;throw controller.signal.reason;};
  await assert.rejects(()=>box.get('/api/telemetry',controller.signal),{name:'AbortError'});assert.equal(requests,2);
  assert.match(source,/cornerSubjects\[subject\]=measured.complete/);
  assert.match(source,/if\(activeMetric==='pits'\) loadPitData\(\);\s*if\([^\n]+loadQualifyingMetrics\(\)/);
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


test('overall tyre chart shows sparse matched evidence as provisional', () => {
  const source=readFileSync('car-performance.js','utf8');
  const body=source.slice(source.indexOf('function renderRace(teams)'),source.indexOf('function renderResults('));
  assert.match(body,/minimumCompoundEvents=1/);
  assert.match(body,/\.filter\(c => c && c\.events\.length >= minimumCompoundEvents\)/);
  assert.match(body,/compoundNorm\.length \? avg\(compoundNorm\) : null/);
  assert.match(body,/provisional:!r\.complete\?`Provisional/);
});

test('tyre-age view aggregates own stints for teams and individual drivers', () => {
  // tyreAgeView hands src/views/TyresView.tsx plain data; check the numbers it ranks.
  const source=readFileSync('car-performance.js','utf8');
  const body=source.slice(source.indexOf('function tyreStintKey('),source.indexOf('function renderRace(teams)'));
  const sandbox={tyreMetric:'age',tyreSubject:'team',tyreView:'OVERALL',tyreSeasonStat:'mean',tyreLapMode:'all',tyreCorrection:'fuel',tyreFuelRate:.060,tyreWeighting:'balanced',tyreRunKey:'',tyrePlotTeam:'',tyrePlotDriver:'',tyrePlotEvent:'',sortKey:'tyreAgeValue',sortDirection:1,
    tyreConditionMode:'all',context:{year:'2026'},events:[{round:1,R:{}},{round:2,R:{}}],
    VERIFIED_DRY_ALLOCATIONS:{2026:['345','234']},TYRE_ALLOCATION_SOURCES:{2026:'https://press.pirelli.com/'},
    avg:a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null,summarize:(a)=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null,
    sorted:(items,getters,key)=>[...items].sort((a,b)=>getters[key](a)-getters[key](b)),
    finite:n=>typeof n==='number'&&Number.isFinite(n),fmt:(n,d=3,u='')=>Number.isFinite(n)?n.toFixed(d)+u:'—',signed:(n,d=3,u='')=>Number.isFinite(n)?`${n>0?'+':''}${n.toFixed(d)}${u}`:'—',
    sortHeaderModel:(key,label,direction)=>({key,label,direction})};
  vm.createContext(sandbox);vm.runInContext(body,sandbox);
  const close=(value,expected,message)=>assert.ok(Math.abs(value-expected)<1e-9,`${message||''} ${value} vs ${expected}`);
  const teams=[{team:'Example',color:'#123456',tyreAgeStints:[
    {driver:'AAA',event:'One',compound:'SOFT',compound_grade:'C5',fuel_adjusted_slope:.12,samples:8,min_age:1,max_age:8,points:[{lap:3,age:1,time:90.123},{lap:4,age:2,time:90.183},{lap:5,age:3,time:90.243}]},
    {driver:'BBB',event:'One',compound:'SOFT',compound_grade:'C5',fuel_adjusted_slope:.04,samples:8,min_age:1,max_age:8},
    {driver:'AAA',event:'Two',compound:'MEDIUM',compound_grade:'C3',fuel_adjusted_slope:.02,samples:10,min_age:1,max_age:10}
  ]}];
  let view=sandbox.tyreAgeView(teams);
  close(view.rows[0].value,.05,'equal event weighting: C5 (.08), then C3 (.02)');
  assert.match(view.rows[0].coverage,/2 C grades/);
  assert.ok(view.evidence.some(e=>e.grade==='C5'));
  assert.ok(view.plot.points.some(p=>/90\.123 s observed/.test(p.title)));
  assert.ok(view.evidence.some(e=>e.inspect));
  assert.doesNotMatch(JSON.stringify(view),/NaN|Infinity/);
  assert.equal(view.picker.team,'Example');
  sandbox.tyreFuelRate=.080;close(sandbox.tyreAgeView(teams).chart.rows[0].value,.07);
  sandbox.tyreFuelRate=.060;
  const other={team:'Other',color:'#654321',tyreAgeStints:[{driver:'CCC',event:'Three',compound_grade:'C5',fuel_adjusted_slope:.04,samples:8,min_age:1,max_age:8,points:[{lap:3,age:1,time:92},{lap:4,age:2,time:92.04},{lap:5,age:3,time:92.08}]}]};
  sandbox.tyrePlotTeam='Other';
  view=sandbox.tyreAgeView([...teams,other]);
  assert.match(view.plot.title,/CCC · Three/);assert.equal(view.picker.teamCount,2);
  sandbox.tyrePlotTeam='';sandbox.tyreView='C3';
  view=sandbox.tyreAgeView(teams);close(view.rows[0].value,.02);
  assert.ok(!view.chart.rows.some(r=>Math.abs(r.value-.08)<1e-9));
  sandbox.tyreView='OVERALL';sandbox.tyreSubject='driver';
  const names=sandbox.tyreAgeView(teams).rows.map(r=>r.team.displayName);
  assert.ok(names.includes('AAA · Example')&&names.includes('BBB · Example'));
  sandbox.tyreSubject='team';sandbox.tyreView='C5';
  teams[0].tyreAgeStints[0].samples=32;
  close(sandbox.tyreAgeView(teams).rows[0].value,.08,'driver weights stay equal');
  sandbox.tyreWeighting='laps';close(sandbox.tyreAgeView(teams).rows[0].value,.104);
  sandbox.tyreWeighting='balanced';sandbox.tyreCorrection='raw';
  teams[0].tyreAgeStints[0].raw_slope=.06;teams[0].tyreAgeStints[1].raw_slope=-.02;
  close(sandbox.tyreAgeView(teams).rows[0].value,.02);
  sandbox.tyreCorrection='fuel';sandbox.tyreLapMode='clear';
  teams[0].tyreAgeStints[0].clean_air={supported:true,samples:12,fuel_adjusted_slope:.03,min_age:1,max_age:14};
  close(sandbox.tyreAgeView(teams).rows[0].value,.03);
});

test('tyre GP summaries handle skew and explain every sparse P75 blank', () => {
  const source=readFileSync('car-performance.js','utf8');
  const body=source.slice(source.indexOf('function tyreStintKey('),source.indexOf('function renderRace(teams)'));
  const sandbox={tyreMetric:'age',tyreSubject:'team',tyreView:'C3',tyreSeasonStat:'mean',tyreLapMode:'all',tyreCorrection:'fuel',tyreFuelRate:.060,tyreWeighting:'balanced',tyreRunKey:'',tyrePlotTeam:'',tyrePlotDriver:'',tyrePlotEvent:'',sortKey:'tyreAgeValue',sortDirection:1,
    tyreConditionMode:'all',context:{year:2026},events:[1,2,3,4].map(round=>({round,R:{}})),
    VERIFIED_DRY_ALLOCATIONS:{2026:['123','123','123','123']},TYRE_ALLOCATION_SOURCES:{2026:'https://press.pirelli.com/'},
    avg:a=>{const x=a.filter(Number.isFinite);return x.length?x.reduce((s,v)=>s+v,0)/x.length:null;},
    summarize:(a,mode)=>{const x=a.filter(Number.isFinite).sort((v,w)=>v-w);if(!x.length)return null;if(mode==='median')return(x[Math.floor((x.length-1)/2)]+x[Math.ceil((x.length-1)/2)])/2;if(mode==='p75'){const i=(x.length-1)*.75,l=Math.floor(i),h=Math.ceil(i);return x[l]+(x[h]-x[l])*(i-l);}return x.reduce((s,v)=>s+v,0)/x.length;},
    sorted:(rows,getters,key)=>[...rows].sort((a,b)=>(getters[key](a)??Infinity)-(getters[key](b)??Infinity)),
    finite:n=>typeof n==='number'&&Number.isFinite(n),fmt:(n,d=3,u='')=>Number.isFinite(n)?n.toFixed(d)+u:'—',signed:(n,d=3,u='')=>Number.isFinite(n)?`${n>0?'+':''}${n.toFixed(d)}${u}`:'—',
    sortHeaderModel:(key,label,direction)=>({key,label,direction})};
  vm.createContext(sandbox);vm.runInContext(body,sandbox);
  const slopes=[.01,.02,.03,.5];
  const teams=[{team:'Measured',color:'#123456',tyreAgeStints:slopes.map((s,i)=>({event:`GP ${i+1}`,compound_grade:'C3',fuel_adjusted_slope:s,samples:8}))},
    {team:'Missing',color:'#888888',tyreAgeStints:[]}];
  const measured=()=>sandbox.tyreAgeView(teams).rows.find(r=>r.team.team==='Measured');
  for(const [mode,expected] of [['mean',.14],['median',.025],['p75',.1475]]){
    sandbox.tyreSeasonStat=mode;
    assert.ok(Math.abs(measured().value-expected)<1e-9,mode);
  }
  sandbox.tyreSeasonStat='p75';
  teams[0].tyreAgeStints.pop();
  const sparse=sandbox.tyreAgeView(teams);
  assert.match(sparse.rows.find(r=>r.team.team==='Measured').shortfall,/C3: 3\/4 GPs/);
  assert.ok(sparse.rows.some(r=>r.team.team==='Missing'));
  sandbox.tyreView='OVERALL';
  teams[0].tyreAgeStints.push({event:'GP 4',compound_grade:'C3',fuel_adjusted_slope:.5,samples:8});
  teams[0].tyreAgeStints.push({event:'GP 1',compound_grade:'C2',fuel_adjusted_slope:.04,samples:8});
  assert.match(measured().shortfall,/C2: 1\/4 GPs/);
});

test('tyre-age C grades use the race-year Pirelli allocation, including skipped 2025 grades', async () => {
  const sandbox=await import('../performance-identity.js');
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
  assert.match(readFileSync('src/views/TyresView.tsx','utf8'),/Outlier laps removed/);
  assert.doesNotMatch(view.slice(view.indexOf('function tyreAgeView'),view.indexOf('function renderRace')),/Tyre-age range/);
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
  assert.match(source,/\['pitSpread','Spread \(IQR\)',1\]/);
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
  // Controls are drawn by src/views/PitsView.tsx.
  const pitsView=readFileSync('src/views/PitsView.tsx','utf8');
  assert.match(pitsView,/data-pit-measure="stop"/);
  assert.match(pitsView,/data-pit-measure="lane"/);
  assert.match(pitsView,/name="pit-subject"[^>]*\[\['team', 'Teams'\], \['driver', 'Drivers'\]\]/);
  assert.match(pitsView,/name="pit-chart"[\s\S]*\['mean', 'Mean'\], \['median', 'Median'\], \['fastest', 'Quickest'\], \['spread', 'Consistency · IQR'\]/);
  assert.doesNotMatch(pitsView,/'p90'|'p10'/);
  assert.match(pitsView,/name="pit-lane-basis"[^>]*\['event', 'Vs GP median'\]/);
  assert.match(source,/chartValue:pitChartMetric==='spread'\?pitMiddleSpread/);
  assert.match(readFileSync('src/views/PitsView.tsx','utf8'),/Exact times for individual pit visits/);
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
  assert.match(readFileSync('src/views/PitsView.tsx','utf8'),/\['fastest', 'Quickest'\]/);
  assert.match(source,/preserveSignedValues:relativeLane/);
});

test('pit chart, sortable table and exact rows show the same selected measurement', () => {
  // renderPits hands src/views/PitsView.tsx plain data (rendered in test-react-views.mjs).
  const source=readFileSync('car-performance.js','utf8');
  const body=source.slice(source.indexOf('function pitSummary'),source.indexOf('function huberRegression'));
  let view=null;
  const sandbox={finite:Number.isFinite,completed:()=>true,events:[],context:{scope:'tracks',selectedTracks:[1]},
    pitVisitMode:'all',pitMeasure:'lane',pitLaneBasis:'event',pitSubject:'team',pitChartMetric:'mean',sortKey:'pitMean',sortDirection:1,
    avg:a=>{const x=a.filter(Number.isFinite);return x.length?x.reduce((s,v)=>s+v,0)/x.length:null;},
    median:a=>{const x=a.filter(Number.isFinite).sort((v,w)=>v-w);return x.length?x.length%2?x[(x.length-1)/2]:(x[x.length/2-1]+x[x.length/2])/2:null;},
    percentile:(a,p)=>{const x=a.filter(Number.isFinite).sort((v,w)=>v-w);if(!x.length)return null;const i=(x.length-1)*p,l=Math.floor(i),h=Math.ceil(i);return x[l]+(x[h]-x[l])*(i-l);},
    sortHeaderModel:(key,label,direction)=>({key,label,direction}),reactView:(name,props)=>{view={name,props};return '';},
    sorted:(rows,getters,key)=>[...rows].sort((a,b)=>{const av=getters[sandbox.sortKey in getters?sandbox.sortKey:key](a),bv=getters[sandbox.sortKey in getters?sandbox.sortKey:key](b);return av==null?1:bv==null?-1:(av-bv)*sandbox.sortDirection;})};
  sandbox.events=[
    {name:'GP 1',pits:{source:'OpenF1',visits:[{driver:'AAA',team:'A',lap:1,lane_duration:22,stop_duration:2},{driver:'BBB',team:'B',lap:1,lane_duration:20,stop_duration:2.5}]}},
    {name:'GP 2',pits:{source:'OpenF1',visits:[{driver:'AAA',team:'A',lap:2,lane_duration:40,stop_duration:3},{driver:'BBB',team:'B',lap:2,lane_duration:28,stop_duration:2.4}]}}
  ];
  vm.createContext(sandbox);vm.runInContext(body,sandbox);
  sandbox.renderPits([]);
  assert.equal(view.name,'pits');
  const value=(row,key)=>row.sample[key];
  assert.deepEqual(view.props.rows.map(r=>r.team),['B','A'],'sorted by the selected GP-relative mean');
  assert.equal(value(view.props.rows[0],'mean'),-3.5);assert.equal(value(view.props.rows[1],'mean'),3.5);
  assert.deepEqual(view.props.chartRows.map(r=>r.chartValue).sort(),[-3.5,3.5],'the chart shows the same measurement');
  assert.equal(view.props.chart.preserveSignedValues,true);
  assert.equal(view.props.visits.length,4);assert.equal(view.props.visits[0].lane,22);
  sandbox.pitChartMetric='fastest';sandbox.renderPits([]);
  assert.match(view.props.chart.title,/Best GP gap/);assert.equal(view.props.sort.pitFastest.label,'Best GP gap');
  assert.equal(value(view.props.rows.find(r=>r.team==='B'),'fastest'),-6);
  sandbox.pitSubject='driver';sandbox.pitMeasure='stop';sandbox.pitLaneBasis='raw';sandbox.pitChartMetric='median';sandbox.sortKey='pitMedian';
  sandbox.renderPits([]);
  assert.match(view.props.chart.title,/stationary stop/);assert.equal(view.props.rows[0].driver,'BBB');
  assert.equal(view.props.visits.find(v=>v.driver==='AAA'&&v.lap===1).stop,2);
  sandbox.pitSubject='team';sandbox.events=[{name:'Ten-stop GP',pits:{source:'OpenF1',visits:[
    ...Array.from({length:10},(_,i)=>({driver:'AAA',team:'A',lap:i+1,lane_duration:20+i,stop_duration:i+1})),
    ...Array.from({length:10},(_,i)=>({driver:'BBB',team:'B',lap:i+1,lane_duration:21+i,stop_duration:i+2}))
  ]}}];
  for(const [metric,expected,key] of [['mean',5.5,'mean'],['median',5.5,'median'],['fastest',1,'fastest'],['spread',4.5,'spread']]){
    sandbox.pitChartMetric=metric;sandbox.renderPits([]);
    const a=view.props.rows.find(r=>r.team==='A');
    assert.ok(Math.abs(value(a,key)-expected)<1e-9,metric);
    assert.ok(Math.abs(view.props.chartRows.find(r=>r.team==='A').chartValue-expected)<1e-9,metric);
    assert.equal(view.props.visits.length,20);
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
  assert.match(readFileSync('scripts/sync-static.mjs','utf8'),/buildUiStyles/);
});

test('native corner projection follows the aligned comparison grid', () => {
  const h=context();
  h.sandbox.document.querySelector=()=>({value:'1'});
  h.run("calendar=[];sessionCircuitKey=63;samples=[{Distance:0,AlignedFraction:0},{Distance:500,AlignedFraction:.6},{Distance:1000,AlignedFraction:1}]");
  assert.equal(h.run("resolveCornerMarkers(samples,1000,[{number:'1',fraction:.5,source:'lap_projection'}])[0].fraction"),.6);
});

test('speed annotations label each lap\'s own measured extremes, matched by GPS, in whole km/h', () => {
  const h=context();
  assert.equal(h.run('showSpeedAnnotations'),false);
  assert.equal((app.match(/id="speedAnnotationToggle"/g)||[]).length,1);
  assert.match(app,/Corner numbers<\/span><\/label>\s*<label[^\n]+id="speedAnnotationToggle"/);
  // Lap B reaches its own minimum 30 m later than A (fractions drift); a fixed
  // marker at A's minimum would read B's entry speed instead of its apex.
  const lap=(code,shift,offset)=>({lap:{code,lap:1},samples:Array.from({length:1001},(_,i)=>{
    const m=i*5,d=Math.abs(m-1000-shift),e=Math.abs(m-3000-shift);
    return {Distance:m,AlignedFraction:i/1000,X:m*10,Y:0,Speed:(d<150?80.4+d*.8:e<200?300-e*.3:250)-offset};})});
  h.sandbox.entries=[lap('A',0,0),lap('B',30,3)];
  h.sandbox.markers=[{number:'1',fraction:.2}];
  const results=h.run('buildSpeedAnnotations(entries,markers,5000)');
  const dip=results.find(r=>r.kind==='min'),peak=results.find(r=>r.kind==='max'&&Math.abs(r.fraction-.6)<.01);
  assert.ok(dip&&peak);
  assert.equal(dip.title,'T1');
  assert.equal(dip.values.length,2);
  assert.ok(Math.abs(dip.values.find(v=>v.lap.code==='B').fraction-.206)<.002,'B uses its own minimum, not A\'s position');
  assert.equal(dip.values[0].lap.code,'A');assert.equal(Math.round(dip.values[1].speed),77);
  h.sandbox.dip=dip;
  assert.deepEqual(JSON.parse(JSON.stringify(h.run('speedAnnotationLines(dip).map(l=>l.text)'))),['A 80','B −3']);
  // Too far away by GPS: B's dip 400 m later is never matched as its minimum.
  // B is steady at 250 km/h where A brakes, so B's speed at that place is shown.
  h.sandbox.entries=[lap('A',0,0),lap('B',400,0)];
  const far=h.run('buildSpeedAnnotations(entries,markers,5000)').find(r=>r.kind==='min'&&r.fraction<.3);
  assert.equal(far.missing.length,0);
  const b=far.values.find(v=>v.lap.code==='B');
  assert.ok(b.atPoint);assert.equal(b.speed,250);assert.ok(Math.abs(b.fraction-far.fraction)<1e-12);
  // On a slope (still braking or accelerating there) a same-place speed would
  // depend on position drift: shown as missing, not a number.
  h.sandbox.entries=[lap('A',0,0),lap('B',150,0)];
  const slope=h.run('buildSpeedAnnotations(entries,markers,5000)').find(r=>r.kind==='min'&&r.fraction<.3);
  assert.ok(!slope.values.some(v=>v.lap.code==='B'&&v.atPoint));
  assert.doesNotMatch(app,/toFixed\(3\):\(a\.speed/);
});

test('speed extremes need prominence and native support, so noise and gaps are not labelled', () => {
  const h=context();
  h.sandbox.samples=Array.from({length:1001},(_,i)=>({AlignedFraction:i/1000,Speed:300+(i%2?3:0)}));
  assert.equal(h.run('lapSpeedExtremes(samples,5000).length'),0,'3 km/h ripple is not an extreme');
  h.run('samples=Array.from({length:1001},(_,i)=>({AlignedFraction:i/1000,Speed:i>=480&&i<=520?150+Math.abs(i-500)*5:250}))');
  assert.equal(h.run("lapSpeedExtremes(samples,5000).filter(e=>e.kind==='min').length"),1);
  assert.equal(h.run("lapSpeedExtremes(samples,5000).find(e=>e.kind==='min').speed"),150);
  h.run('samples=samples.filter(p=>p.AlignedFraction<.49||p.AlignedFraction>.51)');
  assert.equal(h.run("lapSpeedExtremes(samples,5000).filter(e=>e.kind==='min').length"),0,'no extreme across a telemetry gap');
});

test('straight maxima use the true raw peak on a sparse 4 Hz feed, and unmatched laps fall back to their own segment extreme', () => {
  const h=context();
  // 85 m/s at 4 Hz: packets ~21-50 m apart, plus a routine 1.08 s packet into braking.
  // The real top speed (308) follows a 37 m gap
  // and a 306 plateau 61 m earlier; the label must use 308, the value the line draws through.
  h.sandbox.samples=[[1300,280,0],[1351,296,.6],[1390,299,1.06],[1427,303,1.5],[1467,304,1.97],[1505,305,2.42],[1532,306,2.74],[1556,306,3.02],[1593,308,3.46],[1677,253,4.54],[1700,226,4.86],[1720,180,5.3],[1750,120,5.9],[1770,100,6.4],[1800,140,7]]
    .map(([m,v,t])=>({AlignedFraction:m/5000,Speed:v,ElapsedSeconds:t}));
  const max=h.run("lapSpeedExtremes(samples,5000).filter(e=>e.kind==='max')");
  assert.equal(max.length,1);assert.equal(max[0].speed,308);
  // Two equal peaks separated by a 1 km/h dip (Sepang back straight) get one label, not two.
  h.sandbox.twin=[[0,250],[100,280],[200,306],[230,305],[260,306],[300,250],[400,120],[500,200]].map(([m,v],i)=>({AlignedFraction:m/5000,Speed:v,ElapsedSeconds:i*.4}));
  assert.equal(h.run("lapSpeedExtremes(twin,5000).filter(e=>e.kind==='max').length"),1);
  assert.ok(Math.abs(h.run("lapSpeedExtremes(twin,5000).find(e=>e.kind==='max').fraction")-200/5000)<1e-9);
  // B has no matching extreme within 70 m, but has its own clear dip inside the segment.
  const lap=(code,shift)=>({lap:{code,lap:1},samples:Array.from({length:1001},(_,i)=>{const m=i*5,d=Math.abs(m-2500-shift);return {AlignedFraction:i/1000,Speed:d<150?90+d*.8:210};})});
  h.sandbox.entries=[lap('A',0),lap('B',90)];
  const dip=h.run("buildSpeedAnnotations(entries,[],5000).find(r=>r.kind==='min')");
  assert.equal(dip.values.length,2);assert.equal(dip.missing.length,0);
  assert.ok(dip.values.find(v=>v.lap.code==='B').segment);
});

test('shared corner positions interpolate bounded native brackets without fabricating missing speeds', () => {
  const h=context();
  h.sandbox.entry={lap:{code:'A',lap:1},samples:[
    {AlignedFraction:.598,Speed:250,ElapsedSeconds:10},
    {AlignedFraction:.602,Speed:270,ElapsedSeconds:10.3}]};
  assert.equal(h.run('sharedCornerSpeed(entry,.6,5000).speed'),260);
  assert.equal(h.run('sharedCornerSpeed(entry,.6,5000).estimated'),true);
  assert.equal(h.run('sharedCornerSpeed(entry,.59,5000)'),null);
  assert.equal(h.run('sharedCornerSpeed(entry,.61,5000)'),null);
  h.run('entry.samples[1].ElapsedSeconds=11');
  assert.equal(h.run('sharedCornerSpeed(entry,.6,5000)'),null);
  h.run('entry.samples[1].ElapsedSeconds=10.3;entry.samples[1].Speed=null');
  assert.equal(h.run('sharedCornerSpeed(entry,.6,5000)'),null);
});

test('mini-sector colours cover every dense track vertex and exact 25 m boundaries including the final tail', () => {
  const h=context();
  h.run('performanceSectionDuration=(s,a,b)=>(b-a)*s.time');
  const segments=h.run('miniSectorDominanceSegments([{time:95},{time:96}],5476.622)');
  assert.equal(segments.length,220);
  assert.equal(segments[0].start,0);
  assert.equal(segments.at(-1).end,1);
  segments.forEach((segment,index)=>{
    assert.equal(segment.winner,0);
    if(index)assert.equal(segment.start,segments[index-1].end);
    assert.ok(Math.abs((segment.end-segment.start)*5476.622-25)<1e-8||index===219);
    h.sandbox.fraction=(segment.start+segment.end)/2;
    const hover=h.run('miniSectorBounds(5476.622,fraction)');
    assert.equal(hover.start,segment.start);
    assert.equal(hover.end,segment.end);
  });
  h.sandbox.geometry=Array.from({length:3000},(_,i)=>({x:i,y:Math.sin(i/20)}));
  h.sandbox.segments=segments;
  const retained=h.run('segments.flatMap(s=>miniSectorGeometryPoints(geometry,s.start,s.end,f=>({x:f*3000,y:0}))).map(p=>p.x)');
  for(let i=0;i<3000;i++)assert.ok(retained.includes(i),`dense vertex ${i} is covered`);
  h.run('performanceSectionDuration=(s,a,b)=>s.time');
  assert.ok(h.run('miniSectorDominanceSegments([{time:1},{time:null}],100).every(s=>s.winner===-1)'));
  assert.ok(h.run('miniSectorDominanceSegments([{time:1},{time:0}],100).every(s=>s.winner===-1)'));
  assert.ok(h.run('miniSectorDominanceSegments([{time:1}],100).every(s=>s.winner===-1)'));
});

test('combined selected sections count overlap once and use whole-section average speed', () => {
  const h=context();
  h.sandbox.zones=[{start:.1,end:.2},{start:.15,end:.25},{start:.4,end:.5}];
  h.run('performanceSectionDuration=(s,a,b)=>(b-a)*100');
  const result=h.run('combinedCornerPerformance([],zones,5000)');
  assert.ok(Math.abs(result.sectionTime-25)<1e-8);
  assert.ok(Math.abs(result.minimumSpeed-180)<1e-8);
  assert.equal(result.combined,true);
  assert.equal(h.run('mergeCornerWindows(zones).length'),2);
  assert.equal(JSON.stringify(h.run('cornerSelectionWindows(zones,[0,1,2])')),JSON.stringify([{start:.1,end:.25},{start:.4,end:.5}]));
  const separate=h.run('combinedCornerPerformance([],zones,5000,[0,2])');
  assert.ok(Math.abs(separate.sectionTime-20)<1e-8);
  assert.equal(h.run('combinedCornerPerformance([],zones,5000,[])'),null);
  h.run('performanceSectionDuration=(s,a,b)=>a===.1&&b===.25?null:(b-a)*100');
  assert.equal(h.run('combinedCornerPerformance([],zones,5000)'),null,'missing whole-section timing is not replaced by a sum of individual corners');
});

test('separate straight zones fill the whole lap without changing corner-only source windows', () => {
  const h=context();
  h.run('sessionStraightEvidence=()=>true');
  h.sandbox.rawZones=[{start:.1,end:.2,apex:.15,apexStart:.13,apexEnd:.17},
    {start:.25,end:.35,apex:.3,apexStart:.28,apexEnd:.32},
    {start:.6,end:.7,apex:.65,apexStart:.63,apexEnd:.67},
    {start:.8,end:.9,apex:.85,apexStart:.83,apexEnd:.87}];
  const original=JSON.stringify(h.sandbox.rawZones);
  const zones=h.run('sessionPerformanceZones(rawZones,5000)');
  zones.slice(0,4).forEach((zone,i)=>{
    assert.equal(zone.start,h.sandbox.rawZones[i].start);
    assert.equal(zone.end,h.sandbox.rawZones[i].end);
    assert.equal(zone.apexStart,h.sandbox.rawZones[i].apexStart);
    assert.equal(zone.apexEnd,h.sandbox.rawZones[i].apexEnd);
  });
  assert.equal(JSON.stringify(h.sandbox.rawZones),original);
  assert.ok(Math.abs(zones.reduce((sum,z)=>sum+z.end-z.start,0)-1)<1e-12);
  h.sandbox.zones=zones;
  h.run('selectedCornerIndices=new Set(zones.map((_,i)=>i));performanceSectionDuration=(s,a,b)=>(b-a)*100');
  assert.equal(JSON.stringify(h.run('selectedCornerWindows(zones)')),JSON.stringify([{start:0,end:1}]));
  const combined=h.run('combinedCornerPerformance([],zones,5000,selectedCornerIndices)');
  assert.equal(combined.sectionTime,100);
  assert.equal(combined.minimumSpeed,180);
  assert.equal(zones.filter(z=>z.kind==='straight').length,5);
  const single=h.run('combinedCornerPerformance([],zones,5000,[6])');
  assert.ok(Math.abs(single.sectionTime-25)<1e-8);
  assert.equal(single.minimumSpeed,180);
  assert.match(app,/aria-label="Select straight zones"/);
});

test('linking straights are explicitly selected for consecutive corners and can be removed',()=>{
  const h=context();
  h.sandbox.rawZones=[{number:'1',start:.1,end:.2},{number:'2',start:.2,end:.3},
    {number:'3',start:.4,end:.5},{number:'4',start:.7,end:.8}];
  h.run('zones=sessionPerformanceZones(rawZones,5000);selectedCornerIndices=new Set([0,1,2,3]);linked=selectLinkingStraights(zones,selectedCornerIndices,new Set());selectedCornerIndices=linked.selection');
  assert.equal(JSON.stringify(h.run('selectedCornerWindows(zones)')),JSON.stringify([{start:.1,end:.8}]));
  assert.equal(h.run('linked.automatic.size'),2);
  assert.equal(h.run('linked.automatic.has(5)'),false,'an empty straight between touching windows is not selected');
  h.run('selectedCornerIndices.delete(7);linked.automatic.delete(7)');
  assert.equal(JSON.stringify(h.run('selectedCornerWindows(zones)')),JSON.stringify([{start:.1,end:.5},{start:.7,end:.8}]));
  h.run('selectedCornerIndices.delete(2);next=selectLinkingStraights(zones,selectedCornerIndices,linked.automatic)');
  assert.equal(h.run('next.selection.has(6)'),false,'automatic link is removed when its neighbouring corner is removed');
  assert.equal(h.run('next.selection.has(0)'),true);
  h.run('rawZones[1].start=.2+1e-16;dust=sessionPerformanceZones(rawZones,5000)');
  assert.equal(h.run('dust[5].end-dust[5].start'),0,'floating-point dust cannot become an unsupported straight');
  assert.equal(h.run('dust[1].start'),.2);
});

test('short transitions are absorbed, unknown geometry is not advertised as a straight, and empty selection stays empty',()=>{
  const h=context();
  h.run('sessionStraightEvidence=()=>true');
  h.sandbox.rawZones=[{number:'1',start:.01,end:.2,apexStart:.1,apexEnd:.15},
    {number:'2',start:.201,end:.4,apexStart:.25,apexEnd:.3},
    {number:'3',start:.6,end:.99,apexStart:.7,apexEnd:.8}];
  h.run('zones=sessionPerformanceZones(rawZones,5000)');
  assert.equal(h.run('zones[0].start'),0);
  assert.equal(h.run('zones[0].end'),.2005);
  assert.equal(h.run('zones[1].start'),.2005);
  assert.equal(h.run('zones[2].end'),1);
  assert.ok(h.run("zones.filter(z=>z.kind==='straight'&&z.end>z.start).every(z=>z.metres>=100)"));
  assert.equal(h.run("zones.filter(z=>z.kind==='straight').length"),1);
  h.run('sessionStraightEvidence=()=>false;zones=sessionPerformanceZones(rawZones,5000)');
  assert.equal(h.run("zones.filter(z=>z.kind==='straight').length"),0);
  assert.equal(h.run("zones.filter(z=>z.kind==='transition'&&z.end>z.start).length"),1);
  assert.equal(JSON.stringify(h.run('mergeCornerWindows(zones)')),JSON.stringify([{start:0,end:1}]));
  assert.equal(h.run('selectedCornerIndices.size'),0);
  assert.equal(h.run('selectedCornerWindows(zones).length'),0);
  assert.doesNotMatch(app,/if\(!selectedCornerIndices.size\)selectedCornerIndices.add/);
  assert.doesNotMatch(app,/if\(selectedCornerIndices.size>1\)/);
});

test('circuit guide separates sourced historical characteristics from current tyre nominations',()=>{
  assert.match(app,/Pirelli corner guide · 22 Mar 2012/);
  assert.match(app,/if\(sessionYear===2026\)official/);
  assert.match(app,/ratings are not inferred from lap speed/);
  assert.doesNotMatch(readFileSync('index.html','utf8'),/id="circuitGuide(?:Info|Details)"/);
  assert.match(app,/data-map-view/);
});

test('map selection shares all merged measured windows and marks every outer boundary',()=>{
  const h=context();
  h.sandbox.zones=[{start:.1,end:.2},{start:.15,end:.25},{start:.4,end:.5},{start:.7,end:.8}];
  h.run('selectedCornerIndices=new Set([0,1,3])');
  assert.equal(JSON.stringify(h.run('selectedCornerWindows(zones)')),JSON.stringify([{start:.1,end:.25},{start:.7,end:.8}]));
  h.run('selectedCornerIndices=new Set([0,2,3,99])');
  assert.equal(JSON.stringify(h.run('selectedCornerWindows(zones)')),JSON.stringify([{start:.1,end:.2},{start:.4,end:.5},{start:.7,end:.8}]));
  h.run('selectedCornerIndices=new Set([0,1,2,3])');
  assert.equal(h.run('selectedCornerWindows(zones).length'),3);
  h.run('selectedCornerIndices=new Set([3,2,1,0])');
  assert.equal(h.run('selectedCornerWindows(zones).length'),3);
  const map=app.slice(app.indexOf('function renderMiniSectorMap()'),app.indexOf('function init',app.indexOf('function renderMiniSectorMap()')));
  assert.match(map,/selectedCornerWindows\(sessionPerformanceZones\(adaptiveCornerZones\(markerCorners\), totalDistance\)\)/);
  assert.match(map,/for \(const window of highlightedCornerWindows\)/);
  assert.match(map,/highlightedCornerWindows.flatMap\(window => \[window.start, window.end\]\)/);
  assert.ok(map.indexOf('for (const window of highlightedCornerWindows)')<map.indexOf('let unavailableSegments = 0'),'selected outlines are behind dominance colours');
  assert.doesNotMatch(app,/selectedCornerIndex\b/);
});

test('race classification refresh fills missing data without clearing authoritative fields', () => {
  const h=context();
  h.run(`realDrivers=new Map([['ANT',{code:'ANT',number:'12',result:{points:null,gap:null}}],['RUS',{code:'RUS',number:'63',result:{points:18,gap:3}}]]);
    mergeRaceClassification([{driver_number:12,position:1,points:25,gap_to_leader:0},{driver_number:63,position:2,points:null,gap_to_leader:2.345}]);`);
  assert.equal(h.run("realDrivers.get('ANT').result.points"),25);
  assert.equal(h.run("realDrivers.get('RUS').result.points"),18);
  assert.equal(h.run("realDrivers.get('RUS').result.gap"),2.345);
  assert.match(app,/session_result\?session_key=/);
  assert.match(app,/clearTimeout\(raceResultRefreshTimer\)/);
});

test('speed annotation labels avoid open trace segments without closing the lap', () => {
  const h=context();
  h.sandbox.box={x:45,y:45,width:10,height:10};
  h.sandbox.points=[{x:0,y:0},{x:0,y:100},{x:100,y:100}];
  assert.equal(h.run('trackIntersectsLabel(box,points,0,false)'),false);
  assert.equal(h.run('trackIntersectsLabel(box,points,0,true)'),true);
  assert.match(app,/trackIntersectsLabel\(box, trace\.points, 1, false\)/);
  assert.match(app,/const identity = lap => lap\.code/);
});

test('performance categories expose only defensible alternative summaries', () => {
  const source=readFileSync('car-performance.js','utf8'),offered=performanceSource();
  for(const key of ['pace-stat','trend-view'])
    assert.ok(offersControl(offered,key),key);
  for(const key of ['telemetry-stat','tyre-stat','tyre-fit','race-pace-model','corner-window','straight-entry','acceleration-comparison'])
    assert.ok(!offersControl(offered,key),key);
  const resultsView=readFileSync('src/views/ResultsView.tsx','utf8');
  assert.match(resultsView,/name="results-chart"/);
  assert.match(resultsView,/\['mechanicalRate', 'Mechanical retirements'\]/);
  assert.match(source,/pitChartMetric==='p90'/);
  assert.match(source,/timed\.length>=10\?percentile\(timed,\.9\):null/);
  assert.match(source,/gpSlopes\.length<4\|\|p75Shortfall\.length/);
});

test('pre-rendered session summaries use the cache identity and the source revision', async () => {
  const h = context();
  const url = 'https://example.test/api/session?year=2026&gp=Singapore+Grand+Prix&round=17&session=Qualifying&data_schema=v9';
  assert.equal(h.run(`prerenderedKey(new URL(${JSON.stringify(url)}))`), '/api/session?gp=Singapore+Grand+Prix&round=17&session=Qualifying&year=2026');
  const index = {revision: 'backend-1', sourceRevision: 'source-1', entries: {'/api/session?gp=Singapore+Grand+Prix&round=17&session=Qualifying&year=2026': 'a.json.gz'}};
  const fetched = [];
  Object.assign(h.sandbox, {DecompressionStream: class {}, fetch: async path => { fetched.push(path); return path.endsWith('index.json') ? {ok: true, json: async () => index} : {ok: false}; }});
  Object.assign(h.sandbox.window, {APEX_BACKEND_VERSION: 'backend-1', APEX_SOURCE_VERSION: 'source-2'});
  assert.equal(await h.run(`prerenderedData(new URL(${JSON.stringify(url)}))`), null, 'a different source revision is never served');
  assert.ok(!fetched.some(path => path.endsWith('a.json.gz')));
  h.sandbox.window.APEX_SOURCE_VERSION = 'source-1';
  await h.run(`prerenderedData(new URL(${JSON.stringify(url)}))`);
  assert.ok(fetched.some(path => path.endsWith('a.json.gz')), 'a matching source revision reads the file');
});
