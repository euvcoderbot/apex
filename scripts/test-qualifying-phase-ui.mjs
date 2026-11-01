import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source = readFileSync('session-loader.js', 'utf8');
const start = source.indexOf('function mergeConfirmedQualifyingPhases(');
const end = source.indexOf('\n}', start) + 2;
const context = vm.createContext({});
vm.runInContext(source.slice(start, end), context);
const merge = context.mergeConfirmedQualifyingPhases;

test('qualifying phase enrichment requires the same session, driver, lap and timestamp', () => {
  const lap = {lap: 5, date_start: '2026-10-31T21:20:00Z', time: 79, stint: 2};
  const payload = {openf1_session_key: 123, drivers: [{code: 'VER', laps: [lap]}]};
  const phases = {openf1_session_key: 124, drivers: [{code: 'VER', laps: [{...lap, phase: 'Q2'}]}]};
  merge(payload, phases);
  assert.equal(lap.phase, undefined);
  phases.openf1_session_key = 123;
  phases.drivers[0].laps[0].date_start = '2026-10-31T21:21:00Z';
  merge(payload, phases);
  assert.equal(lap.phase, undefined);
  phases.drivers[0].laps[0].date_start = '2026-10-31T21:20:00.000+00:00';
  merge(payload, phases);
  assert.deepEqual(lap, {lap: 5, date_start: '2026-10-31T21:20:00Z', time: 79, stint: 2, phase: 'Q2'});
  phases.drivers[0].laps[0].phase = 'Q3';
  merge(payload, phases);
  assert.equal(lap.phase, 'Q2', 'existing phase is not overwritten');
});

test('unassigned qualifying laps remain visible instead of being grouped by tyre stint', () => {
  const laps = readFileSync('session-laps.js', 'utf8');
  assert.match(laps, /\['Q1', 'Q2', 'Q3', 'Unassigned'\]/);
  assert.match(laps, /groupIds.includes\(String\(openStint\[code\]\)\)/);
  assert.match(laps, /phaseFor\(lap\) === id/);
});
