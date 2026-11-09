import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// session-overview.js in a sandbox: its pure parts need nothing from the page.
function overview() {
  const box = {window: {}, document: {getElementById: () => null, addEventListener() {}}};
  vm.createContext(box);
  vm.runInContext(readFileSync('session-overview.js', 'utf8'), box);
  return box.window.ApexSessionOverview;
}
const lap = (n, t, extra = {}) => ({lap: n, time: t, s1: null, s2: null, s3: null, ...extra});

test('ideal lap is the sum of the best sectors; time left is best lap minus ideal', () => {
  const {driverSummary} = overview();
  const s = driverSummary({code: 'VER', laps: [
    lap(1, null, {out_lap: true, s2: 30.1, s3: 40.4}),
    lap(2, 95.2, {s1: 24.7, s2: 30.3, s3: 40.2, speed_st: 321}),
    lap(3, 95.0, {s1: 24.6, s2: 30.2, s3: 40.2, speed_st: 318}),
    lap(4, 94.5, {s1: 24.0, s2: 30.0, s3: 40.5, deleted: true}),   // deleted: none of it counts
  ]});
  assert.equal(s.best, 95.0);
  assert.equal(+s.ideal.toFixed(3), 24.6 + 30.1 + 40.2);
  assert.equal(+s.left.toFixed(3), +(95.0 - (24.6 + 30.1 + 40.2)).toFixed(3));
  assert.equal(s.trap, 321);
});

test('race progress: gaps to the car leading at the line, and the running order', () => {
  const {raceProgress} = overview();
  const d = (code, ends) => ({code, laps: ends.map((e, i) => ({lap: i + 1, lap_end_seconds: e}))});
  const {laps, rows} = raceProgress([d('A', [100, 190, 280]), d('B', [101, 189, 281.5]), d('C', [103, 195])]);
  assert.equal(laps, 3);
  const [a, b, c] = rows;
  assert.deepEqual([...a.positions.values()], [1, 2, 1]);
  assert.deepEqual([...b.positions.values()], [2, 1, 2]);
  assert.equal(b.gaps.get(1), 1); assert.equal(a.gaps.get(2), 1); assert.equal(b.gaps.get(3), 1.5);
  assert.equal(c.gaps.has(3), false, 'a lap not completed is not ranked');
  // A lap without its own end time ends where the next lap starts.
  const gapFill = raceProgress([{code: 'X', laps: [{lap: 1, lap_end_seconds: null}, {lap: 2, lap_start_seconds: 100, lap_end_seconds: 190}]}]);
  assert.equal(gapFill.rows[0].positions.get(1), 1);
});
