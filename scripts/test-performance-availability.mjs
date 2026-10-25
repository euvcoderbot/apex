import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync('car-performance.js','utf8');
const rules=source.slice(source.indexOf('function performanceSessionTime'),source.indexOf('function syncSelect'));
function harness(){const box={};vm.createContext(box);vm.runInContext(rules,box);return box;}
const start=Date.parse('2026-10-24T21:00:00Z'),end=start+3600000;
const event=(status='')=>({name:'United States Grand Prix',session_dates:{Qualifying:new Date(start).toISOString()},
  session_end_dates:{Qualifying:new Date(end).toISOString()},session_statuses:{Qualifying:status}});

test('qualifying is requestable at its start with no four-hour wait, including stale upcoming metadata',()=>{
  const h=harness();
  for(const status of ['', 'unknown','upcoming','live','started','running','interrupted','suspended']){
    assert.equal(h.sessionAvailable(event(status),'Qualifying',start+1),true,status);
    if(!['live','started','running','interrupted','suspended'].includes(status))
      assert.equal(h.sessionAvailable(event(status),'Qualifying',start-1),false,status);
  }
  assert.doesNotMatch(source,/4\s*\*\s*3600000/);
});

test('confirmed completion makes data eligible immediately; cancelled and unknown future sessions stay out',()=>{
  const h=harness();
  assert.equal(h.sessionAvailable({session_statuses:{Qualifying:'completed'}},'Qualifying',start),true);
  for(const status of ['cancelled','canceled','aborted'])assert.equal(h.sessionAvailable(event(status),'Qualifying',end),false);
  assert.equal(h.sessionAvailable({},'Qualifying',end),false);
  assert.equal(h.sessionAvailable(event('upcoming'),'Race',end),false,'qualifying availability does not unlock the future race');
});

test('completion is separate from permission to request partial observations',()=>{
  const h=harness();
  assert.equal(h.completed(event('completed'),'Qualifying',start+1000),true);
  assert.equal(h.completed(event('live'),'Qualifying',end+1000),false,'an explicit live flag is not a final result');
  assert.equal(h.completed(event(),'Qualifying',end),true,'dated historical calendars need no extra delay');
  assert.equal(h.completed(event(),'Qualifying',end-1),false);
  assert.equal(h.completed({session_dates:{Qualifying:new Date(start).toISOString()}},'Qualifying',end),false,'a start alone cannot establish completion');
});

test('timezone-free provider dates use UTC; explicit offsets survive normalization',()=>{
  const h=harness();
  for(const timestamp of ['2026-10-24 21:00:00','2026-10-24T21:00:00','2026-10-24 21:00:00+00:00','2026-10-25T02:30:00+05:30'])
    assert.equal(h.performanceSessionTime(timestamp),start,timestamp);
  for(const timestamp of [null,'','not a date'])assert.ok(Number.isNaN(h.performanceSessionTime(timestamp)));
});

test('live and explicitly incomplete payloads get a provisional notice; final completed results do not',()=>{
  const h=harness();
  assert.deepEqual(Array.from(h.provisionalPerformanceSessions([{...event('live'),Q:{teams:[]}}],start+1000)),['United States Grand Prix · Qualifying']);
  assert.deepEqual(Array.from(h.provisionalPerformanceSessions([{...event('completed'),Q:{complete:false}}],end)),['United States Grand Prix · Qualifying']);
  assert.deepEqual(Array.from(h.provisionalPerformanceSessions([{...event('completed'),Q:{teams:[]}}],end)),[]);
  assert.deepEqual(Array.from(h.provisionalPerformanceSessions([event('live')],start+1000)),[],'failed requests are not fabricated provisional results');
  assert.match(source,/provisional\.map\(escape\)/);
  assert.match(source,/provisionalNotice\+sourceNotice\+errorMarkup/);
});

test('an open calendar can reveal a newly started session without refetching data or losing selection',()=>{
  const h=harness();let now=start-1,paints=0;
  class Clock extends Date{static now(){return now;}}
  Object.assign(h,{Date:Clock,calendarInventory:[event('upcoming')],calendar:[],calendarLoading:false,
    selectedTracks:new Set(['Existing selection']),renderTrackPills:()=>paints++});
  vm.runInContext(source.slice(source.indexOf('function refreshPerformanceAvailability'),source.indexOf('// Only re-evaluate')),h);
  h.refreshPerformanceAvailability();assert.equal(h.calendar.length,0);
  now=start;h.refreshPerformanceAvailability();assert.equal(h.calendar.length,1);assert.equal(paints,1);
  h.refreshPerformanceAvailability();assert.equal(paints,1,'unchanged lists are not rebuilt');
  assert.equal(h.selectedTracks.has('Existing selection'),true);
});
