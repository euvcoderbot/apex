import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source = readFileSync('motion.js', 'utf8');
function page({reduced = false, transitions = true} = {}) {
  const calls = [];
  const document = {hidden: false, ...(transitions ? {startViewTransition: fn => { calls.push('transition'); fn(); }} : {})};
  const box = {document, matchMedia: () => ({matches: reduced}), setTimeout: (fn) => { box.pending = fn; return 1; }, clearTimeout() {}, window: {}};
  vm.createContext(box); vm.runInContext(source, box);
  return {motion: box.window.ApexMotion, calls, box};
}

test('navigation runs inside a view transition when the browser supports it', () => {
  const {motion, calls} = page(); let ran = false;
  motion.transition(() => { ran = true; });
  assert.deepEqual(calls, ['transition']); assert.equal(ran, true);
});

test('reduced motion or no support updates immediately, with no transition', () => {
  for (const options of [{reduced: true}, {transitions: false}]) {
    const {motion, calls} = page(options); let ran = false;
    motion.transition(() => { ran = true; });
    assert.equal(ran, true); assert.deepEqual(calls, []);
  }
});

test('charts grow in once after navigation, and never under reduced motion', () => {
  const {motion, box} = page(), element = {dataset: {}};
  motion.enter(element);
  assert.equal(element.dataset.motion, 'enter');
  box.pending();
  assert.equal(element.dataset.motion, undefined, 'the marker clears, so data refreshes do not re-animate');
  const still = {dataset: {}};
  page({reduced: true}).motion.enter(still);
  assert.equal(still.dataset.motion, undefined);
});

test('motion CSS animates navigation only and honours reduced motion', () => {
  const css = readFileSync('macos-window.css', 'utf8'), cars = readFileSync('car-performance.js', 'utf8');
  assert.match(css, /::view-transition-new\(performance-panel\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*::view-transition-group\(\*\)/);
  assert.match(css, /\.performance-page\[data-motion="enter"\] \.performance-bar/);
  // Keyboard activation (detail 0) must not wait for a transition: focus moves to the new tab at once.
  assert.match(cars, /if\(changed&&event\.detail>0&&window\.ApexMotion\)window\.ApexMotion\.transition\(update\);else update\(\);/);
});
