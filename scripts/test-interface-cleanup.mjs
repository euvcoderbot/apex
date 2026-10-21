import {performanceSource,offersControl} from './view-source.mjs';
import {appSource} from './app-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const car=readFileSync('car-performance.js','utf8'),app=appSource();

test('experimental and legacy methodology switches have no UI or event handlers',()=>{
  for(const key of ['acceleration-comparison','straight-entry','corner-comparison','corner-window',
    'race-corner-model','race-pace-model','telemetry-stat','telemetry-coverage','tyre-fit','tyre-coverage',
    'tyre-stat','tyre-condition','tyre-laps','tyre-fuel','tyre-weighting','pit-visits','trend-chart'])
    assert.doesNotMatch(car,new RegExp('data-'+key+'(?:=|\\])'));
  assert.doesNotMatch(car,/data-qualy-mode="condition"/);
  for(const stat of ['p10','p90','trimmed','winsorized'])assert.doesNotMatch(car,new RegExp('data-pit-chart="'+stat+'"'));
  assert.doesNotMatch(app,/id="(?:interpolationToggle|tintToggle)"/);
  assert.doesNotMatch(app,/\$\('#(?:interpolationToggle|tintToggle)'\)/);
});

test('useful task and interpretation controls remain available',()=>{
  for(const key of ['telemetry-subject','corner-session','corner-band',
    'pit-measure','pit-subject','pit-chart','pit-lane-basis','tyre-metric','tyre-subject','tyre-correction','trend-view'])
    assert.ok(offersControl(performanceSource(),key),key);
  // Reliability & results is a React view: a segmented control of data-results-chart buttons.
  const resultsView=readFileSync('src/views/ResultsView.tsx','utf8'),segmented=readFileSync('src/components/SegmentedControl.tsx','utf8');
  assert.match(resultsView,/<SegmentedControl name="results-chart"/);
  assert.match(segmented,/<button[^>]+\{\.\.\.\{\[attribute\]: key\}\} aria-pressed=/);
  for(const id of ['cornerToggle','speedAnnotationToggle'])assert.match(app,new RegExp('id="'+id+'"'));
  assert.match(car,/Assumes 0\.060 s\/lap fuel gain; not measured fuel/);
  assert.match(car,/Retained session sources/);
  assert.match(readFileSync('car-performance.css','utf8'),/\.performance-quality-status button[\s\S]*?background: var\(--surface-muted\)/);
});


test('tyre subject and metric selector uses a single consistent season summary',()=>{
  // The toolbar is drawn by src/views/TyresView.tsx (rendered in test-react-views.mjs).
  const tyres=readFileSync('src/views/TyresView.tsx','utf8');
  assert.match(tyres,/name="tyre-metric"[^>]*\[\['age', 'Tyre-age trend'\], \['relative', 'Matched rivals'\]\]/);
  assert.match(tyres,/p\.metric === 'age' \? <SegmentedControl name="tyre-subject"/);
  assert.match(car,/const tyreSeasonStat='median'/);
  assert.match(car,/const telemetrySeasonStat='mean'/);
});
