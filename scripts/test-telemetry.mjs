import {appSource} from './app-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import '../telemetry-model.js';

const { build, evaluate } = globalThis.TelemetryReconstruction;
const near = (a, b, tolerance = 1e-7) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
function series(speeds, controls = {}) {
  return speeds.map((Speed, i) => ({ Speed, ElapsedSeconds: i * .24,
    AlignedFraction: i / (speeds.length - 1), Distance: i * 20,
    Throttle: 100, Brake: 0, nGear: 7, RPM: null, ...controls }));
}

test('trusted samples, peaks, troughs and boundaries stay exact; source is immutable', () => {
  const data = series([210, 220, 225, 223, 210, 160, 115, 105, 106, 120, 160]);
  data.forEach((p, i) => { p.Throttle = i > 3 && i < 9 ? 0 : 100; p.Brake = i > 3 && i < 8 ? 100 : 0; });
  const before = JSON.stringify(data), m = build(data);
  assert.equal(JSON.stringify(data), before);
  assert.equal(m.diagnostics.repairedSamples, 0);
  for (const p of data) near(evaluate(m, p.AlignedFraction), p.Speed);
  for (let i = 1; i < data.length; i++) for (let j = 0; j <= 20; j++) {
    const p = data[i - 1], q = data[i], v = evaluate(m, p.AlignedFraction + (q.AlignedFraction - p.AlignedFraction) * j / 20);
    assert.ok(v >= Math.min(p.Speed, q.Speed) - 1e-8 && v <= Math.max(p.Speed, q.Speed) + 1e-8);
  }
});

test('short corroborated frozen speed is repaired in power and braking phases', () => {
  for (const braking of [false, true]) {
    const speeds = [220, 226, 232, 238, 238, 238, 256, 262, 268];
    const data = series(braking ? speeds.map(v => 400 - v) : speeds,
      braking ? { Throttle: 0, Brake: 100 } : {});
    const m = build(data);
    assert.equal(m.diagnostics.repairedSamples, 3);
    near(evaluate(m, data[4].AlignedFraction), braking ? 156 : 244, .01);
    assert.ok(m.gaps.some(g => g.kind === 'sample-hold'));
  }
});

test('limiter shelves, tiny integer repeats, gear changes and partial inputs survive', () => {
  const cases = [series([290, 293, 297, 297, 297, 297, 297, 297, 297, 299, 300]),
    series([296, 297, 297, 298, 299]),
    series([220, 226, 232, 238, 238, 238, 256, 262, 268], { RPM: 11500 }),
    series([220, 226, 232, 238, 238, 238, 256, 262, 268], { Throttle: 60 })];
  const shift = series([220, 226, 232, 238, 238, 238, 256, 262, 268]);
  shift.forEach((p, i) => { p.nGear = i < 4 ? 6 : 7; }); cases.push(shift);
  for (const data of cases) {
    const m = build(data); assert.equal(m.diagnostics.repairedSamples, 0);
    data.forEach(p => near(evaluate(m, p.AlignedFraction), p.Speed));
  }
});

test('an isolated impossible spike is repaired but a real braking trough is preserved', () => {
  const data = series([220, 226, 232, 390, 244, 250, 256]);
  const m = build(data);
  assert.equal(m.diagnostics.repairedSamples, 1);
  near(evaluate(m, data[3].AlignedFraction), 238, .01);
  const real = series([230, 200, 165, 135, 145, 160, 180], { Throttle: 0, Brake: 100 });
  assert.equal(build(real).diagnostics.repairedSamples, 0);
});

test('missing samples follow neighbouring acceleration with continuous joins', () => {
  const truth = t => 210 + 30 * (1 - Math.exp(-t));
  const data = series(Array.from({ length: 25 }, (_, i) => truth(i * .24)));
  const missing = data.filter((_, i) => i < 9 || i > 11);
  const m = build(missing);
  assert.ok(m.gaps.some(g => g.kind === 'gap'));
  let error = 0, linearError = 0;
  for (let i = 9; i <= 11; i++) {
    const u = (i - 8) / 4, linear = data[8].Speed + (data[12].Speed - data[8].Speed) * u;
    error += Math.abs(evaluate(m, data[i].AlignedFraction) - data[i].Speed);
    linearError += Math.abs(linear - data[i].Speed);
  }
  assert.ok(error < linearError, `Hermite ${error}, linear ${linearError}`);
  for (const i of [8, 12]) {
    const x = data[i].AlignedFraction, e = 1e-6;
    const dl = (evaluate(m, x) - evaluate(m, x - e)) / e;
    const dr = (evaluate(m, x + e) - evaluate(m, x)) / e;
    assert.ok(Math.abs(dl - dr) < .1, `discontinuous slope ${dl}, ${dr}`);
  }
});

test('null/bad channels and long gaps stay explicit, throttle is never snapped', () => {
  const data = series([200, 205, null, NaN, 220, 225, 230, 235]);
  const m = build(data);
  assert.ok(m.gaps.length); assert.ok(evaluate(m, data[3].AlignedFraction) > 205);
  const long = series([200, 210, 215, 220]); long[2].ElapsedSeconds = 5; long[3].ElapsedSeconds = 5.24;
  assert.ok(build(long).gaps.some(g => g.confidence === 'low'));
  const throttle = series([200, 210, 220, 230, 240, 230, 220]);
  [0, 2, 51, 98, 100, 100, 0].forEach((v, i) => { throttle[i].Throttle = v; });
  const tm = build(throttle, 'Throttle');
  throttle.forEach(p => near(evaluate(tm, p.AlignedFraction), p.Throttle));
  for (let i = 0; i <= 1000; i++) assert.ok(evaluate(tm, i / 1000) >= 0 && evaluate(tm, i / 1000) <= 100);
});

