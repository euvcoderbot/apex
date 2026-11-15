#!/usr/bin/env node
// Season pace summary: what the Drivers and Head-to-head pages read from every race and practice session, in one small
// file per season, so a finished season loads with one request instead of one per race and up to three per round.
//
// From the captured results the Site publishes (assets/data/local-captures, then assets/data/prerendered for the current
// season), with the pages' own selections (season.js loadForm and loadPractice):
//   race[round][code]     each driver's race pace (Car performance's race analysis, `pace`) where it is a finite number;
//   speed[round][code]    the driver's median race speed trap;
//   practice[round][name][code]  the driver's best timed lap of that practice session (not deleted, not an in or out lap).
// The page uses a round from this file when it has it and still asks the Site for any round it lacks (a race run since
// the file was built), so the file never hides newer results.
//
// Writes assets/data/season-pace/<year>.json. Usage: node scripts/build-season-pace.mjs 2025 [2024 ...]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stores = ['assets/data/local-captures', 'assets/data/prerendered'].map(d => path.join(root, d));
const indexes = stores.map(dir => { try { return {dir, entries: JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8')).entries || {}}; } catch { return {dir, entries: {}}; } });
const keyOf = route => { const u = new URL(route, 'http://local.invalid'); u.searchParams.sort(); return u.pathname + '?' + u.searchParams; };
function read(route) {
  const key = keyOf(route);
  for (const {dir, entries} of indexes) {
    const hit = entries[key] || entries[route];
    const file = typeof hit === 'string' ? hit : hit?.file;
    if (file) { try { return JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, file)))); } catch {} }
  }
  return null;
}

for (const year of process.argv.slice(2).map(Number).filter(Boolean)) {
  const calendar = read(`/api/events?year=${year}`);
  const events = (Array.isArray(calendar) ? calendar : calendar?.events) || [];
  const race = {}, speed = {}, practice = {};
  let practices = 0;
  for (const e of events) {
    const perf = read('/api/performance?' + new URLSearchParams({year, gp: e.name, session: 'R'}));
    const teams = perf?.teams || [];
    const paces = teams.flatMap(t => t.race_drivers || []).filter(x => Number.isFinite(x.pace) && x.driver);
    if (paces.length) race[e.round] = Object.fromEntries(paces.map(x => [x.driver, x.pace]));
    const traps = teams.flatMap(t => t.race_speed_drivers || []).filter(x => Number.isFinite(x.race_speed_trap_median) && x.driver);
    if (traps.length) speed[e.round] = Object.fromEntries(traps.map(x => [x.driver, x.race_speed_trap_median]));
    for (const name of ['Practice 1', 'Practice 2', 'Practice 3']) {
      if (!(e.sessions || []).includes(name)) continue;
      const session = read('/api/session?' + new URLSearchParams({year, gp: e.name, session: name, round: e.round}));
      if (!session) continue;
      const best = {};
      for (const d of session.drivers || []) {
        const t = (d.laps || []).filter(l => Number.isFinite(l.time) && l.time > 0 && !l.deleted && !l.in_lap && !l.out_lap).map(l => l.time);
        if (t.length) best[d.code] = Math.min(...t);
      }
      (practice[e.round] ||= {})[name] = best;
      practices++;
    }
  }
  const out = {year, method: 'season-pace-v1', generated: new Date().toISOString().slice(0, 10), race, speed, practice};
  const file = path.join(root, 'assets/data/season-pace', `${year}.json`);
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, JSON.stringify(out) + '\n');
  console.log(`${year}: ${events.length} events, race pace for ${Object.keys(race).length}, ${practices} practice sessions, ${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
}
