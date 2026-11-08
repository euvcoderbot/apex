import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
// local-compute.js on the published site: compute on the person's PC, only once they chose it.
const source = readFileSync('local-compute.js', 'utf8');
function page({reachable = true, choice} = {}) {
  const storage = new Map(choice ? [['apex-compute', choice]] : []), requests = [], streams = [], events = [], timers = new Set();
  const node = () => ({textContent: '', hidden: false, title: '', dataset: {}, attrs: {}, listeners: {},
    setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(k, fn) { this.listeners[k] = fn; }});
  const parts = Object.fromEntries(['status', 'use', 'start', 'off'].map(name => [name, node()]));
  const panel = {...node(), querySelector: selector => parts[/data-compute-(\w+)/.exec(selector)[1]]};
  const trigger = node();
  let up = reachable, reloads = 0;
  const window = {addEventListener() {}, dispatchEvent: e => events.push(e)};
  const sandbox = {
    window, Promise, JSON, URL, AbortSignal, CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    crypto: {randomUUID: () => 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'},
    localStorage: {getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v)},
    document: {getElementById: id => (id === 'computeSettings' ? panel : null), querySelector: s => (s === '[popovertarget="computeSettings"]' ? trigger : null)},
    location: {reload: () => reloads++},
    EventSource: class { constructor(url) { streams.push(url); } close() {} },
    setInterval: fn => { timers.add(fn); return fn; }, clearInterval: fn => timers.delete(fn),
    fetch: async (url, options = {}) => { requests.push([url, options.method || 'GET']); if (!up) throw new Error('not reachable'); return Response.json({mode: 'local', activeTabs: 1}); },
  };
  vm.runInNewContext(source, sandbox);
  const flush = () => new Promise(resolve => setImmediate(resolve));
  return {window, parts, panel, trigger, storage, requests, streams, events, timers, flush, ready: () => window.apexComputeReady,
    bringUp: () => { up = true; }, reloads: () => reloads};
}

test('without a choice, nothing on the PC is contacted and published data is shown', async () => {
  const p = page();
  assert.equal(await p.ready(), false);
  assert.equal(p.requests.length, 0, 'no request to 127.0.0.1, so visitors are never asked for local network access');
  assert.equal(p.window.APEX_COMPUTE_ORIGIN, undefined);
  assert.equal(p.panel.dataset.state, 'off');
  assert.equal(p.parts.use.hidden, false);
});

test('once chosen, each visit connects before the first request, holds a lease and announces the PC', async () => {
  const p = page({choice: 'local'});
  assert.equal(await p.ready(), true);
  assert.equal(p.window.APEX_COMPUTE_ORIGIN, 'http://127.0.0.1:54123');
  assert.equal(p.requests[0][0], 'http://127.0.0.1:54123/api/local-status');
  await p.flush();
  assert.deepEqual(p.requests[1], ['http://127.0.0.1:54123/api/local-tab', 'POST']);
  assert.match(p.streams[0], /^http:\/\/127\.0\.0\.1:54123\/api\/local-tab-stream\?id=/);
  assert.equal(p.events[0].type, 'apex-compute');
  assert.equal(p.trigger.attrs['data-compute'], 'local');
  assert.equal(p.parts.off.hidden, false);
});

test('a PC that is not running offers the launcher, and connects as soon as compute answers', async () => {
  const p = page({choice: 'local', reachable: false});
  assert.equal(await p.ready(), false);
  assert.equal(p.panel.dataset.state, 'offline');
  assert.equal(p.parts.start.hidden, false);
  p.parts.start.listeners.click();
  assert.equal(p.timers.size, 1);
  p.bringUp();
  await [...p.timers][0]();
  assert.equal(p.window.APEX_COMPUTE_ORIGIN, 'http://127.0.0.1:54123');
  assert.equal(p.timers.size, 0);
});

test('Use this PC remembers the choice; Stop using this PC goes back to published data', async () => {
  const p = page();
  await p.ready();
  p.parts.use.listeners.click();
  await p.flush(); await p.flush();
  assert.equal(p.storage.get('apex-compute'), 'local');
  assert.equal(p.window.APEX_COMPUTE_ORIGIN, 'http://127.0.0.1:54123');
  p.parts.off.listeners.click();
  assert.equal(p.storage.get('apex-compute'), 'off');
  assert.equal(p.reloads(), 1);
});