function appHarness() {
  const elements = new Map();
  const textCalls = [];
  const ctx = new Proxy({}, { get: (_, key) => key === 'measureText' ? text => ({ width: text.length * 6 })
    : key === 'fillText' ? text => textCalls.push(text)
    : key === 'createLinearGradient' ? () => ({ addColorStop() {} }) : (...args) => {
      if (['moveTo', 'lineTo', 'arc', 'fillRect', 'strokeRect', 'bezierCurveTo'].includes(key)) {
        assert.ok(args.every(v => typeof v !== 'number' || Number.isFinite(v)), `${key}: invalid canvas coordinates`);
      }
    }, set: () => true });
  function element(selector) {
    if (!elements.has(selector)) elements.set(selector, { style: {}, dataset: {}, textContent: '', innerHTML: '',
      checked: false, value: selector === '#year' ? '2026' : '', width: 1000, height: 320,
      attributes: {}, setAttribute(k, v) { this.attributes[k] = v; }, getBoundingClientRect: () => ({ width: 1000, height: 320 }),
      getContext: () => ctx, classList: { add() {}, remove() {}, toggle() {} } });
    return elements.get(selector);
  }
  const sandbox = { console, DOMException, URL, URLSearchParams, setTimeout, clearTimeout, TelemetryReconstruction: globalThis.TelemetryReconstruction,
    window: { devicePixelRatio: 1 }, document: { querySelector: element, getElementById: id => element('#' + id),
      createElement: () => ({width:0,height:0,getContext:()=>ctx}),
      addEventListener() {}, querySelectorAll: () => [], documentElement: { dataset: { theme: 'dark' } } } };
  vm.createContext(sandbox);
  vm.runInContext(appSource(), sandbox);
  vm.runInContext(readFileSync(new URL('../alignment.js', import.meta.url), 'utf8'), sandbox);
  // The map is available alongside the traces without changing panes.
  return { sandbox, elements, element, textCalls, run: code => vm.runInContext(code, sandbox) };
}

test('source-gap evidence is display-only, excludes measured endpoints and follows remapping',()=>{
  const h=appHarness();
  h.run(`var packetSeries=Array.from({length:20},(_,i)=>({ElapsedSeconds:i*.24,Distance:i*50,Speed:200+i}));
    packetSeries.slice(10).forEach(p=>p.ElapsedSeconds+=.721);
    var originalPackets=JSON.stringify(packetSeries);var ranges=telemetrySourceGapRanges(packetSeries);`);
  const gaps=h.run('ranges');assert.equal(gaps.length,1);near(gaps[0].interval,.961);
  h.sandbox.mid=(gaps[0].start+gaps[0].end)/2;
  assert.equal(h.run('telemetrySourceGapAt(packetSeries,mid).interval'),gaps[0].interval);
  assert.equal(h.run('telemetrySourceGapAt(packetSeries,ranges[0].start)'),null);
  assert.equal(h.run('telemetrySourceGapAt(packetSeries,ranges[0].end)'),null);
  assert.equal(h.run('JSON.stringify(packetSeries)'),h.run('originalPackets'));
  assert.equal(h.run('telemetrySourceGapRanges(packetSeries)===ranges'),true);
  h.run(`packetSeries.forEach((p,i)=>p.AlignedFraction=(i/19)**1.1);packetSeries.alignmentInputs={};`);
  assert.notEqual(h.run('telemetrySourceGapRanges(packetSeries)[0].start'),gaps[0].start);
});

test('delta gap indication includes a hidden reference but never changes the zero baseline',()=>{
  const h=appHarness();
  h.run(`var ref=Array.from({length:20},(_,i)=>({ElapsedSeconds:i*.24+(i>=10?.721:0),Distance:i*50,Speed:200}));
    var other=Array.from({length:20},(_,i)=>({ElapsedSeconds:i*.24,Distance:i*50,Speed:200}));`);
  assert.equal(h.run("telemetryTraceGapRanges(other,ref,'Timing delta',1).length"),1);
  assert.equal(h.run("telemetryTraceGapRanges(other,ref,'Speed trace',1).length"),0);
  assert.equal(h.run("telemetryTraceGapRanges(ref,ref,'Timing delta',0).length"),0);
  assert.equal(h.run("telemetryTraceGapRanges(ref,ref,'Brake application',0).length"),0);
});

test('COTA source-gap markings preserve all telemetry and delta values',()=>{
  const h=appHarness();
  h.sandbox.fixture=JSON.parse(gunzipSync(readFileSync('scripts/cota-fp2-evidence.json.gz')));
  h.run(`loaded=fixture.map(e=>e.lap);fixture.forEach(e=>telemetryCache.set(telemetryKey(e.lap),normalizeTelemetry(e.payload.samples,e.lap,e.payload.source)));prepareTelemetryAlignment();
    var ant=telemetryCache.get('ANT:8'),ver=telemetryCache.get('VER:9');
    var beforeDelta=Array.from({length:1001},(_,i)=>displayDeltaAt(ver,ant,i/1000));
    var beforeSamples=JSON.stringify([ant,ver]);var antGaps=telemetrySourceGapRanges(ant);var verGaps=telemetrySourceGapRanges(ver);`);
  const gap=h.run('antGaps.find(g=>Math.abs(g.from-60.052)<.001)');
  assert.ok(gap);near(gap.interval,.961);near(gap.to,61.013);
  assert.equal(h.run('JSON.stringify([ant,ver])===beforeSamples'),true);
  assert.equal(h.run('Array.from({length:1001},(_,i)=>displayDeltaAt(ver,ant,i/1000)).every((v,i)=>v===beforeDelta[i])'),true);
  near(h.run('displayDeltaAt(ver,ant,1)'),.147);
});

test('alignment estimate integrates native time-linear speed, including irregular cadence and clock origin',()=>{
  const h=appHarness();
  h.run(`var lap={time:12,real:{s1:4,s2:4,s3:4}};
    var data=Array.from({length:49},(_,i)=>({ElapsedSeconds:i*.25,Speed:144+3.6*i*.25,Distance:i*10}));
    var before=JSON.stringify(data);var estimate=estimatedSectorDistance(data,lap,[.3,.65]);`);
  assert.equal(h.run('estimate.used'),true);
  // v(t)=40+t m/s, exact integral 40t+t²/2. Sector lengths 168,184,200m.
  assert.deepEqual(Array.from(h.run('estimate.sectorDistances')), [168,184,200]);
  near(h.run('estimate.fractions[16]'),.3);near(h.run('estimate.fractions[32]'),.65);
  near(h.run('estimate.fractions[8]'),82/168*.3);
  assert.equal(h.run('JSON.stringify(data)===before'),true);
  h.run(`data.forEach(p=>p.ElapsedSeconds-=.25);setTelemetryMeta(data,'timeOrigin',.25);
    var offsetEstimate=estimatedSectorDistance(data,lap,[.3,.65]);`);
  assert.deepEqual(Array.from(h.run('offsetEstimate.fractions')),Array.from(h.run('estimate.fractions')));
});

