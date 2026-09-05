import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import vm from 'node:vm';
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
  const ctx = new Proxy({}, { get: (_, key) => key === 'measureText' ? text => ({ width: text.length * 6 })
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
  const sandbox = { console, URLSearchParams, setTimeout, clearTimeout, TelemetryReconstruction: globalThis.TelemetryReconstruction,
    window: { devicePixelRatio: 1 }, document: { querySelector: element, getElementById: id => element('#' + id),
      addEventListener() {}, querySelectorAll: () => [], documentElement: { dataset: { theme: 'dark' } } } };
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(new URL('../app.js', import.meta.url), 'utf8'), sandbox);
  vm.runInContext(readFileSync(new URL('../alignment.js', import.meta.url), 'utf8'), sandbox);
  return { sandbox, elements, element, run: code => vm.runInContext(code, sandbox) };
}

test('whole chart stack and map render; toggling enhanced preserves official delta anchors', async () => {
  const h = appHarness();
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

test('held-out real acceleration/braking samples: reconstruction benchmark', { skip: !existsSync('.apex-cache') }, () => {
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

test('cached problem laps: finite, bounded, immutable and all trusted values exact', { skip: !existsSync('.apex-cache') }, () => {
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
