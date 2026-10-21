import {appSource} from './app-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=appSource(), css=readFileSync('macos-window.css','utf8');
const box={};vm.createContext(box);
vm.runInContext(source.slice(source.indexOf('function qualifyingPreparationLaps('),source.indexOf('function toggleLoadedLap(')),box);
const fixture=()=>[null,95.700,120.236,125.126,93.594,124.928,92.774,123.042,94.914,121.383].slice(1).map((time,index)=>({lap:index+2,time,stint:index<2?1:2,phase:'Q1',compound:'SOFT',in_lap:[3,10].includes(index+2),out_lap:index+2===4,track_status:'1'}));

test('multi-push qualifying run marks the intervening slow laps as preparation, not pit exits',()=>{
  const laps=fixture(), before=JSON.stringify(laps);
  assert.deepEqual([...box.qualifyingPreparationLaps(laps,'Qualifying').keys()],[6,8]);
  assert.deepEqual([...box.qualifyingPreparationLaps(laps,'Sprint Qualifying').keys()],[6,8]);
  assert.equal(JSON.stringify(laps),before,'Timing and pit flags remain untouched');
  assert.match(box.qualifyingPreparationLaps(laps,'Qualifying').get(6).reason,/Inferred.*No pit exit/);
});

test('race laps, traffic-sized losses, flags and interrupted tyre runs are not relabelled',()=>{
  assert.equal(box.qualifyingPreparationLaps(fixture(),'Race').size,0);
  for(const change of [lap=>{lap.track_status='2';},lap=>{lap.track_status='4';},lap=>{lap.deleted=true;},lap=>{lap.in_lap=true;},lap=>{lap.time=98;},lap=>{lap.stint=3;},lap=>{lap.compound='MEDIUM';}]){
    const laps=fixture();change(laps.find(l=>l.lap===6));
    assert.equal(box.qualifyingPreparationLaps(laps,'Qualifying').has(6),false);
  }
  const missing=fixture().filter(l=>l.lap!==7);
  assert.equal(box.qualifyingPreparationLaps(missing,'Qualifying').has(6),false);
  const terminal=fixture().filter(l=>l.lap<7);
  assert.equal(box.qualifyingPreparationLaps(terminal,'Qualifying').has(6),false);
});

test('compact summary and category controls use shared typography and selection tokens',()=>{
  assert.match(source,/summary-driver[^\n]+teamLogoMarkup/);
  assert.match(css,/summary-lap-time > strong[^}]+var\(--type-title2\)/);
  assert.match(css,/sector-measurements > strong[^}]+var\(--type-headline\)/);
  assert.match(css,/grid-template-areas: "driver time" "tyre time"/);
  // The category bar is a segmented control: a raised thumb, no ring.
  assert.match(css,/category-tab\[aria-current="page"\][^}]+background: var\(--ui-seg-thumb\); box-shadow: var\(--ui-thumb-shadow\)/);
});
