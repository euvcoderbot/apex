import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';

// Compile the React views as the browser bundle does, then render them to
// static markup: the page's CSS and delegated handlers rely on exact classes
// and data-* attributes, so those are what these tests pin down.
async function load() {
  const entry = `export {ResultsView} from './src/views/ResultsView';
export {PitsView} from './src/views/PitsView';
export {TrendView} from './src/views/TrendView';
export {PaceView} from './src/views/PaceView';
export {TyresView} from './src/views/TyresView';
export {Sparkline} from './src/components/Sparkline';
export {BarChart} from './src/components/BarChart';
export {DataTable} from './src/components/DataTable';
export {TeamLogo, EventLabel} from './src/components/TeamLabel';
export {renderToStaticMarkup} from 'react-dom/server';
export {createElement} from 'react';`;
  const out = await build({stdin: {contents: entry, resolveDir: process.cwd(), loader: 'ts'}, bundle: true, write: false,
    format: 'esm', platform: 'node', jsx: 'automatic', external: ['react', 'react-dom'], logLevel: 'silent'});
  const file = join(mkdtempSync(join(tmpdir(), 'apex-react-')), 'views.mjs');
  writeFileSync(file, out.outputFiles[0].text.replace(/from "react(-dom\/server|\/jsx-runtime)?"/g,
    (m, sub) => `from ${JSON.stringify(pathToFileURL(join(process.cwd(), 'node_modules', 'react' + (sub === '-dom/server' ? '-dom/server.js' : sub ? '/jsx-runtime.js' : '/index.js'))).href)}`));
  return import(pathToFileURL(file).href);
}
const views = await load();
const render = (component, props) => views.renderToStaticMarkup(views.createElement(component, props));
const sortModel = key => ({key, label: key, state: key === 'points' ? 'descending' : 'none', group: 'g', direction: -1});
const row = (team, points, extra = {}) => ({team, color: '#ff0000', points, racePoints: points, sprintPoints: 0, results: true,
  pointsPerStart: points / 2, finishRatePct: 100, mechanicalRatePct: 0, mechanicalPer1000Laps: null, positions: [1, 2],
  finishes: 2, starts: 2, completedLaps: 100, lapExposureEntries: 2, puRetirements: 0, chassisRetirements: 0,
  incidentRetirements: 0, otherRetirements: 0, unknownRetirements: 0, retirements: [], ...extra});

test('results view keeps the segmented measure, sort headers and retirement badges the page handles', () => {
  const html = render(views.ResultsView, {
    rows: [row('Ferrari', 40), row('Cadillac', null, {retirements: [{event: 'Bahrain Grand Prix', driver: 'PER', category: 'PU-related', cause: 'Power unit'}], puRetirements: 1})],
    chartMetric: 'perStart', chart: {title: 'Points', valueKey: 'points', unit: ' pts', digits: 0, signedValue: false, invertBest: true},
    sort: Object.fromEntries(['resultTeam', 'points', 'pointsPerStart', 'finish', 'finishRate', 'mechanicalRate', 'pu', 'chassis', 'incidents', 'other', 'mechanicalExposure'].map(k => [k, sortModel(k)]))
  });
  assert.match(html, /<button type="button" data-results-chart="perStart" aria-pressed="true">Points \/ start<\/button>/);
  assert.match(html, /data-results-chart="points" aria-pressed="false"/);
  assert.match(html, /data-performance-sort="points" data-sort-table="g" data-sort-direction="-1"/);
  assert.match(html, /<th scope="col" aria-sort="descending">/);
  assert.match(html, /class="performance-bar-row is-unranked"[^>]*>.*Cadillac.*Unranked/s, 'a missing total is unranked, never zero');
  assert.match(html, /<span class="retirement-badge is-pu">Power unit<\/span>/);
  assert.match(html, /<img class="gp-flag" src="assets\/flags\/bh.svg"/);
});

