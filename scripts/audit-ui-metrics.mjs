// Real replay results through the same browser aggregation, without DOM mocks.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const evidence=JSON.parse(readFileSync(process.argv[2],'utf8'));
const source=readFileSync('car-performance.js','utf8');
const body=source.slice(source.indexOf('function eventTelemetry(event)'),source.indexOf('// Circuit Discrepancy Reconciliation Box'));
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const avg=a=>{const values=a.filter(finite);return values.length?values.reduce((s,v)=>s+v,0)/values.length:null;};
const median=a=>{const values=a.filter(finite).sort((a,b)=>a-b);return values.length?(values[Math.floor((values.length-1)/2)]+values[Math.ceil((values.length-1)/2)])/2:null;};
const sandbox={finite,avg,median,brakingQualityMode:'supported',telemetryCoverageMode:'common',
  STRAIGHT_BANDS:['50_100','100_150','150_200','200_250','250_300','300_320','300_350','350_400'],context:{season:true},events:[]};
vm.createContext(sandbox);vm.runInContext(body,sandbox);
for(const year of [2018,2021,2025,2026]){
  sandbox.events=evidence.events.filter(e=>e.year===year).map(e=>({name:e.gp,Q:e.Q,R:e.R,traces:e.baseline?.teams||{}}));
  for(const mode of ['common','inferred']){
    sandbox.telemetryCoverageMode=mode;
    const start=performance.now();
    const result=sandbox.seasonTelemetry('mean');
    const duration=performance.now()-start;
    for(const team of result)for(const value of Object.values(team.adjusted))assert.ok(value===null||finite(value));
    console.log(JSON.stringify({year,mode,teams:result.length,milliseconds:Math.round(duration),rankingSupport:result.rankCoverage}));
    assert.ok(duration<3000,'aggregation must not stall the browser for seconds');
  }
}