test('alignment estimate rejects unsupported laps instead of forcing corrections',()=>{
  const h=appHarness();
  h.run(`var lap={time:12,real:{s1:4,s2:4,s3:4}};
    var make=()=>Array.from({length:49},(_,i)=>({ElapsedSeconds:i*.25,Speed:180,Distance:i*12.5}));
    var cases=[{lap:{...lap,real:{...lap.real,out_lap:true}}},
      {lap:{...lap,real:{...lap.real,in_lap:true}}},
      {lap:{time:12,real:{s1:4}}}, {lap:{time:12,real:{s1:6,s2:6}}},
      {edit:s=>s[20].Speed=null},{edit:s=>s[20].ElapsedSeconds=s[19].ElapsedSeconds},
      {edit:s=>s.splice(15,7)},{edit:s=>s.splice(0,4)},
      {edit:s=>s.forEach(p=>p.Speed=0)},{edit:s=>s[20].Speed=900}];`);
  assert.equal(h.run('cases.every(c=>{const s=make();c.edit?.(s);return !estimatedSectorDistance(s,c.lap||lap,[.3,.65]).used})'),true);
  assert.equal(h.run('estimatedSectorDistance(make(),lap,[]).used'),false);
  assert.equal(h.run('estimatedSectorDistance(make(),lap,[.7,.3]).used'),false);
});

test('COTA estimate is opt-in, native channels remain immutable, OFF restores the exact original mapping/delta', async()=>{
  const h=appHarness();
  h.sandbox.fixture=JSON.parse(gunzipSync(readFileSync('scripts/cota-fp2-evidence.json.gz')));
  h.run(`loaded=fixture.map(e=>e.lap);fixture.forEach(e=>telemetryCache.set(telemetryKey(e.lap),normalizeTelemetry(e.payload.samples,e.lap,e.payload.source)));
    prepareTelemetryAlignment();var ant=telemetryCache.get('ANT:8'),ver=telemetryCache.get('VER:9');
    var capture=()=>({fractions:[ant,ver].map(s=>s.map(p=>p.AlignedFraction)),delta:Array.from({length:1001},(_,i)=>displayDeltaAt(ver,ant,i/1000))});
    var baseline=capture();var native=JSON.stringify([ant,ver].map(s=>s.map(({AlignedFraction,...p})=>p)));`);
  assert.equal(h.run('alignmentCorrectionEnabled()'),false);
  // Golden from the untouched pre-checkbox production algorithm, not a
  // comparison of two executions of the modified implementation.
  const digest=createHash('sha256').update(JSON.stringify(h.run('baseline'))).digest('hex');
  assert.equal(digest,'bddf9efc7614133527d4281332c705f8d57bc2f12728e9cf7617ad98e3155cd9');
  h.run("mapView='comparison';paintReadyTelemetry();var originalGeometry=dominanceMapGeometryCache;var originalMap=JSON.stringify(originalGeometry.canvasGeometry)");
  h.run('estimateAlignmentCorrection=true;prepareTelemetryAlignment()');
  assert.equal(h.run("[ant,ver].every(s=>s.alignmentMethod==='speed-time+sectors-estimated')"),true);
  assert.equal(h.run('JSON.stringify([ant,ver].map(s=>s.map(({AlignedFraction,...p})=>p)))===native'),true);
  assert.equal(h.run('JSON.stringify(capture().fractions)!==JSON.stringify(baseline.fractions)'),true);
  assert.equal(h.run('[ant,ver].every(s=>s.every((p,i)=>Number.isFinite(p.AlignedFraction)&&(!i||p.AlignedFraction>=s[i-1].AlignedFraction)))'),true);
  for(const mode of ['accurate','enhanced']) {
    h.sandbox.mode=mode;
    const gaps=Array.from(h.run('[0,...ant.alignmentSectors,1].map(f=>displayDeltaAt(ver,ant,f,mode))'));
    [0,-.141,.330,.147].forEach((v,i)=>near(gaps[i],v));
  }
  // The whole UI uses the same mapping, not a separate smoothed delta plot.
  await h.run('paintReadyTelemetry()');
  assert.equal(h.element('#alignmentCorrectionNotice').hidden,true,'no note when every lap was corrected');
  assert.equal(h.run('dominanceMapGeometryCache===originalGeometry'),false,'map must not retain the old distance registration');
  h.run('loaded.reverse();prepareTelemetryAlignment()');
  const reversed=Array.from(h.run('[0,...ver.alignmentSectors,1].map(f=>displayDeltaAt(ant,ver,f))'));
  [0,.141,-.330,-.147].forEach((v,i)=>near(reversed[i],v));
  h.run('loaded.reverse();prepareTelemetryAlignment()');
  h.run('estimateAlignmentCorrection=false;prepareTelemetryAlignment()');
  assert.equal(h.run('JSON.stringify(capture())===JSON.stringify(baseline)'),true);
  h.run('paintReadyTelemetry()');
  assert.equal(h.run('JSON.stringify(dominanceMapGeometryCache.canvasGeometry)===originalMap'),true);
  assert.equal(h.element('#alignmentCorrectionNotice').hidden,true);
  // Repeated switches must not accumulate warping or stale interpolators.
  h.run('for(let i=0;i<3;i++){estimateAlignmentCorrection=true;prepareTelemetryAlignment();estimateAlignmentCorrection=false;prepareTelemetryAlignment()}');
  assert.equal(h.run('JSON.stringify(capture())===JSON.stringify(baseline)'),true);
});

