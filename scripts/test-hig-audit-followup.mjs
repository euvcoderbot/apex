import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import postcss from 'postcss';
import {UI_STYLES,buildUiStyles} from '../lib/ui-style-build.mjs';
const read=file=>readFileSync(file,'utf8');

test('expanded charts isolate only background siblings and restore pre-existing state and focus',()=>{
  function node(name,inert=false){return {name,inert,children:[],attrs:{},setAttribute(k,v){this.attrs[k]=v;},removeAttribute(k){delete this.attrs[k];}};}
  function append(parent,...children){parent.children.push(...children);children.forEach(child=>child.parentElement=parent);}
  const body=node('body'),header=node('header'),main=node('main'),footer=node('footer'),sidebar=node('sidebar',true),analysis=node('analysis'),workspace=node('workspace'),telemetry=node('telemetry'),heading=node('heading'),charts=node('charts'),tooltip={...node('tooltip'),style:{}};
  append(body,header,main,footer);append(main,sidebar,analysis);append(analysis,workspace,telemetry);append(telemetry,heading,charts,tooltip);
  const classes=new Set();body.classList={contains:c=>classes.has(c),toggle(c,on){on?classes.add(c):classes.delete(c);}};
  let restored=0,focused=0;const origin={isConnected:true,focus(){restored++;}},close={focus(){focused++;}},open={setAttribute(){}};
  const elements={'#charts':charts,'#realTooltip':tooltip,'[data-trace-focus="open"]':open,'[data-trace-focus="close"]':close};
  const box={document:{body,activeElement:origin},$:selector=>elements[selector],traceZoom:{start:.2,end:.6},timingDeltaZoom:2,hoverFraction:.4,updateZoomReadout(){},updateTimingDeltaZoomReadout(){},requestAnimationFrame(){}};
  vm.createContext(box);const source=read('session-charts.js');
  vm.runInContext(source.slice(source.indexOf('let traceFocusReturn'),source.indexOf("document.addEventListener('keydown'")),box);
  box.setTraceFocus(true);
  assert.equal(charts.attrs.role,'dialog');assert.equal(charts.attrs['aria-modal'],'true');assert.equal(focused,1);
  for(const background of [header,footer,sidebar,workspace,heading,tooltip])assert.equal(background.inert,true,background.name);
  for(const ancestor of [body,main,analysis,telemetry,charts])assert.equal(ancestor.inert,false,ancestor.name);
  assert.equal(box.traceZoom.start,0);box.setTraceFocus(false);
  for(const background of [header,footer,workspace,heading,tooltip])assert.equal(background.inert,false,background.name);
  assert.equal(sidebar.inert,true,'an already inert sidebar stays inert');assert.equal(restored,1);
  assert.equal(box.traceZoom.start,.2);assert.equal(box.traceZoom.end,.6);assert.equal(charts.attrs['aria-modal'],undefined);
});

test('keyboard telemetry readout keeps estimates, partial-lap delta and visible trace identity',()=>{
  const nodes=Object.fromEntries(['telemetryDataAccess','telemetrySample','telemetrySampleDistance','telemetrySampleRows','telemetrySampleStatus','year'].map(id=>[id,{open:true,value:id==='year'?'2026':'250',setAttribute(k,v){this[k]=v;}}]));
  const reference={code:'VER',lap:1},partial={code:'LEC',lap:2,real:{out_lap:true}},calls=[];
  const series=[{Distance:0},{Distance:6000}];
  const box={$:s=>nodes[s.slice(1)],loaded:[reference,partial],telemetryCache:new Map([['VER',series],['LEC',series]]),telemetryKey:l=>l.code,
    visibleTraceLaps:()=>[{lap:reference,index:0},{lap:partial,index:1}],traceTelemetryValue:(samples,fraction,field)=>{calls.push([fraction,field]);return field==='Speed'?301.25:75;},
    interpolate:(samples,distance,field)=>field==='Brake'?0:8,isReconstructedTelemetry:(samples,fraction,field)=>field==='Speed',telemetryEstimateInfo:()=>({confidence:'low'}),escapeUI:s=>s,displayDeltaAt:()=>.1};
  vm.createContext(box);const source=read('session-charts.js');
  vm.runInContext(source.slice(source.indexOf('function renderTelemetryReadout'),source.indexOf('function deltaAt')),box);box.renderTelemetryReadout();
  assert.equal(nodes.telemetrySampleDistance.textContent,'1.500 km');assert.equal(nodes.telemetrySample['aria-valuetext'],'1.500 km');
  assert.match(nodes.telemetrySampleRows.innerHTML,/VER L1 \(reference\)/);assert.match(nodes.telemetrySampleRows.innerHTML,/~301\.250 \(low confidence\)/);
  assert.match(nodes.telemetrySampleRows.innerHTML,/<td>\+0\.000<\/td>/);assert.match(nodes.telemetrySampleRows.innerHTML,/LEC L2<\/th><td>[^<]+<\/td><td>—<\/td>/);
  assert.ok(calls.every(([fraction])=>fraction===.25));assert.equal(nodes.telemetrySample.disabled,false);
});

test('the final system layer owns touch density without shrinking source rows or sliding thumbs',()=>{
  assert.deepEqual(UI_STYLES.at(-1),['hig-system.css','system']);
  const sheet=postcss.parse(read('hig-system.css')),coarse=sheet.nodes.findLast(n=>n.type==='atrule'&&n.params==='(pointer:coarse)');
  const values={};coarse.walkDecls(d=>values[d.prop]=d.value);
  for(const token of ['--hig-regular','--hig-small','--hig-large','--hig-thumb','--hig-menu-row'])assert.equal(values[token],'44px');
});
