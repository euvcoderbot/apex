import {gunzipSync} from 'node:zlib';
export const object = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
export function validateIndex(index,folder){
  if(!object(index)||!object(index.entries))throw Error(`Invalid ${folder} index: entries object required`);
  const schema=folder==='local-captures'?'apex-local-captures-v1':folder==='prerendered'?undefined:'native-lap-packs-v1';
  if(index.schema!==schema)throw Error(`Unsupported ${folder} schema: ${index.schema}`);
}
export function decodeSnapshot(bytes,{maximum=128*1024*1024}={}){
  if(bytes.length>32*1024*1024)throw Error('Compressed snapshot exceeds release budget');
  const value=JSON.parse(gunzipSync(bytes,{maxOutputLength:maximum}));
  if(!value||typeof value!=='object')throw Error('Invalid snapshot object');
  return value;
}
export function validatePayload(value,folder,route=''){
  const pathname=route?new URL(route,'http://release.invalid').pathname:'';
  if(folder==='telemetry'||folder==='local-telemetry'){
    if(!object(value)||!object(value.laps))throw Error('Native lap pack requires a laps object');
    for(const lap of Object.values(value.laps))if(!object(lap)||!Array.isArray(lap.samples))throw Error('Native lap requires samples array');
  }else if(pathname==='/api/session'){
    if(!object(value)||!Array.isArray(value.drivers))throw Error('Session snapshot requires drivers array');
  }else if(pathname==='/api/events'){
    if(!Array.isArray(value))throw Error('Calendar snapshot requires events array');
  }else if(pathname==='/api/performance'){
    if(!object(value)||!Array.isArray(value.teams)||typeof value.method!=='string')throw Error('Performance snapshot requires teams and method');
  }else if(!object(value))throw Error('API snapshot requires an object');
}
// Season hub snapshots (scripts/snapshot-season.mjs, assets/data/season): keyed by the API path the page asks for,
// one saved file each. The hosted site reads them first, so they must be complete and for the year they claim.
export const SEASON_ROUTE = /^\/api\/season(?:\/upgrades|\/power-units)?\?year=(\d{4})$/;
export function validateSeasonIndex(index) {
  if (!object(index) || !object(index.entries)) throw Error('Invalid season index: entries object required');
  for (const [route, entry] of Object.entries(index.entries)) {
    const match = SEASON_ROUTE.exec(route);
    if (!match || +match[1] < 1950 || +match[1] > 2100) throw Error('Unsupported season route: ' + route);
    if (!object(entry) || !/^[a-f0-9]{24}\.json\.gz$/.test(entry.file || '')) throw Error('Invalid season snapshot file: ' + route);
    if (!Number.isFinite(Date.parse(entry.saved_at))) throw Error('Missing season save time: ' + route);
    if (typeof entry.settled !== 'boolean') throw Error('Missing season settled flag: ' + route);
  }
}
export function validateSeasonPayload(value, route) {
  const url = new URL(route, 'https://release.invalid'), year = Number(url.searchParams.get('year'));
  if (!object(value) || value.year !== year) throw Error('Season snapshot is not for its year: ' + route);
  if (url.pathname === '/api/season') {
    if (!Array.isArray(value.rounds) || !value.rounds.length || !object(value.drivers) || !object(value.teams) || !object(value.standings) || !object(value.driver_stats))
      throw Error('Season snapshot requires rounds, drivers, teams, standings and driver stats: ' + route);
  } else if (url.pathname === '/api/season/upgrades') {
    if (!Array.isArray(value.items) || !Array.isArray(value.events)) throw Error('Upgrades snapshot requires items and events: ' + route);
  } else if (!Array.isArray(value.rows) || !value.rows.length || !Array.isArray(value.elements) || !value.elements.length) {
    throw Error('Power-unit snapshot requires rows and elements: ' + route);
  }
}
