import {appSource} from './app-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {refineCornerPositions} from '../corner-geometry.js';
import {measureRaceCornerGroup} from '../race-cornering.js';
const total=4000;
function path(centres=[2000]){
  let x=0,y=0,heading=0;
  return Array.from({length:801},(_,i)=>{const d=i*5;
    heading+=centres.reduce((sum,c)=>sum+.012*Math.exp(-(((d-c)/35)**2)),0)*5;
    x+=Math.cos(heading)*5;y+=Math.sin(heading)*5;
    return {Distance:d,X:x,Y:y,Speed:180,ElapsedSeconds:i*.125};});
}
test('GPS bend centre corrects a displaced marker without following a speed trough',()=>{
  const samples=path(),markers=[{label:'1',fraction:.25},{label:'2',fraction:2070/total},{label:'3',fraction:.75}];
  const before=JSON.stringify(samples),result=refineCornerPositions(samples,markers,total);
  assert.equal(result[1].apexConfidence,'estimated');
  assert.ok(Math.abs(result[1].apexFraction*total-2000)<15);
  assert.ok(result[1].apexShiftMetres<-50);
  const changed=samples.map(p=>({...p,Speed:p.Distance<1900?60:300}));
  assert.deepEqual(refineCornerPositions(changed,markers,total),result);
  assert.equal(JSON.stringify(samples),before);
  assert.equal(result[0].apexConfidence,'uncertain','a straight is not fabricated into an apex');
});
test('nearby turns remain in separate named envelopes',()=>{
  const markers=[{label:'1',fraction:1900/total},{label:'2',fraction:2100/total}];
  const result=refineCornerPositions(path([1900,2100]),markers,total);
  assert.ok(result.every(m=>m.apexConfidence==='estimated'));
  assert.ok(result[0].apexFraction<.5&&result[1].apexFraction>.5);
  assert.ok(result.every((m,i)=>Math.abs(m.apexFraction*total-markers[i].fraction*total)<20));
});
test('missing GPS and source gaps retain explicitly uncertain map positions',()=>{
  const markers=[{label:'1',fraction:.5}];
  for(const samples of [path().filter(p=>Math.abs(p.Distance-2000)>100),path().map(p=>({...p,SourceIntervalSeconds:2})),[]]){
    const result=refineCornerPositions(samples,markers,total);
    assert.equal(result[0].apexFraction,.5);assert.equal(result[0].apexConfidence,'uncertain');
    assert.ok(result[0].apexReason);
  }
});
test('session alignment uses the same geometry in the registered spatial frame',()=>{
  const samples=path(),markers=[{label:'1',fraction:2070/total}];
  const original=refineCornerPositions(samples,markers,total)[0];
  const shift=.01,result=refineCornerPositions(samples,[{...markers[0],fraction:markers[0].fraction+shift}],total,p=>p.Distance/total+shift)[0];
  assert.ok(Math.abs(result.apexFraction-original.apexFraction-shift)<1e-9);
});
test('session, race and qualifying share the geometry module and disclose fallbacks',()=>{
  const html=readFileSync('index.html','utf8'),app=appSource(),race=readFileSync('race-cornering.js','utf8');
  assert.ok(html.indexOf('src="corner-position.js')<html.indexOf('src="session-state.js'));
  assert.match(readFileSync('corner-geometry.js','utf8'),/import '\.\/corner-position\.js'/);
  assert.match(readFileSync('alignment.js','utf8'),/APEXCornerPosition\?\.refineCornerPositions/);
  assert.match(race,/refineCornerPositions\(ref\.payload\.samples/);
  assert.match(race,/refineCornerPositions\(geometryRef\.payload\.samples/);
  // Speed labels use each lap's own measured extremes, matched across laps by GPS.
  assert.match(app,/matched to the other laps by GPS position/);
  assert.match(readFileSync('scripts/sync-static.mjs','utf8'),/corner-position\.js/);
});
test('race bend speeds use the registered named-corner frame, not raw GPS fractions',()=>{
  const corners=[.25,.5,.75].map((fraction,i)=>({number:String(i+1),fraction}));
  const samples=path([1000,2000,3000]).map(p=>({...p,Speed:Math.abs(p.Distance-2000)<25?150:250}));
  const entries=['A','B','C'].map(code=>({row:{time:100,s1:33,s2:33,s3:34,lap:10,compound:'HARD',tyre_life:8,driver:{code,team:code}},payload:{samples,corners}}));
  const fallback=corners.map(c=>({...c,label:c.number,fraction:c.fraction+.01}));
  const result=measureRaceCornerGroup(entries,fallback);
  assert.equal(result.length,3);
  assert.ok(result.every(row=>row.cornerBands.find(c=>c.corner==='2').band==='medium'));
});
