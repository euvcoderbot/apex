import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const load = theme => {
  const window = {}, document = {documentElement: {dataset: {theme}}};
  vm.runInNewContext(readFileSync(new URL('../team-colours.js', import.meta.url), 'utf8'), {window, document});
  return window.apexTeamColour;
};

test('feed colours are drawn as formula1.com shows them (2026)', () => {
  const colour = load('dark');
  assert.equal(colour('#4781D7'), '#3671c6', 'Red Bull Racing');
  assert.equal(colour('#ED1131'), '#e8002d', 'Ferrari');
  assert.equal(colour('#00D7B6'), '#27f4d2', 'Mercedes');
  assert.equal(colour('#9C9FA2'), '#dee1e2', 'Haas F1 Team');
  assert.equal(colour('#1868DB'), '#1868db', 'Williams already matches');
  assert.equal(colour('#ff00aa'), '#ff00aa', 'any other colour, such as one a person picked for a lap, is left alone');
});

test('Haas uses formula1.com\'s accessible colour on light backgrounds', () => {
  assert.equal(load('light')('#9C9FA2'), '#667175');
  assert.equal(load('light')('#4781D7'), '#3671c6');
});

test('the helper loads before the views that draw with it', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(html.indexOf('team-colours.js') > 0 && html.indexOf('team-colours.js') < html.indexOf('session-state.js'));
  assert.match(readFileSync(new URL('../scripts/sync-static.mjs', import.meta.url), 'utf8'), /"team-colours\.js"/);
  assert.match(readFileSync(new URL('../performance-format.js', import.meta.url), 'utf8'), /globalThis\.apexTeamColour\?\.\(value\)/);
});
