import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {finite,avg,median} from '../performance-format.js';

test('development medians, sparkline and fit share inputs and keep observed/fitted changes separate',()=>{
  const source=readFileSync('car-performance.js','utf8');
  const values=[.5571970758297518,.5278936392075106,.39874743742818186,.43850657190369624,.20805202678497725,.6301092281855825,.450420258187334,.48023837974375816,.8693579689255548,.4216134379701142,0,0,.16517196236525145,.10029215540923175,.8173536468798259,.5665930831493693,.40128278924429495];
  const q=values.map((adjusted,i)=>({round:i+1,event:'GP '+(i+1),adjusted,pace:9}));
  const box={finite,avg,median,events:q.map(v=>({round:v.round})),context:{season:true},trendView:'fitted',
    sorted:rows=>rows,sortHeaderModel:()=>null,reactView:(_,props)=>props};
  vm.createContext(box);
  vm.runInContext(source.slice(source.indexOf('function huberRegression('),source.indexOf('function eventAdjustedScores(')),box);
  const model=box.renderTrend([{team:'McLaren',q}]),row=model.rows[0];
  assert.deepEqual(Array.from(row.points,p=>p.pace),values,'never plot the unrelated raw series');
  assert.equal(row.count,17);
  assert.ok(Math.abs(row.change-.0007378306412286761)<1e-10);
  assert.ok(Math.abs(row.fittedChange-(-.14097037370921486))<1e-10);
  assert.ok(Math.abs(row.fittedChange-row.slopePerRound*16)<1e-10);
  assert.ok(Math.abs(row.fit[1].pace-row.fit[0].pace-row.fittedChange)<1e-10);
  assert.equal(model.spark.ceiling,1,'shared chart scale uses the same adjusted observations');
  box.trendView='observed';
  const observed=box.renderTrend([{team:'McLaren',q}]).rows[0];
  assert.equal(observed.change,row.change,'ranking choice does not change the reported endpoint change');
  assert.equal(observed.fittedChange,row.fittedChange);
});