test('estimated mapping never matches another driver’s braking pattern; failures retain original mapping',()=>{
  const h=appHarness();
  h.run(`var lap={time:12,real:{s1:4,s2:4,s3:4}};
    var a=Array.from({length:49},(_,i)=>({ElapsedSeconds:i*.25,Speed:i>=20&&i<=24?90:240,Distance:i*12.5}));
    var b=a.map((p,i)=>({...p,Speed:i>=24&&i<=28?90:240}));
    var ea=estimatedSectorDistance(a,lap,[.3,.65]),eb=estimatedSectorDistance(b,lap,[.3,.65]);`);
  assert.ok(h.run('Math.abs(ea.fractions[22]-eb.fractions[26])')>.02,'different braking locations must remain different');
  h.sandbox.fixture=JSON.parse(gunzipSync(readFileSync('scripts/cota-fp2-evidence.json.gz')));
  h.run(`loaded=fixture.map(e=>e.lap);fixture.forEach(e=>telemetryCache.set(telemetryKey(e.lap),normalizeTelemetry(e.payload.samples,e.lap,e.payload.source)));
    loaded[1].real={...loaded[1].real,in_lap:true};prepareTelemetryAlignment();var ver=telemetryCache.get('VER:9');
    var original=ver.map(p=>p.AlignedFraction);estimateAlignmentCorrection=true;prepareTelemetryAlignment();`);
  assert.equal(h.run('ver.alignmentCorrection.used'),false);
  assert.deepEqual(Array.from(h.run('ver.map(p=>p.AlignedFraction)')),Array.from(h.run('original')));
  assert.match(h.element('#alignmentCorrectionNotice').textContent,/Original distance kept: VER L9 \(pit or partial lap\)/);
});

test('session straight classification needs GPS evidence and rejects flat-out bends',()=>{
  const h=appHarness();
  h.run(`spatialReferenceTelemetry=()=>({samples:[{},{}]});
    alignedValue=(s,f,key)=>key==='X'?f*5000:0;`);
  assert.equal(h.run('sessionStraightEvidence(.2,.4,5000)'),true);
  h.run(`alignedValue=(s,f,key)=>key==='X'?200*Math.cos(f*5000/200):200*Math.sin(f*5000/200)`);
  assert.equal(h.run('sessionStraightEvidence(.2,.4,5000)'),false);
  h.run('alignedValue=()=>null');
  assert.equal(h.run('sessionStraightEvidence(.2,.4,5000)'),false);
});

test('corner lines cover every compared lap’s braking, and the phase split adds up',()=>{
  const h=appHarness();
  h.run(`loaded=[{code:'A',lap:1},{code:'B',lap:1}];referenceDistance=()=>5000;
    const lap=()=>Array.from({length:1001},(_,i)=>({Distance:i*5,Speed:250,Throttle:100,Brake:0,X:i*5,Y:0}));
    telemetryCache.set('A:1',lap());telemetryCache.set('B:1',lap());
    spatialReferenceTelemetry=()=>({samples:telemetryCache.get('A:1')});
    // B brakes from 880 m, A only from 960 m: the early braker sets the line.
    traceTelemetryValue=(s,f,key)=>{const d=f*5000,early=s===telemetryCache.get('B:1');
      if(key==='Brake')return d>=(early?880:960)&&d<1040?1:0;
      if(key==='Throttle')return d>=(early?880:960)&&d<1150?20:100;
      return 250;};
    alignedValue=(s,f,key)=>{const d=f*5000,a=1000,r=100,e=a+r*Math.PI/2;
      if(d<a)return key==='X'?d:0;
      if(d<=e)return key==='X'?a+r*Math.sin((d-a)/r):r*(1-Math.cos((d-a)/r));
      return key==='X'?a+r:r+d-e;};
    performanceSectionDuration=(s,a,b)=>(b-a)*5000/(250/3.6);`);
  const zone=h.run("adaptiveCornerZones([{number:'1',fraction:.215}])[0]");
  assert.ok(zone.start*5000<=872,`start line ${zone.start*5000} m must be before B's braking at 880 m`);
  assert.ok(zone.releaseFraction>zone.start&&zone.releaseFraction<=zone.apex);
  const split=h.run("cornerPhaseBreakdown(telemetryCache.get('B:1'),telemetryCache.get('A:1'),adaptiveCornerZones([{number:'1',fraction:.215}])[0],400)");
  assert.equal(split.entrySaving,0);assert.equal(split.exitCredit,0);
  assert.ok(Math.abs(split.braking+split.mid+split.exit-split.raw)<1e-12);
});

test('flat-out turning envelope uses the bend rather than a fixed-distance window',()=>{
  const h=appHarness();
  h.run(`loaded=[{code:'A',lap:1}];referenceDistance=()=>5000;
    telemetryCache.set('A:1',Array.from({length:1001},(_,i)=>({Distance:i*5,Speed:250,Throttle:100,Brake:0,X:i*5,Y:0})));
    spatialReferenceTelemetry=()=>({samples:telemetryCache.get('A:1')});
    traceTelemetryValue=(s,f,key)=>key==='Speed'?250:key==='Throttle'?100:0;
    alignedValue=(s,f,key)=>{const d=f*5000,a=1000,r=100,e=a+r*Math.PI/2;
      if(d<a)return key==='X'?d:0;
      if(d<=e)return key==='X'?a+r*Math.sin((d-a)/r):r*(1-Math.cos((d-a)/r));
      return key==='X'?a+r:r+d-e;};`);
  const zone=h.run("adaptiveCornerZones([{number:'1',fraction:.215}])[0]");
  assert.match(zone.boundaryMethod,/GPS turn envelope/);
  assert.ok(zone.metres>=120&&zone.metres<=200,`turn envelope is ${zone.metres} m`);
  assert.ok(zone.start*5000>=990&&zone.start*5000<=1020);
  assert.ok(zone.end*5000>=1140&&zone.end*5000<=1180);
  h.sandbox.firstZone=zone;
  assert.equal(h.run("adaptiveCornerZones([{number:'1',fraction:.215}])[0]===firstZone"),true,'unchanged selection uses cached geometry');
  h.run("telemetryCache.get('A:1').positionRevision=1");
  assert.equal(h.run("adaptiveCornerZones([{number:'1',fraction:.215}])[0]===firstZone"),false,'late GPS invalidates corner boundaries');
});

