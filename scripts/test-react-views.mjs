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
