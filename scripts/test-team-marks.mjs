import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync, readdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import vm from 'node:vm';

// team-marks.js in a sandbox of its own: it only needs `window`.
function marks() {
  const box = {window: {}};
  vm.createContext(box);
  vm.runInContext(readFileSync('team-marks.js', 'utf8'), box);
  return box.window.ApexTeamMarks;
}

test('every team name used from 2014 to 2026, in any common spelling, gets a drawn mark', () => {
  const {teamMarkMarkup} = marks();
  const names = ['Red Bull', 'Red Bull Racing', 'Oracle Red Bull Racing', 'Mercedes', 'Mercedes-AMG Petronas', 'Ferrari', 'Scuderia Ferrari', 'McLaren', 'McLaren F1 Team', 'Williams', 'Williams Martini Racing',
    'Force India', 'Sahara Force India F1 Team', 'Racing Point Force India F1 Team', 'Racing Point', 'Lotus', 'Lotus F1', 'Toro Rosso', 'Scuderia Toro Rosso', 'AlphaTauri', 'Scuderia AlphaTauri',
    'RB', 'Visa Cash App RB F1 Team', 'Racing Bulls', 'Sauber', 'Alfa Romeo Sauber', 'Alfa Romeo', 'Alfa Romeo Racing', 'Alfa Romeo F1 Team Stake', 'Kick Sauber', 'Stake F1 Team Kick Sauber',
    'Marussia', 'Manor Marussia', 'Manor Marussia F1 Team', 'Manor', 'Caterham', 'Caterham F1 Team', 'Renault', 'Renault F1 Team', 'Alpine', 'Alpine F1 Team', 'BWT Alpine F1 Team', 'Aston Martin', 'Aston Martin Aramco',
    'Haas', 'Haas F1 Team', 'MoneyGram Haas F1 Team', 'Audi', 'Audi F1 Team', 'Cadillac', 'Cadillac F1 Team'];
  assert.deepEqual(names.filter(name => /team-logo-fallback/.test(teamMarkMarkup(name))), []);
});

test('a mark is the team code on a tile in the team colour, with no image and nothing taken from the name', () => {
  const {teamMark, teamMarkMarkup} = marks();
  assert.deepEqual({...teamMark('Oracle Red Bull Racing')}, {key: 'red-bull-racing', code: 'RBR', colour: '#3671c6'});
  assert.equal(teamMark('Visa Cash App RB F1 Team').code, 'RB');
  assert.equal(teamMark('Stake F1 Team Kick Sauber').code, 'SAU');
  const html = teamMarkMarkup('Haas F1 Team');
  assert.equal(html, '<span class="team-logo team-mark" data-team-mark="haas" data-code="HAA" style="--team-mark:#b6babd" aria-hidden="true"></span>');
  // Unknown or hostile names get the plain fallback, never their own text.
  assert.match(teamMarkMarkup('<img src=x onerror=alert(1)>'), /team-logo-fallback/);
  assert.match(teamMarkMarkup(''), /team-logo-fallback/);
  // Current teams are told apart by code even where colours are close.
  const current = ['Mercedes', 'Ferrari', 'Red Bull Racing', 'McLaren', 'Racing Bulls', 'Alpine', 'Haas', 'Audi', 'Williams', 'Aston Martin', 'Cadillac'];
  assert.equal(new Set(current.map(t => teamMark(t).code)).size, current.length);
});

test('the site ships no team logos, car images or tyre maker images, and no formula1.com or Pirelli files', () => {
  for (const dir of ['assets/teams', 'assets/tyres']) assert.equal(existsSync(dir), false, dir);
  assert.equal(existsSync('assets/official-sources.json'), false);
  const tracked = execFileSync('git', ['ls-files', '*.js', '*.mjs', '*.ts', '*.tsx', '*.html', '*.css'], {encoding: 'utf8'}).split('\n')
    .filter(f => f && !f.startsWith('scripts/test-') && !f.startsWith('e2e/'));
  const offenders = tracked.filter(f => existsSync(f) && /assets\/(teams|tyres)\/|media\.formula1\.com|tyre24\.pirelli/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(offenders, []);
});

test('every driver photo is a credited Wikimedia Commons file under a free licence', () => {
  const {photos} = JSON.parse(readFileSync('assets/drivers/credits.json', 'utf8'));
  const files = readdirSync('assets/drivers').filter(f => f !== 'credits.json');
  assert.ok(files.length >= 20, `${files.length} photos`);
  for (const file of files) {
    const id = file.replace(/\.webp$/, ''), credit = photos[id];
    assert.ok(file.endsWith('.webp') && credit, `${file} has a credit`);
    assert.match(credit.page, /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/, id);
    assert.match(credit.licence, /^(CC BY(-SA)? [\d.]+|CC0( 1\.0)?|Public domain|OGL [23])$/, `${id}: ${credit.licence}`);
    assert.ok(credit.author && credit.name, id);
    if (!/^(CC0|Public domain)/.test(credit.licence)) assert.match(credit.licence_url, /^https:\/\//, `${id} links its licence`);
  }
  for (const id of Object.keys(photos)) assert.ok(files.includes(`${id}.webp`), `${id} credit has a photo`);
  // Pages that show photos list their credits; the driver header credits its own.
  const season = readFileSync('season.js', 'utf8');
  assert.match(season, /function photoCredits\(\)/);
  assert.match(season, /const credit = photoCredit\(id\); if \(credit\) ident\.append\(credit\);/);
  assert.match(season, /function paint\(views\) \{\n    imagery\.shown\.clear\(\);/);
  assert.doesNotMatch(season, /body\.replaceChildren\(\.\.\.render/);
});

test('every page that shows teams loads the marks before the views that draw them', () => {
  const page = readFileSync('index.html', 'utf8');
  assert.ok(page.indexOf('src="team-marks.js"') > 0 && page.indexOf('src="team-marks.js"') < page.indexOf('src="session-state.js"'));
  assert.match(readFileSync('scripts/sync-static.mjs', 'utf8'), /"team-marks\.js"/);
  const css = readFileSync('ui-controls.css', 'utf8');
  assert.match(css, /\.team-mark::after \{ content: attr\(data-code\);/);
  assert.match(css, /@media \(forced-colors: active\) \{ \.team-mark \{ background: Canvas;/);
});