test('whole chart stack and map render; toggling enhanced preserves official delta anchors', async () => {
  const h = appHarness();
  h.run("mapView = 'comparison'");
  h.sandbox.fixture = series(Array.from({ length: 80 }, (_, i) => 210 + 50 * Math.sin(i / 15)));
  h.sandbox.fixture.forEach((p, i) => { p.X = Math.cos(i / 79 * Math.PI * 2) * 1000; p.Y = Math.sin(i / 79 * Math.PI * 2) * 1000; });
  h.run(`loaded = [{code:'NOR',lap:1,time:19,real:{time:19,s1:6,s2:6,s3:7}},
    {code:'VER',lap:2,time:19.5,real:{time:19.5,s1:6.1,s2:6.2,s3:7.2}}];
    drivers = [['NOR',1,'Norris','#ff8000'],['VER',3,'Verstappen','#4781d7']];
    for (const lap of loaded) telemetryCache.set(telemetryKey(lap), normalizeTelemetry(fixture.map(p=>({...p})),lap,'test'));
    prepareTelemetryAlignment();`);
  await h.run('drawAll()');
  assert.match(h.element('#dominanceTitle').innerHTML, /Mini-sector dominance/);
  assert.equal(h.element('#dominanceEmpty').style.display, 'none');
  const values = h.run(`(() => { const s=telemetryCache.get('VER:2'),r=telemetryCache.get('NOR:1');
    return [0,...alignedSectorFractions(r,loaded[0]),1].map(x=>[x,displayDeltaAt(s,r,x)]); })()`);
  const axis = { ...h.element('[data-chart="Timing delta"]').attributes };
  h.element('#interpolationToggle').checked = true;
  await h.run('drawAll()');
  for (const [x, expected] of values) near(h.run(`displayDeltaAt(telemetryCache.get('VER:2'),telemetryCache.get('NOR:1'),${x})`), expected);
  near(h.run("displayDeltaAt(telemetryCache.get('VER:2'),telemetryCache.get('NOR:1'),1)"), .5);
  assert.equal(h.element('[data-chart="Timing delta"]').attributes['data-axis-min'], axis['data-axis-min']);
  assert.equal(h.element('[data-chart="Timing delta"]').attributes['data-axis-max'], axis['data-axis-max']);
  h.run('hoverFraction = .41327');
  h.run('drawRealChart("Speed trace")');
  near(h.run(`renderedTraceValue(sampledEnhancedTrace(telemetryCache.get('VER:2'),'Speed',0,1,640),hoverFraction)`),
    h.run(`traceTelemetryValue(telemetryCache.get('VER:2'),hoverFraction,'Speed')`));
});

test('timing delta vertical scale is neutral at 100% and supports compression and magnification', () => {
  const h = appHarness();
  h.sandbox.fixture = series(Array.from({ length: 80 }, (_, i) => 210 + i / 2));
  h.run(`loaded = [{code:'NOR',lap:1,time:19,real:{time:19,s1:6,s2:6,s3:7}},
    {code:'VER',lap:2,time:19.5,real:{time:19.5,s1:6.1,s2:6.2,s3:7.2}}];
    drivers = [['NOR',1,'Norris','#ff8000'],['VER',3,'Verstappen','#4781d7']];
    for (const lap of loaded) telemetryCache.set(telemetryKey(lap), normalizeTelemetry(fixture.map(p=>({...p})),lap,'test'));
    prepareTelemetryAlignment(); drawRealChart('Timing delta');`);
  const canvas = h.element('[data-chart="Timing delta"]');
  const normalMax = Number(canvas.attributes['data-axis-max']);
  assert.equal(h.run('timingDeltaZoom'), 1);
  // Every 5 percentage-point step must change the actual plotted range.
  // Re-snapping zoomed limits to nice ticks previously swallowed these steps.
  h.run('setTimingDeltaZoom(1.05)');
  near(Number(canvas.attributes['data-axis-max']), normalMax / 1.05);
  assert.equal(h.element('#timingDeltaZoomReadout').textContent, '105%');
  h.run('setTimingDeltaZoom(.95)');
  near(Number(canvas.attributes['data-axis-max']), normalMax / .95);
  assert.equal(h.run('TIMING_DELTA_ZOOM_STEP'), .05);
  h.run('setTimingDeltaZoom(.5)');
  const compressedMax = Number(canvas.attributes['data-axis-max']);
  assert.ok(compressedMax > normalMax, `${compressedMax} should exceed ${normalMax}`);
  assert.equal(h.element('#timingDeltaZoomReadout').textContent, '50%');
  h.run('setTimingDeltaZoom(2)');
  const magnifiedMax = Number(canvas.attributes['data-axis-max']);
  assert.ok(magnifiedMax < normalMax, `${magnifiedMax} should be below ${normalMax}`);
  assert.equal(h.element('#timingDeltaZoomReadout').textContent, '200%');
  h.run('setTimingDeltaZoom(1)');
  assert.equal(Number(canvas.attributes['data-axis-max']), normalMax);
});

