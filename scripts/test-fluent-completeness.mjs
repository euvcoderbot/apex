import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import postcss from 'postcss';
import {raceCornerGroups} from '../race-cornering.js';
const source=fs.readFileSync('car-performance.js','utf8');

test('sprint points include both drivers, preserve unknowns and do not affect race-only rates',()=>{
  const box={finite:Number.isFinite,completed:(e,s)=>s==='Sprint'&&e.sprint};
  vm.createContext(box);vm.runInContext(source.slice(source.indexOf('function sprintPointsForTeam('),source.indexOf('function renderResults(')),box);
  const event={sprint:true,S:{drivers:[{team:'A',result:{points:8}},{team:'A',result:{points:6}},{team:'B',result:{points:0}}]}};
  assert.equal(box.sprintPointsForTeam([event],'A').points,14);
  assert.equal(box.sprintPointsForTeam([event],'B').points,0);
  assert.equal(box.sprintPointsForTeam([event],'B').known,true);
  assert.equal(box.sprintPointsForTeam([{sprint:true}],'A').known,false);
  assert.equal(box.sprintPointsForTeam([{sprint:false}],'A').known,true);
  event.S.drivers[1].result.points=null;
  assert.equal(box.sprintPointsForTeam([event],'A').known,false);
  assert.match(source,/job.session==='S'\?'\/api\/performance\/sprint':'\/api\/performance'/);
});

test('full-race planner retains late laps and honours explicit diagnostic budgets',()=>{
  const drivers=['A','B','C'].map((code,i)=>({code,team:code,laps:Array.from({length:55},(_,n)=>({lap:n+2,time:90,stint:1,
    track_status:'1',compound:'MEDIUM',tyre_life:n+2,lap_start_seconds:(n+2)*100+i*5,lap_end_seconds:(n+2)*100+i*5+90}))}));
  const result=raceCornerGroups({drivers});
  assert.equal(result.length,55);assert.ok(result.some(g=>g.lap===56));
  assert.equal(result.plan.selectedUniqueLaps,165);
  assert.equal(raceCornerGroups({drivers},{},4).length,4);
});

test('macOS layout uses independent navigation and stacked non-growing sidebar cards',()=>{
  const css=fs.readFileSync('macos-ui.css','utf8');postcss.parse(css);
  assert.match(css,/\.sidebar \{[^}]*flex-direction: column/);
  assert.match(css,/\.sidebar > \.dashboard-card \{[^}]*flex: 0 0 auto/);
  assert.match(css,/#performanceResults \{ display: grid; grid-template-columns: 216px minmax\(0,1fr\)/);
  assert.match(css,/is-compact-table \.performance-table \{[^}]*min-width: 0/);
  assert.match(css,/prefers-reduced-transparency/);
  assert.match(fs.readFileSync('scripts/sync-static.mjs','utf8'),/"macos-ui.css"/);
  assert.match(source,/aria-orientation="vertical"/);
});
