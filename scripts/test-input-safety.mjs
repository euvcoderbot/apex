import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const loader = readFileSync('session-loader.js', 'utf8');
const safeDriver = new Function(loader.match(/function safeDriver\(driver\) \{[\s\S]*?\r?\n\}\r?\n/)[0] + '; return safeDriver;')();

test('driver fields that reach attributes and inline styles are reduced to what they can contain', () => {
  const clean = safeDriver({code: 'ver', number: '1', team_color: '#3671C6', name: 'Max Verstappen'});
  assert.deepEqual(clean, {code: 'VER', number: '1', team_color: '#3671C6', name: 'Max Verstappen'});
  const hostile = safeDriver({code: 'A"><img src=x onerror=alert(1)>', number: '1" onfocus="x', team_color: 'red;background:url(//evil)', name: 'x'});
  assert.equal(hostile.code, 'AIMG');
  assert.equal(hostile.number, '');
  assert.equal(hostile.team_color, '#8b8b93');
  assert.equal(safeDriver({code: '<>"'}), null, 'a code with nothing legitimate is dropped');
  assert.equal(safeDriver(null), null);
  assert.equal(safeDriver({code: 'LEC', team_color: '3671C6'}).team_color, '#3671C6', 'a colour without # is accepted');
});

test('drivers are sanitised before they are stored, and select options are escaped', () => {
  assert.match(loader, /payload\.drivers = payload\.drivers\.map\(safeDriver\)\.filter\(Boolean\);\s*if \(!payload\.drivers\.length\) throw/);
  assert.match(loader, /<option value="\$\{escapeUI\(valueFor\(val\)\)\}">\$\{escapeUI\(labelFor\(val\)\)\}<\/option>/);
});