test('rendering starts before the slowest lap and unchanged alignment is not recomputed', async () => {
  const h=appHarness();
  h.sandbox.fixture=series(Array.from({length:80},(_,i)=>210+i/2));
  h.sandbox.fixture.forEach((p,i)=>{p.X=Math.cos(i/79*Math.PI*2)*1000;p.Y=Math.sin(i/79*Math.PI*2)*1000;});
  h.run(`loaded=[{code:'NOR',lap:1,time:19,real:{time:19,s1:6,s2:6,s3:7}},
    {code:'VER',lap:2,time:19.5,real:{time:19.5,s1:6.1,s2:6.2,s3:7.2}}];
    drivers=[['NOR',1,'Norris','#ff8000'],['VER',3,'Verstappen','#4781d7']];
    mapView='comparison'; var finishSlow;
    fetchTelemetry=async lap=>{if(lap.code==='VER')await new Promise(resolve=>finishSlow=resolve);
      const samples=normalizeTelemetry(fixture.map(p=>({...p})),lap,'test');telemetryCache.set(telemetryKey(lap),samples);return samples;};`);
  const pending=h.run('drawAll()');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.run("telemetryCache.has('VER:2')"),false);
  assert.equal(h.element('#dominanceEmpty').style.display,'none');
  h.run('finishSlow()');
  await pending;
  assert.match(h.element('#dominanceTitle').innerHTML,/Mini-sector dominance/);
  h.run("var existingInputs=telemetryCache.get('NOR:1').alignmentInputs; prepareTelemetryAlignment()");
  assert.equal(h.run("existingInputs===telemetryCache.get('NOR:1').alignmentInputs"),true);
});

test('slow first lap, partial map, late geometry and a session switch remain independent', async () => {
  for (const switchSession of [false,true]) {
    const h=appHarness();
    const full=Array.from({length:361},(_,i)=>({ElapsedSeconds:i/4,Timestamp:1800000000+i/4,Distance:i*15,Speed:200+i/100,
      Throttle:100,Brake:0,nGear:6,DRS:null,X:i*10,Y:Math.sin(i/20)*1000}));
    const partial=full.map((p,i)=>({...p,...(i>=90&&i<230?{X:null,Y:null}:{})}));
    const late=full.slice(1); // first geometry packet is t=.25, not t=0
    let finishFirst, finishGeometry;
    const requested=[];
    const response=payload=>({ok:true,text:async()=>JSON.stringify(payload)});
    h.sandbox.fetchSessionData=async url=>{
      const query=new URL(url,'https://test.example').searchParams;
      requested.push(query);
      if(query.get('geometry')==='true')return new Promise(resolve=>finishGeometry=()=>resolve(response({samples:late,position_complete:true,source:'FastF1'})));
      if(query.get('driver')==='NOR')return new Promise(resolve=>finishFirst=()=>resolve(response({samples:full,position_complete:true,source:'OpenF1'})));
      // Even an older backend's permissive flag must not suppress recovery.
      return response({samples:partial,position_complete:true,source:'OpenF1'});
    };
    h.run(`currentQuery=()=>new URLSearchParams('year=2026'); sessionRequest={signal:undefined};
      loaded=[{code:'NOR',lap:1,time:90,real:{time:90,s1:30,s2:30,s3:30}},
        {code:'VER',lap:2,time:90,real:{time:90,s1:30,s2:30,s3:30}}];
      drivers=[['NOR',1,'Norris','#ff8000'],['VER',3,'Verstappen','#4781d7']];
      mapView='comparison'; var paints=0, originalPaint=paintReadyTelemetry;
      paintReadyTelemetry=()=>{paints++;originalPaint();};`);
    const pending=h.run('drawAll()');
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(h.run("telemetryCache.has('NOR:1')"),false);
    assert.ok(h.run('paints')>0,'ready second lap paints before first');
    assert.ok(h.textCalls.includes('Waiting for reference lap…'));
    assert.ok(h.element('[data-chart="Speed trace"]').attributes['data-axis-max']);
    assert.ok(requested.some(q=>q.get('geometry')==='true'));
    assert.equal(h.run('spatialReferenceTelemetry()'),null,'incomplete geometry not rendered as complete');
    const before=h.run("JSON.stringify(telemetryCache.get('VER:2').map(({X,Y,...p})=>p))");
    if(switchSession) {
      h.run("clearBeforeSessionLoad();sessionRequest={signal:undefined};var paintsBefore=paints");
      finishGeometry();finishFirst();await pending;
      await new Promise(resolve=>setImmediate(resolve));
      assert.equal(h.run('telemetryCache.size'),0);
      assert.equal(h.run('sessionSectorGuide'),null);
      assert.equal(h.run('paints'),h.run('paintsBefore'));
    } else {
      finishGeometry();await new Promise(resolve=>setImmediate(resolve));
      assert.equal(h.run("telemetryCache.get('VER:2')[100].X"),1000,'geometry remains on its original clock');
      assert.equal(h.run("JSON.stringify(telemetryCache.get('VER:2').map(({X,Y,...p})=>p))"),before);
      assert.equal(h.element('#dominanceEmpty').style.display,'none');
      assert.ok(h.run('loaded[1].sectorGuide'),'enriched second lap retains its own guide');
      assert.equal(h.run('sessionSectorGuide'),null,'never label the pending reference with another lap’s DRS');
      finishFirst();await pending;
      assert.equal(h.run('sessionSectorGuide===loaded[0].sectorGuide'),true);
      h.run('loaded.reverse();paintReadyTelemetry()');
      assert.equal(h.run('sessionSectorGuide===loaded[0].sectorGuide'),true,'reference changes update the guide');
      assert.match(h.element('#dominanceTitle').innerHTML,/Mini-sector dominance/);
    }
  }
});

test('late geometry uses UTC and leaves existing track coordinates untouched', () => {
  const h=appHarness();
  h.run(`var original=Array.from({length:80},(_,i)=>({ElapsedSeconds:i*.25,Timestamp:1800000000+i*.25,
    X:i>=25&&i<45?null:i*100,Y:i>=25&&i<45?null:Math.sin(i/10)*200}));
    var geometry=original.map((p,i)=>({...p,ElapsedSeconds:p.ElapsedSeconds+1.2,
      X:i*100,Y:Math.sin(i/10)*200}));
    var incompatible=geometry.map(p=>({...p,X:p.X+1200}));`);
  assert.equal(h.run('enrichTelemetryPositions(original,incompatible)'),0);
  assert.equal(h.run('original[30].X'),null);
  assert.equal(h.run('enrichTelemetryPositions(original,geometry)'),20);
  assert.equal(h.run('original[30].X'),3000);
  assert.equal(h.run('original[24].X'),2400);
  assert.equal(h.run('original[30].ElapsedSeconds'),7.5);
});

