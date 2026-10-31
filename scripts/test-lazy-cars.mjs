import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// Car performance and its React views are about 40% of the script weight. They are inert in the page until
// that view is opened or the browser is idle. These pin down the parts that are easy to break.
const html = readFileSync('index.html', 'utf8');

test('the two heavy modules are inert tags that the page loader turns into module scripts, in order', () => {
  assert.match(html, /<script type="lazy-module" src="react-islands\.js"><\/script>\s*<script type="lazy-module" src="car-performance\.js[^"]*"><\/script>/);
  assert.doesNotMatch(html, /<script type="module"/, 'nothing else loads them eagerly');
  assert.match(html, /script\.type = 'module'; script\.src = inert\.getAttribute\('src'\); script\.async = false;/);
});

test('a car-performance address survives until its module is in, and a person\'s early click is replayed', () => {
  assert.match(html, /if \(start && start\.view === 'cars'\) \{ window\.ApexCarsPending = true; load\(\)/);
  assert.match(readFileSync('session-corners.js', 'utf8'), /window\.ApexCarsPending \|\|/);
  // The module clicks its own tab at start-up; only a trusted click is intercepted.
  assert.match(html, /event\.isTrusted && !window\.ApexShowView/);
  assert.match(html, /load\(\)\.then\(function \(\) \{ tab\.click\(\); \}/);
});
