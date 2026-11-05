import test from 'node:test';
import assert from 'node:assert/strict';
import {visibleBarValue} from '../lib/chart-bar.mjs';
test('bar geometry agrees with displayed precision without minimum-width inflation',()=>{
  for(const value of [0, 0.000001, -0.00049])assert.equal(visibleBarValue(value),0);
  for(const value of [-0.935, 0.001, -0.0005, 0.0005])assert.equal(visibleBarValue(value),value);
  assert.equal(visibleBarValue(.004,2),0);
});