test('active telemetry loader sends existing lap context and creates the sector guide', async () => {
  const h=appHarness();
  let requested;
  const samples=Array.from({length:361},(_,i)=>({ElapsedSeconds:i/4,Distance:i*15,Speed:200,
    Throttle:100,Brake:0,nGear:6,DRS:null,X:Math.cos(i/360*Math.PI*2)*1000,Y:Math.sin(i/360*Math.PI*2)*1000}));
  h.sandbox.fetchSessionData=async url=>{
    requested=new URL(url,'https://test.example');
    return {ok:true,text:async()=>JSON.stringify({samples,source:'OpenF1',position_complete:true,corners:[]})};
  };
  h.run(`currentQuery=()=>new URLSearchParams('year=2026'); openf1SessionKey=11365;
    var lap={code:'VER',lap:17,time:90,real:{time:90,s1:30,s2:30,s3:30,date_start:'2026-09-12T14:10:00Z',lap_start_seconds:3600,lap_end_seconds:3690}};
    realDrivers.set('VER',{number:'3',laps:[lap.real]});`);
  await h.run('fetchTelemetry(lap)');
  assert.equal(requested.searchParams.get('fresh'),null,'normal lap loads reuse the versioned cache');
  assert.equal(requested.searchParams.get('session_key'),'11365');
  assert.equal(requested.searchParams.get('driver_number'),'3');
  assert.equal(requested.searchParams.get('lap_start'),'2026-09-12T14:10:00Z');
  assert.equal(requested.searchParams.get('lap_start_seconds'),'3600');
  assert.equal(requested.searchParams.get('lap_end_seconds'),'3690');
  assert.equal(requested.searchParams.get('lap_time'),'90');
  assert.equal(h.run('lap.sectorGuide.segmentSectors.length'),360);
  h.run('var reopened={...lap,sectorGuide:null}');
  await h.run('fetchTelemetry(reopened)');
  assert.equal(h.run('reopened.sectorGuide===lap.sectorGuide'),true,'reopening a cached lap keeps its own DRS guide');
});

test('complete map geometry accepts a bounded provider interval but rejects corruption', () => {
  const h=appHarness();
  h.run(`var bounded=Array.from({length:361},(_,i)=>({ElapsedSeconds:i/4,X:i,Y:i}));
    bounded.splice(100,4); setTelemetryMeta(bounded,'lapDuration',90); setTelemetryMeta(bounded,'timeOrigin',0);
    var damaged=Array.from({length:361},(_,i)=>({ElapsedSeconds:i/4,X:i,Y:i}));
    damaged.splice(100,6); setTelemetryMeta(damaged,'lapDuration',90); setTelemetryMeta(damaged,'timeOrigin',0);
    var baku=Array.from({length:361},(_,i)=>({ElapsedSeconds:i/4+(i>=101?1.03:0),X:i,Y:i}));
    setTelemetryMeta(baku,'lapDuration',91.03); setTelemetryMeta(baku,'timeOrigin',0);`);
  assert.equal(h.run('completePositionGeometry(bounded)'),true);
  assert.equal(h.run('completePositionGeometry(baku)'),true);
  assert.equal(h.run('completePositionGeometry(damaged)'),false);
});

test('duplicate and missing timestamps are safe; missing channel endpoints are not extrapolated', () => {
  const data = series([null, 220, 226, 232, 238, null]);
  data.splice(3, 0, { ...data[2], Speed: 226 });
  data.splice(2, 0, { ...data[1], ElapsedSeconds: null });
  const m = build(data);
  assert.equal(evaluate(m, 0), null);
  assert.equal(evaluate(m, 1), null);
  near(evaluate(m, .4), 226);
});

test('mixed GPS coverage retains the map, single-trace hover and full chart rendering', async () => {
  const h = appHarness();
  h.run("mapView = 'comparison'");
  const files = existsSync('.apex-cache') ? readdirSync('.apex-cache').filter(f => f.startsWith('telemetry-')) : [];
  const payload = files.map(f => JSON.parse(gunzipSync(readFileSync('.apex-cache/' + f))))
    .find(p => p.driver === 'VER' && p.lap === 13 && p.corners?.length === 14);
  const source = payload?.samples || series(Array.from({length:80},(_,i)=>200+30*Math.sin(i/10)))
    .map((p,i)=>({...p,X:1000*Math.cos(i/79*2*Math.PI),Y:1000*Math.sin(i/79*2*Math.PI)}));
  h.sandbox.gps = source;
  h.run(`loaded=[{code:'NOR',lap:20},{code:'VER',lap:13}];
    drivers=[['NOR',1,'Norris','#ff8000'],['VER',3,'Verstappen','#4781d7']];
    for (const lap of loaded) {
      const data=gps.map(p=>({...p,...(lap.code==='NOR'?{X:null,Y:null}: {})}));
      const time=data[data.length-1].ElapsedSeconds;
      lap.time=time;lap.real={time,s1:time/3,s2:time/3,s3:time/3};
      telemetryCache.set(telemetryKey(lap),normalizeTelemetry(data,lap,'test'));
    }`);
  h.element('#interpolationToggle').checked=true;
  await h.run('drawAll()');
  assert.equal(h.element('#dominanceEmpty').style.display,'none');
  h.run('hoverFraction=.6; renderMiniSectorMap()');
});