test('bar chart rebases to the best entrant and marks provisional values', () => {
  const html = render(views.BarChart, {rows: [{team: 'A', value: 1.5, color: '#00ff00'}, {team: 'B', value: 1.0, traceProvisional: true}], options: {unit: '%'}});
  assert.ok(html.indexOf('>B<') < html.indexOf('>A<'), 'best first');
  assert.match(html, /is-gain">≈ 0.000%/);
  assert.match(html, /is-loss">\+0.500%/);
});

test('team marks follow the session rules: official colour + mono, historical, fallback', () => {
  assert.match(render(views.TeamLogo, {team: 'Red Bull Racing'}), /data-team-mark="redbullracing".*redbullracing-color\.webp.*redbullracing\.webp/s);
  assert.match(render(views.TeamLogo, {team: 'Toro Rosso'}), /team-logo-historical.*toro-rosso\.svg/s);
  assert.match(render(views.TeamLogo, {team: 'Nobody'}), /team-logo-fallback/);
});

test('pit stops view draws the measured sample, never a zero for a missing stop', () => {
  const {PitsView} = views;
  const sample = (mean, count, spread = null) => ({mean, median: mean, fastest: mean, p25: 2, p75: 2.5, count, spread});
  const html = render(PitsView, {note: 'n', serviceNote: 's', failures: [], noStationary: false,
    quality: {stationary: 1, lane: 2, visits: 2, refresh: true}, isLane: false, isDriver: false, relativeLane: false, chartMetric: 'median',
    chartRows: [{team: 'Ferrari', chartValue: 2.1}, {team: 'Haas F1 Team', chartValue: null}], chart: {valueKey: 'chartValue', unit: ' s', signedValue: false},
    emptyMessage: 'none', sort: Object.fromEntries(['pitName', 'pitTeam', 'pitMean', 'pitMedian', 'pitFastest', 'pitSpread', 'pitCount', 'pitEvents'].map(k => [k, sortModel(k)])),
    rows: [{team: 'Ferrari', sample: sample(2.1, 5, 0.5), eventCount: 2}, {team: 'Haas F1 Team', sample: sample(null, 0), eventCount: 1}],
    visits: [{event: 'Singapore Grand Prix', team: {team: 'Ferrari'}, driver: 'LEC', lap: 30, stop: 2.1, lane: 24.3, source: 'OpenF1', evidence: 'service'}]});
  assert.match(html, /data-pit-measure="stop" aria-pressed="true"/);
  assert.match(html, /<button type="button" data-pit-chart="median" aria-pressed="true">Median<\/button>/);
  assert.match(html, /0\.500 s<small>2\.000–2\.500 s<\/small>/);
  assert.match(html, /—<small>No timed samples<\/small>/);
  assert.match(html, /<button type="button" data-pit-retry="">Refresh missing timing<\/button>/);
  assert.match(html, />2\.1 s</, 'exact seconds as published');
  assert.match(html, /is-unranked/);
});

test('development sparklines show real rounds and never join unobserved gaps', () => {
  const html = render(views.Sparkline, {label: 'Example', teamColor: '#123456', lo: 16, hi: 18, ceiling: 1,
    points: [{round: 16, pace: 1, event: 'A'}, {round: 18, pace: .5, event: 'B'}]});
  assert.equal((html.match(/<circle/g) || []).length, 2);
  assert.match(html, /common scale across teams/);
  assert.match(html, /d="M[^"L]+ M/, 'round 17 is missing: the line breaks');
});

test('development view: single-GP explanation, ranking switch and coverage', () => {
  assert.match(render(views.TrendView, {single: true, event: 'Bahrain Grand Prix'}), /single track \(<strong>Bahrain Grand Prix<\/strong>\)/);
  const html = render(views.TrendView, {view: 'fitted', showSensitivity: true, spark: {lo: 1, hi: 3, ceiling: 2},
    sort: {team: sortModel('trendTeam'), last: sortModel('trendLast'), change: sortModel('trendModelled')},
    rows: [{team: {team: 'Ferrari', color: '#ff0000'}, first: 1.2, last: .4, label: 'R1 → R3', count: 3, sampleTier: 'Limited (<10 events)',
      change: -.8, slopePerRound: -.4, range: [-.5, -.3], points: [{round: 1, event: 'A', pace: 1.2}, {round: 2, event: 'B', pace: .8}, {round: 3, event: 'C', pace: .4}]}]});
  assert.match(html, /data-trend-view="fitted" aria-pressed="true"/);
  assert.match(html, /trend-change is-improvement[^>]*>-0\.800 pp/);
  assert.match(html, /<small>-0\.400% \/ round<\/small>/);
  assert.match(html, /-0\.500 to -0\.300 pp\/round/);
  assert.match(html, /FIA event documents/);
});

test('pace view: toggles, two charts, cell notes and evidence tables', () => {
  const team = {team: 'Ferrari', color: '#ff0000'};
  const html = render(views.PaceView, {regulatory: true, note: 'n', stat: {show: true, value: 'median'}, qualyMode: 'adjusted', qualyBadge: 'Estimated phase evolution',
    qualyChart: {rows: [{...team, qualyAdjusted: .2}], options: {valueKey: 'qualyAdjusted', title: 'Q'}},
    raceChart: {rows: [{...team, race: .5}], options: {valueKey: 'race', title: 'R'}},
    sort: {team: sortModel('team'), pace: sortModel('qualyAdjusted'), race: sortModel('race'), samples: sortModel('samples')},
    rows: [{team, pace: {value: '0.200%', note: '3 of 3 loaded qualifying events'}, race: {value: '0.500%', provisional: true, note: 'LEC · 3/3 races supported'}, samples: 120}],
    coverage: [{team, event: 'Bahrain Grand Prix', driver: 'LEC', laps: '2–57', stints: 2, compounds: 'MEDIUM, HARD', range: '0.4–0.6%', common: null, leave: {value: '0.4–0.7%', note: '3 deletion fits'}, noise: '1.100'}],
    laps: [{team, event: 'Bahrain Grand Prix', phase: 'Q3', driver: 'LEC', time: 89.123}],
    drivers: [{team, event: 'Bahrain Grand Prix', driver: 'LEC · selected', estimate: '0.500%', samples: 50, basis: 'Clear-air', residual: '0.120% residual'}]});
  assert.match(html, /2026 telemetry limits/);
  assert.match(html, /data-pace-stat="median" aria-pressed="true"/);
  assert.match(html, /data-qualy-mode="adjusted" title="Estimate allowing for track evolution" aria-pressed="true"/);
  assert.equal((html.match(/performance-chart-card/g) || []).length, 2);
  assert.match(html, /0\.500% <span class="perf-tercile-badge is-mid">Provisional estimate<\/span><small>LEC · 3\/3 races supported<\/small>/);
  assert.match(html, /0\.4–0\.7%<small>3 deletion fits<\/small>/);
  assert.match(html, />89\.123</);
});

test('tyre trend view: toolbar per mode, compound pills, stint plot and run picker', () => {
  const team = {team: 'Ferrari', color: '#ff0000'};
  const relative = render(views.TyresView, {metric: 'relative', subject: 'team', compound: {choices: ['OVERALL', 'C3', 'C4', 'C5'], value: 'C4', overallLabel: 'All compounds'},
    chart: {rows: [{...team, normSlope: .02}], options: {valueKey: 'normSlope', unit: ' s/lap'}},
    sort: {team: sortModel('tyreTeam'), norm: sortModel('tyreNorm'), stints: sortModel('tyreStints')},
    rows: [{team, norm: {value: .02, provisional: 'Provisional · 2/3 supported events'}, ageRange: 'L1–L20 (20 laps)', sample: '4 matched stints (60 laps)', observed: 6, fieldSupported: true, compound: 'S: 40% · M: 60%', notes: ['1 matched stint on used tyres']}]});
  assert.equal((relative.match(/data-tyre-metric=/g) || []).length, 2);
  assert.doesNotMatch(relative, /data-tyre-subject=/, 'matched rivals has no subject switch');
  assert.equal((relative.match(/data-tyre-compound=/g) || []).length, 4);
  assert.match(relative, /data-tyre-compound="C4" aria-pressed="true"/);
  assert.match(relative, /aria-labelledby="performanceTyreCompoundLabel"/);
  assert.match(relative, /\+0\.020 s\/lap<small>Provisional · 2\/3 supported events<\/small>/);
  const plot = {title: 'LEC · Bahrain Grand Prix · C3 · stint 2', teamColor: '#ff0000', empty: false, noTrend: false, caption: 'Recorded times · dots are laps',
    exclusions: {pressed: false, label: 'Show 1 excluded lap'}, axis: {lo: 1, hi: 20, grid: [{y: 180, label: '0.000'}]}, curve: 'M 55 170 L 645 40',
    points: [{cx: 55, cy: 170, title: 'Lap 3 · age 1'}], excluded: [], laps: [{lap: 3, age: 1, time: 95.2, status: 'Used'}]};
  const age = render(views.TyresView, {metric: 'age', subject: 'driver', note: 'n', compound: {choices: ['OVERALL', 'C3'], value: 'OVERALL', overallLabel: 'All C grades'},
    correction: 'fuel', correctionText: 'Assumes 0.060 s/lap fuel gain', quality: 'q', commonCoverage: null, coverage: {mapped: 3, loaded: 3, unmapped: 0, source: 'https://press.pirelli.com/'},
    legacy: false, chart: {title: 'Tyre-age lap-time change', rows: [{...team, value: -.01}], extent: .02}, emptyMessage: '',
    sort: {name: sortModel('tyreAgeName'), value: sortModel('tyreAgeValue'), events: sortModel('tyreAgeEvents'), stints: sortModel('tyreAgeStints'), laps: sortModel('tyreAgeLaps')},
    rows: [{team, value: null, shortfall: 'C3: 3/4 GPs', events: 3, stints: 4, laps: 40, outliers: 1, coverage: '1 C grade'}],
    picker: {teams: ['Ferrari'], team: 'Ferrari', drivers: ['LEC'], driver: 'LEC', events: ['Bahrain Grand Prix'], event: 'Bahrain Grand Prix', runs: [{key: 'k', label: 'Stint 2'}], run: 'k', total: 1, teamCount: 1},
    plot, evidence: [], auditOpen: true});
  assert.equal((age.match(/data-tyre-metric=/g) || []).length + (age.match(/data-tyre-subject=/g) || []).length, 4);
  assert.match(age, /data-tyre-subject="driver" aria-pressed="true"/);
  assert.match(age, /performance-tyre-age-bar" style="--bar-color:#ff0000;left:25\.00%;width:25\.00%"/);
  assert.match(age, /—<small>P75 needs C3: 3\/4 GPs<\/small>/);
  assert.match(age, /<select data-tyre-plot-filter="team">/);
  assert.match(age, /stroke-dasharray="6 4"/);
  assert.match(age, /data-tyre-exclusions="" aria-pressed="false">Show 1 excluded lap/);
  assert.match(age, /<details class="dashboard-card performance-methods" open="">/);
});
