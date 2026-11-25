import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {legacySource} from './legacy-css.mjs';

test('race rows are one line with the full name as their tooltip', () => {
  assert.match(readFileSync('car-performance.js', 'utf8'), /class="track-pill" data-track-name="\$\{escape\(e\.name\)\}" title="\$\{escape\(e\.name\)\}"/);
  assert.match(legacySource('hig-system.css'), /\.app-sidebar \.track-pill \.track-name \{ white-space: nowrap; overflow: hidden; text-overflow: ellipsis; \}/);
});