test('Sepang FP3 rejects inconsistent GPS without snapping driver braking points', () => {
  const h=appHarness();
  h.sandbox.fixture=JSON.parse(gunzipSync(readFileSync('scripts/sepang-fp3-alignment.json.gz')));
  h.run(`loaded=fixture.map(e=>e.lap);
    fixture.forEach(e=>telemetryCache.set(telemetryKey(e.lap),normalizeTelemetry(e.payload.samples,e.lap,e.payload.source)));
    prepareTelemetryAlignment();`);
  assert.equal(h.run("telemetryCache.get('ANT:8').positionMotionCheck.accepted"),true);
  assert.equal(h.run("telemetryCache.get('RUS:7').positionMotionCheck.accepted"),false);
  assert.equal(h.run("telemetryCache.get('RUS:7').alignmentMethod"),'distance+sectors');
  const gap=h.run(`(()=>{const extrema=loaded.map(l=>{
    const s=telemetryCache.get(telemetryKey(l));
    return s.filter(p=>p.AlignedFraction>.26 && p.AlignedFraction<.3).reduce((a,b)=>b.Speed<a.Speed?b:a);
  });return Math.abs(extrema[0].AlignedFraction-extrema[1].AlignedFraction)*referenceDistance();})()`);
  assert.ok(gap<15,`T4 positional error ${gap} metres`);
  h.run('loaded.reverse(); prepareTelemetryAlignment()');
  assert.equal(h.run("telemetryCache.get('ANT:8').alignmentMethod"),'position-reference');
  assert.equal(h.run("telemetryCache.get('RUS:7').alignmentMethod"),'distance+sectors');
  // Speeds remain native; only the distance axis is corrected.
  for(const entry of h.sandbox.fixture) {
    h.sandbox.entry=entry;
    assert.equal(h.run('telemetryCache.get(telemetryKey(entry.lap)).every((p,i)=>p.Speed===entry.payload.samples[i].Speed)'),true);
  }
});

test('held-out real acceleration/braking samples: reconstruction benchmark', {
  skip: !existsSync('.apex-cache') || !readdirSync('.apex-cache').some(file => file.startsWith('telemetry-')),
}, () => {
  const stats = {count:0, model:0, linear:0, max:0}, clean = {count:0,model:0,linear:0}, details=[], seen=new Set();
  for (const file of readdirSync('.apex-cache').filter(f => f.startsWith('telemetry-'))) {
    const data=JSON.parse(gunzipSync(readFileSync('.apex-cache/'+file))).samples;
    if (!data?.length) continue;
    const fingerprint=JSON.stringify(data);
    if(seen.has(fingerprint))continue;
    seen.add(fingerprint);
    for(let i=5;i<data.length-6;i++) {
      const window=data.slice(i-4,i+6);
      const power=window.every(p=>p.Throttle>=97 && p.Brake===0 && p.nGear===window[0].nGear);
      const brake=window.every(p=>p.Throttle<=5 && p.Brake>0);
      if(!power&&!brake) continue;
      if(window.some((p,j)=>!Number.isFinite(p.Speed)||!Number.isFinite(p.ElapsedSeconds)||j&&p.ElapsedSeconds<=window[j-1].ElapsedSeconds))continue;
      const a=data[i-1],b=data[i+2];
      if(b.ElapsedSeconds-a.ElapsedSeconds>1.3)continue;
      const m=build(window.filter((_,j)=>j!==4&&j!==5));
      if(!m)continue;
      for(const p of [data[i],data[i+1]]) {
        const x=p.AlignedFraction??p.Distance/window.at(-1).Distance;
        const estimate=evaluate(m,x);
        if(!Number.isFinite(estimate))continue;
        const linear=a.Speed+(b.Speed-a.Speed)*(p.ElapsedSeconds-a.ElapsedSeconds)/(b.ElapsedSeconds-a.ElapsedSeconds);
        const error=Math.abs(estimate-p.Speed);
        details.push({driver:file.slice(10,18),time:p.ElapsedSeconds,speeds:window.map(q=>q.Speed),times:window.map(q=>q.ElapsedSeconds),predicted:estimate,truth:p.Speed,linear,error, timeOnly:globalThis.TelemetryReconstruction.evaluateSpline(m.curve,p.ElapsedSeconds),repairs:m.diagnostics.repairedSamples});
        stats.count++;stats.model+=error;stats.linear+=Math.abs(linear-p.Speed);stats.max=Math.max(stats.max,error);
        // Stale repeated values are not independent ground truth. Report
        // them in the all-data metric, not as proof of reconstruction error.
        const changes=window.slice(1).filter((q,j)=>q.Speed!==window[j].Speed).length;
        if(changes>=7 && !build(window)?.diagnostics.repairedSamples) {
          clean.count++;clean.model+=error;clean.linear+=Math.abs(linear-p.Speed);
        }
      }
    }
  }
  assert.ok(stats.count>100);
  if(process.env.BENCH_DEBUG)console.log(details.sort((a,b)=>b.error-a.error).slice(0,12));
  console.log(`Held-out ${stats.count} samples: MAE reconstruction ${(stats.model/stats.count).toFixed(3)} km/h; linear ${(stats.linear/stats.count).toFixed(3)} km/h; worst ${stats.max.toFixed(3)} km/h.`);
  console.log(`Non-stale subset ${clean.count}: MAE reconstruction ${(clean.model/clean.count).toFixed(3)} km/h; linear ${(clean.linear/clean.count).toFixed(3)} km/h.`);
  assert.ok(clean.count>100);
  assert.ok(clean.model < clean.linear, 'Reconstruction should improve held-out independent observations, not just appearance.');
});

test('cached problem laps: finite, bounded, immutable and all trusted values exact', {
  skip: !existsSync('.apex-cache') || !readdirSync('.apex-cache').some(file => file.startsWith('telemetry-')),
}, () => {
  let count = 0, repairs = 0;
  for (const file of readdirSync('.apex-cache').filter(f => f.startsWith('telemetry-') && f.endsWith('.gz'))) {
    const payload = JSON.parse(gunzipSync(readFileSync('.apex-cache/' + file)));
    const data = payload.samples; if (!data?.length) continue;
    const before = JSON.stringify(data), m = build(data); if (!m) continue;
    assert.equal(JSON.stringify(data), before);
    for (const p of m.curve.points) near(evaluate(m, p.x), p.y, 1e-6);
    for (let i = 0; i <= 1500; i++) {
      const v = evaluate(m, i / 1500);
      if (v === null) continue;
      assert.ok(Number.isFinite(v) && v >= 0 && v <= 450, `${file}: ${v}`);
    }
    repairs += m.diagnostics.repairedSamples; count++;
  }
  console.log(`Real-data regression: ${count} laps; ${repairs} samples classified for repair.`);
  assert.ok(count > 0);
});
