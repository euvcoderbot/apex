import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('race rows are one line with the full name as their tooltip', () => {
  assert.match(readFileSync('car-performance.js', 'utf8'), /class="track-pill" data-track-name="\$\{escape\(e\.name\)\}" title="\$\{escape\(e\.name\)\}"/);
  assert.match(readFileSync('hig-system.css', 'utf8'), /\.app-sidebar \.track-pill \.track-name \{ white-space: nowrap; overflow: hidden; text-overflow: ellipsis; \}/);
});
