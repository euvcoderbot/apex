import test from 'node:test';
import assert from 'node:assert/strict';
import {qualifyingRepresentatives,circuitCornerMarkers,withCornerMeasurements} from '../corner-geometry.js';
import {measureQualifyingCornerGroup,raceCornerGroups} from '../race-cornering.js';
import {readFileSync,existsSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';

test('driver qualifying uses own fastest legal lap; team uses one driver only',()=>{
  const lap=(n,time,extra={})=>({lap:n,time,phase:'Q3',compound:'SOFT',lap_start_seconds:100,lap_end_seconds:100+time,...extra});
  const session={drivers:[{code:'AAA',team:'A',laps:[lap(1,90),lap(2,89,{deleted:true}),lap(3,80,{out_lap:true})]},
    {code:'BBB',team:'A',laps:[lap(1,91),lap(2,90.5)]},{code:'CCC',team:'B',laps:[lap(1,92)]}]};
  assert.deepEqual(qualifyingRepresentatives(session).map(r=>[r.driver.code,r.time]),[['AAA',90],['BBB',90.5],['CCC',92]]);
  assert.deepEqual(qualifyingRepresentatives(session,'team').map(r=>r.driver.code),['AAA','CCC']);
});
test('real Sepang replay retains T5 and T6 despite full throttle',t=>{
  const root='../outputs/braking-investigation-20261006/';
  if(!existsSync(root+'native-2026-Bahrain-Grand-Prix.json.gz'))return t.skip('Optional native audit fixture is not present in this checkout.');
  const meta=JSON.parse(readFileSync(root+'2026-Bahrain-Grand-Prix.json'));
  const native=JSON.parse(gunzipSync(readFileSync(root+'native-2026-Bahrain-Grand-Prix.json.gz')));
  const entries=meta.Q.teams.flatMap(team=>{
    const s=meta.windows.find(s=>s.driver===team.lap.driver&&s.lap===team.lap.lap);
    const samples=native.find(n=>n[0]===s?.team)?.[1];
    return samples?.length?[{row:{...team.lap,s1:team.lap.sectors[0],s2:team.lap.sectors[1],s3:team.lap.sectors[2],
      driver:{code:team.lap.driver,team:team.team}},payload:{samples}}]:[];
  });
  const result=measureQualifyingCornerGroup(entries,{circuit_key:12});
  assert.equal(result.markers.length,15);
  for(const number of ['5','6']) {
    const corner=result.markers.find(c=>c.corner===number);assert.equal(corner.band,'high',`T${number} ${corner.speed}`);
    assert.ok(corner.speed>200);
    assert.ok(Object.values(result.traces).some(t=>t.corners.some(c=>c.corner===number)));
  }
  console.log('Sepang audit',JSON.stringify(result.markers.map(c=>[c.corner,c.band,Number(c.speed.toFixed(1))])));
});
test('circuit identity wins over Bahrain label; malformed geometry is not filled in',()=>{
  const samples=Array.from({length:100},(_,i)=>({Distance:i*50,X:i*10,Y:Math.sin(i/10)*100}));
  assert.equal(circuitCornerMarkers({samples},{circuit_key:63,location:'Kuala Lumpur'}).length,0);
  assert.equal(circuitCornerMarkers({samples:[]},{circuit_key:12}).length,0);
});
test('race driver groups retain both teammates as independent observations',()=>{
  const session={drivers:['AAA','BBB','CCC','DDD'].map((code,i)=>({code,team:i<2?'A':i===2?'B':'C',laps:[
    {lap:10,time:90+i,compound:'HARD',tyre_life:8,stint:1,track_status:'1',lap_start_seconds:800,lap_end_seconds:900+i*3}]}))};
  assert.equal(raceCornerGroups(session,{},4,'team')[0].rows.length,3);
  assert.equal(raceCornerGroups(session,{},4,'driver')[0].rows.length,4);
});
test('loading driver braking preserves native corners without replacing source laps',()=>{
  const corner={AAA:{corners:[{corner:'6',band:'high'}],corner_selection:{lap:9},corner_contribution:.1}};
  const batch={AAA:{selection:{lap:9},braking_observations:[{duration_s:1.2}]}};
  const merged=withCornerMeasurements(batch,corner);
  assert.equal(merged.AAA.corners[0].corner,'6');
  assert.equal(merged.AAA.selection.lap,9);
  assert.equal(merged.AAA.braking_observations[0].duration_s,1.2);
  assert.equal(batch.AAA.corners,undefined);
});
test('Madrid map fallback is distinct from stale Barcelona corners',()=>{
  const samples=Array.from({length:100},(_,i)=>({Distance:i*55,X:i*10,Y:Math.sin(i/10)*100}));
  const result=circuitCornerMarkers({samples,corners:[{number:1,fraction:.1}]},{year:2026,event:'Spanish Grand Prix'});
  assert.equal(new Set(result.map(c=>c.number)).size,22);
  assert.ok(result.every(c=>c.approximate));
});
