import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('the session menu knows which sessions the published site can open', () => {
  const loader = readFileSync('session-loader.js', 'utf8');
  const block = loader.match(/const SESSION_ALIASES[\s\S]*?(?=async function loadPublishedSessions)/)[0];
  const {publishedSessionId, publishedSessionIds} = new Function(block.replace(/let publishedSessions = null;.*\r?\n/, '') + '; return {publishedSessionId, publishedSessionIds};')();
  const captures = {sourceRevision: 'rev1', entries: {
    '/api/session?gp=Mexico+City+Grand+Prix&round=19&session=Practice+2&year=2026': {file: 'a'},
    '/api/session?gp=United+States+Grand+Prix&round=18&session=Q&year=2026': {file: 'b'},
    '/api/performance?gp=Barcelona+Grand+Prix&session=R&year=2026': {file: 'c'}}};
  const ids = publishedSessionIds({captures, prerendered: null, prepared: {'2025:Monaco Grand Prix:Race': 'x.json'}}, {source: 'rev1'});
  assert.ok(ids.has(publishedSessionId(2026, 'Mexico City Grand Prix', 'Practice 2')));
  assert.ok(ids.has(publishedSessionId(2026, 'United States Grand Prix', 'Qualifying')), 'Q and Qualifying are the same session');
  assert.ok(ids.has(publishedSessionId(2025, 'Monaco Grand Prix', 'Race')));
  assert.ok(!ids.has(publishedSessionId(2026, 'Australian Grand Prix', 'Race')));
  assert.ok(!ids.has(publishedSessionId(2026, 'Barcelona Grand Prix', 'Race')), 'only session snapshots count, not performance ones');
  assert.equal(publishedSessionIds({captures, prerendered: null, prepared: null}, {source: 'other'}).size, 0, 'a capture index built for other code is ignored, as the page ignores it');
  assert.match(loader, /not published`/);
  assert.match(loader, /if \(!window\.APEX_SNAPSHOT_MODE \|\| window\.APEX_LOCAL_MODE\) return;/);
});
