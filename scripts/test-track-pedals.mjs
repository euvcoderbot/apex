import test from 'node:test';
import assert from 'node:assert/strict';
import {trackPedals} from '../lib/track-pedals.mjs';

test('pedal states match the source outline and leave flagged channels unclassified', () => {
  const samples = [[100,0],[40,0],[0,100],[0,0],[100,104],[100,0]].map(([Throttle, Brake], i) => ({
    X:i, Y:0, Distance:i*6, ElapsedSeconds:i*.25, Throttle, Brake,
    SourceIntervalSeconds:i===5?.7:0
  }));
  const outline = samples.map(({X,Y}) => [X,Y]);
  assert.equal(trackPedals(samples, outline), 'fpbc??');
  assert.equal(trackPedals(samples, [...outline].reverse()), null);
});
