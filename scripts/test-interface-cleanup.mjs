import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const car=readFileSync('car-performance.js','utf8'),app=readFileSync('app.js','utf8');

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
  for(const key of ['telemetry-subject','corner-session','corner-band','straight-source','straight-unit',
    'pit-measure','pit-subject','pit-chart','pit-lane-basis','tyre-metric','tyre-subject','tyre-correction','trend-view'])
    assert.match(car,new RegExp('data-'+key+'='));
  assert.match(car,/<select[^>]+data-results-chart-select/);
  for(const id of ['cornerToggle','speedAnnotationToggle'])assert.match(app,new RegExp('id="'+id+'"'));
  assert.match(car,/Assumes 0\.060 s\/lap fuel gain; not measured fuel/);
  assert.match(car,/Retained session sources/);
  assert.match(readFileSync('car-performance.css','utf8'),/\.performance-quality-status button[\s\S]*?background: var\(--surface-muted\)/);
});

test('acceleration keeps speed-band selection without methodology choices',()=>{
  const start=car.indexOf('function straightBandControls('),end=car.indexOf("let qualyPaceMode",start);
  const box={telemetrySubject:'team',straightBand:'200_250',STRAIGHT_BANDS:['100_150','200_250','250_300']};
  vm.createContext(box);vm.runInContext(car.slice(start,end),box);
  const html=box.straightBandControls(['200_250']);
  assert.equal((html.match(/<option/g)||[]).length,3);
  assert.match(html,/<select[^>]+data-straight-band-select/);
  assert.match(html,/<option value="200_250" selected/);
  assert.match(html,/<option value="100_150"[^>]+disabled/);
  assert.doesNotMatch(html,/diagnostic|strict|Common observed/);
});

test('tyre subject and metric selector uses a single consistent season summary',()=>{
  const start=car.indexOf('function tyreViewControls()'),end=car.indexOf('function tyreStintKey(',start);
  const box={tyreMetric:'age',tyreSubject:'team'};vm.createContext(box);vm.runInContext(car.slice(start,end),box);
  assert.equal((box.tyreViewControls().match(/<button/g)||[]).length,4);
  box.tyreMetric='relative';assert.equal((box.tyreViewControls().match(/<button/g)||[]).length,2);
  assert.match(car,/const tyreSeasonStat='median'/);
  assert.match(car,/const telemetrySeasonStat='mean'/);
});
