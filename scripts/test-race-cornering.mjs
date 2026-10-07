import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {raceCornerGroups,measureRaceCornerGroup,raceCornerAlignmentIssue,connectedRaceCornerScores} from '../race-cornering.js';
import {circuitCornerMarkers} from '../corner-geometry.js';

const fixture=JSON.parse(gunzipSync(readFileSync(new URL('./race-cornering-sepang-2026.json.gz',import.meta.url))));

test('native race snapshot supports shared corners without mutating telemetry',()=>{
  const before=JSON.stringify(fixture);
  const rows=measureRaceCornerGroup(fixture.entries,fixture.markers);
  assert.ok(rows.length>=3);
  assert.ok(rows.every(r=>r.corners===15 && r.times.every(t=>t>0)));
  for(const band of ['all','low','medium','high']) {
    assert.equal(Math.min(...rows.map(r=>r.values[band])),0);
    assert.ok(rows.every(r=>r.values[band]>=0));
  }
  assert.equal(JSON.stringify(fixture),before);
  assert.deepEqual(measureRaceCornerGroup([...fixture.entries].reverse(),fixture.markers),rows);
});

test('missing circuit markers or broken native timing never create corner scores',()=>{
  assert.deepEqual(measureRaceCornerGroup(fixture.entries),[]);
  const broken=structuredClone(fixture.entries);
  broken.forEach(e=>e.row.s3+=5);
  assert.deepEqual(measureRaceCornerGroup(broken,fixture.markers),[]);
  const sparse=structuredClone(fixture.entries);
  sparse.forEach(e=>e.payload.samples=e.payload.samples.slice(0,20));
  assert.deepEqual(measureRaceCornerGroup(sparse,fixture.markers),[]);
});

test('race groups match race lap, compound and tyre age and exclude neutralised/pit laps',()=>{
  const drivers=['A','B','C','D'].map((code,i)=>({code,team:code,laps:[2,3,4,5].map(lap=>({
    lap,time:90+i,track_status:'1',compound:'MEDIUM',tyre_life:lap+i%2,stint:1,
    lap_start_seconds:lap*100+i*5,lap_end_seconds:lap*100+i*5+90+i
  }))}));
  const groups=raceCornerGroups({drivers});
  assert.ok(groups.length>0);
  assert.ok(groups.every(g=>g.rows.length>=3 && g.rows.every(r=>r.lap===g.lap&&r.compound===g.compound)));
  assert.ok(groups.every(g=>Math.max(...g.rows.map(r=>r.tyre_life))-Math.min(...g.rows.map(r=>r.tyre_life))<=4));
  drivers[0].laps.forEach(l=>l.track_status='4');
  drivers[1].laps.forEach(l=>l.out_lap=true);
  assert.deepEqual(raceCornerGroups({drivers}),[]);
});

test('tyre compounds and disparate ages cannot be pooled to manufacture a cohort',()=>{
  const drivers=['A','B','C'].map((code,i)=>({code,team:code,laps:[{lap:10,time:90,
    track_status:'1',compound:['SOFT','MEDIUM','HARD'][i],tyre_life:2,stint:1,
    lap_start_seconds:1000+i*5,lap_end_seconds:1090+i*5}]}));
  assert.deepEqual(raceCornerGroups({drivers}),[]);
  drivers.forEach((d,i)=>{d.laps[0].compound='MEDIUM';d.laps[0].tyre_life=i*10;});
  assert.deepEqual(raceCornerGroups({drivers}),[]);
});

test('live Bahrain displaced archive cannot turn slower Alpine into the fastest cornering car',()=>{
  const live=JSON.parse(gunzipSync(readFileSync(new URL('./race-cornering-bahrain-2026-live.json.gz',import.meta.url))));
  const markers=circuitCornerMarkers(live.entries.find(e=>e.row.driver.code==='RUS').payload,live.session);
  assert.match(raceCornerAlignmentIssue(live.entries.find(e=>e.row.driver.code==='PER'),markers,live.session),/displaced/);
  const rows=measureRaceCornerGroup(live.entries,markers,live.session);
  assert.equal(rows.length,3);
  assert.equal(rows.find(r=>r.driver==='RUS').values.all,0);
  assert.ok(rows.find(r=>r.driver==='COL').values.all>.04&&rows.find(r=>r.driver==='COL').values.all<.15);
  assert.ok(rows.find(r=>r.driver==='BEA').values.all<.2);
  assert.ok(rows.every(r=>r.alignment==='Named circuit-position registration'));
});

test('overlapping race cohorts retain connected entrants, without assigning disjoint teams a shared zero',()=>{
  const obs=(team,snapshot,value)=>({team,driver:team,snapshot,values:{all:value}});
  const data=[obs('A','one',0),obs('B','one',.1),obs('C','one',.2),obs('C','two',0),obs('D','two',.1),obs('E','two',.2)];
  for(const stat of ['mean','median']){
    const result=connectedRaceCornerScores(data,'all','team',stat);
    assert.equal(result.scores.size,5);
    for(const [index,name] of ['A','B','C','D','E'].entries())assert.ok(Math.abs(result.scores.get(name)-index*.1)<1e-7);
    assert.equal(result.support.get('C'),2);
  }
  const result=connectedRaceCornerScores([...data,obs('X','disjoint',0),obs('Y','disjoint',.1),obs('Z','disjoint',.2)]);
  assert.equal(result.components.length,2);assert.equal(result.scores.has('X'),false);
  assert.deepEqual(connectedRaceCornerScores([...data].reverse()).scores,result.scores);
});

test('coverage selection keeps bridge cohorts and gives more than four snapshots when observed',()=>{
  const drivers=['A','B','C','D','E'].map((code,i)=>({code,team:code,laps:Array.from({length:20},(_,j)=>({
    lap:j+2,time:90+i,track_status:'1',compound:'MEDIUM',tyre_life:i<3?j+2:j+5,stint:1,
    lap_start_seconds:(j+2)*100+i*6,lap_end_seconds:(j+2)*100+i*6+90+i
  }))}));
  const groups=raceCornerGroups({drivers});
  assert.ok(groups.length>4);assert.ok(groups.length<=24);
  assert.deepEqual([...new Set(groups.flatMap(g=>g.rows.map(r=>r.driver.code)))].sort(),['A','B','C','D','E']);
  assert.ok(groups.every(g=>Math.max(...g.rows.map(r=>r.tyre_life))-Math.min(...g.rows.map(r=>r.tyre_life))<=4));
});
