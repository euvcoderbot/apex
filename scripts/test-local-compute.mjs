import {appSource} from './app-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {request as httpRequest} from 'node:http';
import postcss from 'postcss';
import {createLocalDashboard} from '../lib/local-server.mjs';
test('local processing uses only loopback Python and disk hits survive a new server',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'apex-local-test-')),root=path.join(directory,'public'),cacheRoot=path.join(directory,'cache');
  await mkdir(root);await writeFile(path.join(root,'index.html'),'<h1>Local dashboard</h1>');await writeFile(path.join(root,'config.js'),'window.APEX_API_ORIGIN = "https://apex-telemetry-api.vercel.app";\nwindow.APEX_DATA_VERSION = "test";');
  let calls=0;
  const fetcher=async url=>{calls++;assert.equal(new URL(url).origin,'http://127.0.0.1:8000');return Response.json([{name:'Test Grand Prix',round:1}]);};
  let local;
  const start=async fn=>{local=createLocalDashboard({root,cacheRoot,fetcher:fn});local.server.listen(0,'127.0.0.1');await once(local.server,'listening');return 'http://127.0.0.1:'+local.server.address().port;};
  try{
    let origin=await start(fetcher);
    const query='/api/data?'+new URLSearchParams({path:'/api/events?year=2025'});
    let response=await fetch(origin+query);assert.equal(response.status,200);assert.equal(response.headers.get('x-apex-compute'),'local');assert.equal(response.headers.get('x-data-cache'),'MISS');await response.json();assert.equal(calls,1);
    assert.equal((await fetch(origin+'/api/local-status').then(r=>r.json())).mode,'local');
    const config=await fetch(origin+'/apex/config.js').then(r=>r.text());assert.match(config,/APEX_API_ORIGIN = ''/);assert.match(config,/APEX_LOCAL_MODE = true/);assert.doesNotMatch(config,/vercel\.app/);
    assert.equal((await fetch(origin+'/server.py')).status,404);
    assert.equal((await fetch(origin+'/api/data?path=https://evil.test/api/events?year=2025')).status,502);
    const hostile=await new Promise((resolve,reject)=>{const r=httpRequest(origin+'/api/local-status',{headers:{Host:'attacker.test'}},res=>{res.resume();resolve(res.statusCode);});r.once('error',reject);r.end();});
    assert.equal(hostile,403);
    assert.equal((await fetch(origin+'/api/data',{method:'POST',headers:{Origin:'https://attacker.test'},body:'{}'})).status,403);
    await new Promise(resolve=>local.server.close(resolve));
    origin=await start(async()=>{throw new Error('Second launch must not contact any source');});
    response=await fetch(origin+query);assert.equal(response.status,200);assert.equal(response.headers.get('x-data-cache'),'HIT');await response.json();assert.equal(calls,1);
  }finally{await new Promise(resolve=>local.server.close(resolve));await rm(directory,{recursive:true,force:true});}
});
test('local compute refuses a public backend and source delivery includes a discoverable local mode',async()=>{
  assert.throws(()=>createLocalDashboard({root:'.',cacheRoot:'.',sourceOrigin:'https://apex-telemetry-api.vercel.app'}),/loopback/);
  const page=await readFile('index.html','utf8'),runner=await readFile('scripts/start-local.mjs','utf8'),precompute=await readFile('scripts/precompute-local.mjs','utf8');
  assert.match(page,/Use local compute/);assert.match(runner,/'--host','127.0.0.1'/);assert.match(runner,/sourceOrigin/);assert.match(runner,/windowsHide:true/);
  assert.doesNotMatch(precompute,/https:\/\/apex-telemetry/);assert.match(precompute,/fastestTeamTelemetrySelections\(q.teams\)/);
});
test('compact layout has normal-flow sidebars, no selected blue blocks and vector-only sorting',async()=>{
  const css=await readFile('macos-ui.css','utf8'),app=await readFile('car-performance.js','utf8');
  assert.match(css,/main #driverSidebar \{[^}]*position: static/);
  assert.match(css,/main #driverSidebar > \.dashboard-card \{[^}]*position: static/);
  assert.match(css,/#performanceResults > \.performance-toolbar \{ position: static/);
  assert.match(css,/#driverSidebar #driverPills \{[^}]*overflow-x: hidden/);
  assert.match(css,/\.sector-cards \.lap-summary-card \{ display: grid/);
  const sort=app.slice(app.indexOf('function sortHeader('),app.indexOf('function sorted('));
  assert.doesNotMatch(sort,/[⇅▲▼]/);assert.match(sort,/<svg class="sort-icon"/);assert.match(app,/aria-sort="ascending"/);
  const controls=postcss.parse(await readFile('car-performance.css','utf8'));
  controls.walkRules(rule=>{if(rule.selector==='.performance-controls')rule.walkDecls('grid-template-columns',decl=>assert.ok(!decl.important,'Responsive grid must not be locked by a legacy !important'));});
});

test('context actions belong to their headings and selectable laps expose their state',async()=>{
  const page=await readFile('index.html','utf8'),app=appSource(),presentation=await readFile('dashboard-ui.js','utf8'),css=await readFile('macos-ui.css','utf8');
  assert.match(page, /class="site-header window-toolbar">[\s\S]*?class="workspace-tools"[\s\S]*?<\/header>/);
  assert.doesNotMatch(page, /id="sidebarToggle"|Hide drivers/);
  // Display tools stay in the window toolbar for both views instead of moving between page intros.
  assert.doesNotMatch(presentation,/append\(workspaceTools\)/);assert.match(presentation,/setWindowTitle\(button\.dataset\.analysisView\)/);
  assert.match(page, /id="lapWorkspaceActions"/);
  assert.match(app,/replaceUI\(actions, toolbar\)/);assert.doesNotMatch(app,/toolbar \+ cards/);
  assert.match(page, /<h2 id="cornerAnalysisTitle"><button[^>]+aria-expanded="true"[^>]*><i[^>]*><\/i><span>Corner performance/);
  assert.doesNotMatch(app,/collapsed \? 'Expand' : 'Collapse'/);
  assert.match(app,/class="\$\{classes\}" aria-pressed="\$\{isLoaded\}"/);
  assert.match(css,/#driverSidebar #driverPills:has\(> \.section-empty\) \{[^}]*overflow: visible/);
  assert.match(css,/\.trace-pill-group \.trace-driver-chip input\[type="checkbox"\] \{[^}]*position: static/);
});

test('startup pruning removes only unreadable revisions and long-expired entries',async()=>{
  const {diskStore,pruneDiskStore}=await import('../lib/local-server.mjs');
  const {SOURCE_VERSION,DATA_VERSION}=await import('../lib/data-cache.mjs');
  const directory=await mkdtemp(path.join(os.tmpdir(),'apex-prune-test-')),store=diskStore(directory),now=Date.now();
  const entry=expires=>({data:{teams:[{team:'A'}]},expires,bytes:10});
  const day=86400000;
  await store.write(DATA_VERSION+':/api/performance?gp=A&session=Q&year=2026',entry(now+60*day));
  await store.write(SOURCE_VERSION+':/api/events?year=2026',entry(now-day)); // recently expired: still consulted
  await store.write('data:0000000000stale0000:/api/performance?gp=A&session=Q&year=2026',entry(now+60*day));
  await store.write(DATA_VERSION+':/api/performance?gp=B&session=Q&year=2026',entry(now-30*day));
  await writeFile(path.join(directory,'notes.json'),'{"key":"data:old:/x"}'); // not a cache entry name
  assert.equal((await pruneDiskStore(directory,{now,dryRun:true})).removed,1);
  let result=await pruneDiskStore(directory,{now});
  assert.equal(result.removed,1,'only the long-expired entry; a recent old revision may belong to another branch');
  assert.ok(await store.read('data:0000000000stale0000:/api/performance?gp=A&session=Q&year=2026'));
  result=await pruneDiskStore(directory,{now:now+15*day});
  assert.equal(result.removed,2,'two weeks untouched: the old revision goes, and the calendar has expired for over a week');
  assert.ok(await store.read(DATA_VERSION+':/api/performance?gp=A&session=Q&year=2026'));
  await assert.rejects(()=>store.read('data:0000000000stale0000:/api/performance?gp=A&session=Q&year=2026'));
  assert.ok(await readFile(path.join(directory,'notes.json'),'utf8'));
  await rm(directory,{recursive:true,force:true});
});
