import {appSource} from './app-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
const source=appSource();
const box={};vm.createContext(box);
vm.runInContext(source.slice(source.indexOf('function fastestTimedLap('),source.indexOf('function toggleLoadedLap(')),box);
const lap=(number,time,s1,flags={})=>({lap:number,time,s1,phase:'Q3',stint:1,in_lap:false,out_lap:false,...flags});
const labels=(laps,session='Qualifying')=>{const roles=box.lapRoles(laps,session);return laps.map(l=>roles.get(l.lap)?.label||'');};

// Mexico City 2026, Antonelli in Q3, as OpenF1 flags it: L19 and L22 are marked as in-laps but were not, and the real in-lap L24 is unmarked.
const antonelli=()=>[lap(17,517.418,null,{out_lap:true}),lap(18,92.262,29.965),lap(19,77.339,27.093,{in_lap:true}),lap(20,98.946,33.612,{in_lap:true}),
  lap(21,278.616,null,{out_lap:true}),lap(22,87.872,29.399,{in_lap:true}),lap(23,76.707,26.876),lap(24,null,37.136)];

test('each run has one OUT and one IN, whatever the unreliable pit-entry flag says',()=>{
  assert.deepEqual(labels(antonelli()),['OUT','WARM','PUSH','IN','OUT','WARM','PUSH','IN']);
});

test('a flying lap is never an in-lap, and multiple warm-up laps are all warm-ups',()=>{
  const laps=[lap(1,300,null,{out_lap:true}),lap(2,95,32),lap(3,92,31),lap(4,77,27),lap(5,100,35)];
  assert.deepEqual(labels(laps),['OUT','WARM','WARM','PUSH','IN']);
});

test('an attempt that starts at flying pace and loses the time is an abort, not a warm-up',()=>{
  const middle=[lap(1,300,null,{out_lap:true}),lap(2,77,27),lap(3,90,27.2),lap(4,100,35)];
  assert.deepEqual(labels(middle),['OUT','PUSH','ABORT','IN']);
  // No lap time at all, but a flying first sector: still an attempt.
  assert.deepEqual(labels([lap(1,300,null,{out_lap:true}),lap(2,77,27),lap(3,null,27.1)]),['OUT','PUSH','ABORT']);
  // Abandoned on the way into the pits: the attempt is what matters.
  assert.deepEqual(labels([lap(1,300,null,{out_lap:true}),lap(2,77,27),lap(3,105,27.3),lap(4,300,null,{out_lap:true})]).slice(0,3),['OUT','PUSH','ABORT']);
});

test('slow laps are named by where they fall around the attempts',()=>{
  const laps=[lap(1,300,null,{out_lap:true}),lap(2,95,32),lap(3,77,27),lap(4,120,38),lap(5,77.2,27.1),lap(6,110,36),lap(7,115,37)];
  assert.deepEqual(labels(laps),['OUT','WARM','PUSH','PREP','PUSH','COOL','IN']);
});

test('a slow lap under a flag says so, and flagged laps do not set the reference',()=>{
  const laps=[lap(1,300,null,{out_lap:true}),lap(2,77,27),lap(3,70,24,{track_status:'4'}),lap(4,110,36,{track_status:'2'}),lap(5,77.1,27),lap(6,110,36)];
  assert.deepEqual(labels(laps),['OUT','PUSH','PUSH','FLAG','PUSH','IN']);
});

test('a car that leaves and comes straight back is one IN/OUT lap',()=>{
  assert.deepEqual(labels([lap(1,300,null,{out_lap:true}),lap(2,300,null,{out_lap:true}),lap(3,77,27),lap(4,100,35)]),['IN/OUT','OUT','PUSH','IN']);
});

test('races and practice only get pit labels, and a race does not end in the pits',()=>{
  const stint=[lap(1,90,30,{out_lap:true}),lap(2,91,30),lap(3,110,36),lap(4,110,36,{out_lap:true}),lap(5,91,30),lap(6,91,30)];
  assert.deepEqual(labels(stint,'Race'),['OUT','','IN','OUT','','']);
  assert.deepEqual(labels(stint,'Practice 1'),['OUT','','IN','OUT','','IN']);
  const retired=[lap(1,90,30,{out_lap:true}),lap(2,120,40,{in_lap:true})];
  assert.deepEqual(labels(retired,'Race'),['OUT','IN']);
});

test('a deleted flying lap reads DEL and is never the driver\'s fastest',()=>{
  // Mexico City 2026, Bearman: 1:17.847 was deleted, and his official best is 1:18.083.
  const laps=[lap(16,300,null,{out_lap:true}),lap(17,77.847,27,{deleted:true}),lap(18,110,36),lap(19,300,null,{out_lap:true}),lap(20,78.083,27.2),lap(21,110,36)];
  assert.deepEqual(labels(laps),['OUT','DEL','IN','OUT','PUSH','IN']);
  assert.equal(box.fastestTimedLap({laps}).lap,20);
  assert.equal(box.fastestTimedLap({laps:[lap(17,77.847,27,{deleted:true})]}),null);
});

test('a lap caught by a red flag shows the flag, whatever it would otherwise be called',()=>{
  // Mexico City 2026 Q1: Verstappen was flying with no lap time, Antonelli had just started his in-lap.
  const verstappen=[lap(1,null,null,{out_lap:true}),lap(2,null,26.977,{red_flag:true}),lap(3,696,null,{out_lap:true}),lap(4,77.9,27)];
  assert.deepEqual(labels(verstappen),['OUT','🚩','OUT','PUSH']);
  const antonelli=[lap(1,null,null,{out_lap:true}),lap(2,null,null,{red_flag:true}),lap(3,598,null,{out_lap:true}),lap(4,78,27)];
  assert.deepEqual(labels(antonelli),['OUT','🚩','OUT','PUSH']);
  assert.equal(labels([lap(1,300,null,{out_lap:true}),lap(2,77,27),lap(3,110,36,{track_status:'5'}),lap(4,300,null,{out_lap:true})])[2],'🚩');
  // A flying lap finished as the flag came out still counts as a flying lap.
  assert.equal(labels([lap(1,300,null,{out_lap:true}),lap(2,77,27,{red_flag:true}),lap(3,110,36)])[1],'PUSH');
});

test('labelling leaves timing and flags untouched',()=>{
  const laps=antonelli(),before=JSON.stringify(laps);
  box.lapRoles(laps,'Qualifying');
  assert.equal(JSON.stringify(laps),before);
});
