// Offline, reproducible invariants on retained real source observations.
// This is NOT an absolute cross-driver position-accuracy measurement.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const readGzip = file => JSON.parse(gunzipSync(readFileSync(file)));
const groups = ['cota-fp2-evidence','sepang-fp3-alignment'].map(name => ({
  name, entries: readGzip(`scripts/${name}.json.gz`),
}));
for (const [name, record] of Object.entries(readGzip('verified-sources.json.gz').sessions)) {
  const entries = (record.telemetry || []).flatMap(item => {
    const code = item.selection.driver;
    const real = record.data.drivers.find(d => d.code === code)?.laps.find(l => l.lap === item.selection.lap);
    return real && item.samples?.length ? [{lap:{code,lap:real.lap,time:real.time,real},
      payload:{samples:item.samples,source:'Retained native source'}}] : [];
  });
  if(entries.length)groups.push({name,entries});
}
const source = readFileSync('alignment.js','utf8');
const report = [];
for (const {name,entries} of groups) {
  const box = {loaded:structuredClone(entries.map(e=>e.lap)),telemetryCache:new Map(),
    telemetryKey:l=>`${l.code}:${l.lap}`,estimateAlignmentCorrection:false,
    $:()=>null,document:{getElementById:()=>null}};
  vm.createContext(box);vm.runInContext(source,box);
  entries.forEach((e,i)=>box.telemetryCache.set(box.telemetryKey(box.loaded[i]),
    box.normalizeTelemetry(structuredClone(e.payload.samples),box.loaded[i],e.payload.source)));
  box.prepareTelemetryAlignment();
  const series=box.loaded.map(l=>box.telemetryCache.get(box.telemetryKey(l)));
  const capture=()=>JSON.stringify(series.map(s=>({fractions:s.map(p=>p.AlignedFraction),
    delta:Array.from({length:101},(_,i)=>box.displayDeltaAt(s,series[0],i/100))})));
  const original=capture(), native=JSON.stringify(series.map(s=>s.map(({AlignedFraction,...p})=>p)));
  const cotaWindow=()=>Array.from({length:121},(_,i)=>box.displayDeltaAt(series[1],series[0],(3400+i*5)/box.referenceDistance()));
  const originalWindow=name==='cota-fp2-evidence'?cotaWindow():null;
  box.estimateAlignmentCorrection=true;box.prepareTelemetryAlignment();
  const rows=series.map((s,i)=>{
    const lap=box.loaded[i],m=lap.real;
    assert(s.every((p,j)=>Number.isFinite(p.AlignedFraction)&&(!j||p.AlignedFraction>=s[j-1].AlignedFraction)));
    const anchors=[0,...s.alignmentSectors,1];
    const official=[0,m.s1,m.s1+m.s2,lap.time];
    const errors=anchors.map((f,j)=>box.performanceElapsed(s,f)-official[j]);
    assert(errors.every(e=>Math.abs(e)<1e-7),`${name} ${lap.code} timing anchors: ${errors}`);
    assert(Array.from({length:101},(_,j)=>box.displayDeltaAt(s,series[0],j/100)).every(Number.isFinite));
    return {driver:lap.code,lap:lap.lap,...s.alignmentCorrection,maximumAnchorError:Math.max(...errors.map(Math.abs))};
  });
  assert.equal(JSON.stringify(series.map(s=>s.map(({AlignedFraction,...p})=>p))),native);
  const estimatedWindow=originalWindow?cotaWindow():null;
  box.estimateAlignmentCorrection=false;box.prepareTelemetryAlignment();assert.equal(capture(),original);
  report.push({name,laps:entries.length,eligible:rows.filter(r=>r.used).length,
    maximumAnchorError:Math.max(...rows.map(r=>r.maximumAnchorError)),
    maximumShiftMetres:Math.max(...rows.map(r=>r.maximumShiftMetres||0)),
    rejected:rows.filter(r=>!r.used).map(({driver,lap,reason})=>({driver,lap,reason})),
    ...(originalWindow?{cotaT12Window:{originalMinimum:Math.min(...originalWindow),estimatedMinimum:Math.min(...estimatedWindow)}}:{}),
    ...(process.argv.includes('--details')?{rows}:{})});
}
console.log(JSON.stringify({scope:'Mapping/timing/restoration invariants, not ground-truth local delta validation',
  laps:report.reduce((n,g)=>n+g.laps,0),groups:report},null,2));
