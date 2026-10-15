// Frozen numerical regressions. Run against the baseline before editing maths.
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync('car-performance.js','utf8');
const finite=Number.isFinite,avg=a=>a.reduce((s,v)=>s+v,0)/a.length;
const median=a=>{a=[...a].sort((a,b)=>a-b);return (a[(a.length-1)>>1]+a[a.length>>1])/2;};
const box={finite,avg,median};vm.createContext(box);
vm.runInContext(source.slice(source.indexOf('function eventAdjustedScores('),source.indexOf('function seasonTelemetry(')),box);
const reports=Array.from({length:20},(_,j)=>({event:{name:'GP'+j},summary:{rows:new Map(Array.from({length:3},(_,k)=>{const i=j+k;return ['D'+i,{team:'D'+i,value:j*.1+i*.01}];}))}}));
const chain={};for(const mode of ['mean','median']){const start=performance.now(),scores=box.eventAdjustedScores(reports,r=>r.value,mode,'inferred');
  chain[mode]={maxError:Math.max(...[...scores].map(([d,v])=>Math.abs(v-Number(d.slice(1))*.01))),last:scores.get('D21'),milliseconds:performance.now()-start,diagnostics:scores.diagnostics};}
const core={};vm.createContext(core);vm.runInContext(fs.readFileSync('analysis-core.js','utf8'),core);
const result={source:process.argv[3]||'working-tree',chain,drs:Object.fromEntries([0,1,2,3,8,9,10,11,12,14].map(v=>[v,core.ApexAnalysis.observedDRS(v)]))};
if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify(result,null,2));
console.log(JSON.stringify(result));
