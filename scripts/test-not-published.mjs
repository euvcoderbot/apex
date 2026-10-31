import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// The published site answers 503 "has not been published yet" for a result nobody prepared. That is a
// permanent answer: retrying it only keeps the loading state up for 20 s or more per missing result.
test('a result that was never published is not retried', () => {
  const state = readFileSync('session-state.js', 'utf8'), performance = readFileSync('car-performance.js', 'utf8');
  assert.match(state, /const notPublished = async response => response\.status === 503 && \/not been published\/i/);
  assert.match(state, /attempt === attempts - 1 \|\| await notPublished\(response\)\) return response;/);
  assert.match(performance, /attempt===3\|\|\/not been published\/i\.test\(error\.message\)\|\|/);
});

test('the alignment note is shown only for laps that kept their original distance', () => {
  const alignment = readFileSync('alignment.js', 'utf8');
  assert.doesNotMatch(alignment, /sectors anchored, no braking-point matching/);
  assert.match(alignment, /Original distance kept:/);
});
