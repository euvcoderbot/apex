#!/usr/bin/env node
// Track profiles: each circuit as the fastest qualifying lap of the season drove it, for the season hub's Tracks section.
// Writes assets/data/track-profiles.json.
//
// Sources, all published or public:
//   - the qualifying telemetry in assets/data/telemetry (the season's fastest qualifying lap at each Grand Prix, any part);
//   - that session's published data (assets/data/prerendered): the lap's sector times, the nominated Pirelli compounds,
//     track conditions at the time of the lap and the circuit key;
//   - MultiViewer's circuit API (the same source the session map uses): the numbered corners, the drawing rotation and
//     the time a pit stop costs (normal, under a virtual safety car and under a safety car). Where it has no corners
//     (Sepang, Madrid in 2026) the session view's documented fallback in corner-geometry.js is used, marked approximate.
//
// Per track: length, lap time, average and top speed, full throttle (share of lap time with throttle >= 98%), braking
// (share of lap time on the brake with the throttle closed; the brake channel also reads 104 with the throttle open,
// which is a flag, not the pedal), braking zones, gear changes; each numbered corner's apex speed (the lowest speed
// within its stretch of track) and gear, classed slow (< 120 km/h), medium (120-200) or fast (> 200, flat-out bends
// included); the three sectors (time, length, average speed); the straights (full throttle for at least 250 m); and a
// map outline with the speed at each point.
// Usage: node scripts/build-track-profiles.mjs [year]
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import {circuitCornerMarkers} from '../corner-geometry.js';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const data = path.join(root, 'assets/data');
const year = Number(process.argv[2]) || 2026;
const readGz = file => JSON.parse(zlib.gunzipSync(fs.readFileSync(file)));
const telemetry = JSON.parse(fs.readFileSync(path.join(data, 'telemetry/index.json'), 'utf8'));
const prerendered = JSON.parse(fs.readFileSync(path.join(data, 'prerendered/index.json'), 'utf8'));
const packs = new Map();
const pack = file => { if (!packs.has(file)) packs.set(file, readGz(path.join(data, 'telemetry', file))); return packs.get(file); };

// The fastest qualifying lap at each Grand Prix.
const best = new Map();
for (const [key, file] of Object.entries(telemetry.entries)) {
  const [y, gp, session, driver] = key.split(':');
  if (Number(y) !== year || session !== 'Qualifying') continue;
  for (const lap of Object.values(pack(file).laps || {})) {
    if (lap.driver !== driver || !(lap.samples?.length > 100)) continue;
    const t = lap.samples.at(-1).ElapsedSeconds;
    if (Number.isFinite(t) && t > 0 && !(best.get(gp)?.time <= t)) best.set(gp, {driver, lap: lap.lap, time: t, samples: lap.samples});
  }
}

function sessionFor(gp) {
  const key = Object.keys(prerendered.entries).find(k => k.startsWith('/api/session?') && k.includes(`year=${year}`) && k.includes('session=Qualifying')
    && new URLSearchParams(k.split('?')[1]).get('gp') === gp);
  return key ? readGz(path.join(data, 'prerendered', prerendered.entries[key])) : null;
}
const circuits = new Map();
async function circuit(key) {
  if (!circuits.has(key)) {
    circuits.set(key, fetch(`https://api.multiviewer.app/api/v1/circuits/${key}/${year}`, {headers: {'User-Agent': 'apex-data-track-build'}})
      .then(r => (r.ok ? r.json() : null)).catch(() => null));
  }
  return circuits.get(key);
}

const round1 = v => Math.round(v * 10) / 10;
function profile(gp, lap, session, guide) {
  const s = lap.samples, time = lap.time, length = s.at(-1).Distance;
  let full = 0, brake = 0, zones = 0, changes = 0, onBrake = false;
  const braking = x => Number(x.Brake) > 0 && !(x.Throttle >= 30);
  for (let i = 1; i < s.length; i++) {
    const a = s[i - 1], b = s[i], dt = b.ElapsedSeconds - a.ElapsedSeconds;
    if (!(dt > 0)) continue;
    if (a.Throttle >= 98) full += dt;
    if (braking(a)) { brake += dt; if (!onBrake) zones++; }
    onBrake = braking(a);
    if (Number.isFinite(a.nGear) && Number.isFinite(b.nGear) && a.nGear !== b.nGear) changes++;
  }
  const speeds = s.map(x => x.Speed).filter(Number.isFinite);
  // Numbered corners: the telemetry sample nearest each corner's marked position, then the lowest speed between the
  // midpoints to the neighbouring corners (at most 150 m either side).
  const corners = [];
  const nearestDistance = d => s.reduce((bi, p, i) => (Math.abs(p.Distance - d) < Math.abs(s[bi].Distance - d) ? i : bi), 0);
  let approximate = false;
  let marks = (guide?.corners || []).map(c => {
    const {x, y} = c.trackPosition || {};
    let at = 0, bestD = Infinity;
    s.forEach((p, i) => { const d = (p.X - x) ** 2 + (p.Y - y) ** 2; if (d < bestD) { bestD = d; at = i; } });
    return {number: c.number, letter: c.letter || '', at, distance: s[at].Distance};
  });
  if (!marks.length) {
    const origin = s[0].Distance, total = s.at(-1).Distance - origin;
    marks = circuitCornerMarkers({samples: s, corners: []}, {circuit_key: session?.circuit_key, location: session?.location, year, event: gp}).map(c => {
      const at = nearestDistance(origin + c.fraction * total);
      return {number: c.number, letter: c.letter || '', at, distance: s[at].Distance};
    });
    approximate = marks.length > 0;
  }
  marks.sort((m, n) => m.distance - n.distance);
  marks.forEach((m, k) => {
    const prev = marks[k - 1]?.distance ?? -Infinity, next = marks[k + 1]?.distance ?? Infinity;
    const from = Math.max(m.distance - 150, (prev + m.distance) / 2), to = Math.min(m.distance + 150, (m.distance + next) / 2);
    let low = null;
    for (const p of s) if (p.Distance >= from && p.Distance <= to && Number.isFinite(p.Speed) && (!low || p.Speed < low.Speed)) low = p;
    if (!low) return;
    const v = Math.round(low.Speed);
    corners.push({number: `${m.number}${m.letter}`, distance: Math.round(low.Distance), speed: v, gear: low.nGear ?? null,
      type: v < 120 ? 'slow' : v <= 200 ? 'medium' : 'fast'});
  });
  // Sectors from the lap's own sector times.
  const lapRow = session?.drivers?.find(d => d.code === lap.driver)?.laps?.find(l => Math.abs((l.time || 0) - time) < .02);
  const at = t => { const p = s.find(x => x.ElapsedSeconds >= t); return p ? p.Distance : length; };
  let sectors = null;
  if (lapRow?.s1 && lapRow?.s2) {
    const d1 = at(lapRow.s1), d2 = at(lapRow.s1 + lapRow.s2), times = [lapRow.s1, lapRow.s2, lapRow.s3 || time - lapRow.s1 - lapRow.s2];
    sectors = [[0, d1], [d1, d2], [d2, length]].map(([from, to], i) => ({from: Math.round(from), to: Math.round(to), time: Number(times[i].toFixed(3)),
      average_speed: round1((to - from) / times[i] * 3.6)}));
  }
  // Straights: full throttle for at least 250 m.
  const straights = [];
  let start = null;
  s.forEach((p, i) => {
    const flat = p.Throttle >= 98;
    if (flat && start == null) start = i;
    if ((!flat || i === s.length - 1) && start != null) {
      const a = s[start], b = s[flat ? i : i - 1], run = b.Distance - a.Distance;
      if (run >= 250) straights.push({from: Math.round(a.Distance), to: Math.round(b.Distance), length: Math.round(run),
        entry_speed: Math.round(a.Speed), top_speed: Math.round(Math.max(...s.slice(start, i + 1).map(x => x.Speed)))});
      start = null;
    }
  });
  // Map: a point about every 6 m (x, y, speed), in the circuit's own units: fine enough that the outline is smooth.
  const outline = [];
  let lastD = -Infinity;
  for (const p of s) if (Number.isFinite(p.X) && Number.isFinite(p.Y) && p.Distance - lastD >= 6) { outline.push([Math.round(p.X), Math.round(p.Y), Math.round(p.Speed)]); lastD = p.Distance; }
  const cornerMarks = marks.map(m => ({number: `${m.number}${m.letter}`, x: Math.round(s[m.at].X), y: Math.round(s[m.at].Y)}));
  const count = type => corners.filter(c => c.type === type).length;
  return {
    driver: lap.driver, lap_time: Number(time.toFixed(3)), length: Math.round(length), average_speed: round1(length / time * 3.6),
    top_speed: Math.round(Math.max(...speeds)), minimum_speed: Math.round(Math.min(...speeds)),
    full_throttle: Number((full / time).toFixed(3)), braking: Number((brake / time).toFixed(3)), braking_zones: zones, gear_changes: changes,
    corners: {slow: count('slow'), medium: count('medium'), fast: count('fast'), total: corners.length, approximate, list: corners},
    sectors, straights, compounds: session?.compounds || null,
    conditions: lapRow?.conditions ? {air: lapRow.conditions.air_temperature, track: lapRow.conditions.track_temperature, rain: !!lapRow.conditions.rainfall} : null,
    pit_loss: guide?.pitLoss ? {normal: Number(guide.pitLoss.normal) || null, vsc: Number(guide.pitLoss.vsc) || null, sc: Number(guide.pitLoss.sc) || null} : null,
    circuit: guide?.circuitName || session?.location || null, rotation: guide?.rotation ?? session?.circuit_rotation ?? 0,
    map: {outline, corners: cornerMarks},
  };
}

const tracks = {};
for (const [gp, lap] of [...best].sort()) {
  const session = sessionFor(gp);
  const guide = session?.circuit_key ? await circuit(session.circuit_key) : null;
  tracks[gp] = profile(gp, lap, session, guide);
}
const out = {year, method: 'track-profile-v2', generated: new Date().toISOString().slice(0, 10), tracks};
fs.writeFileSync(path.join(data, 'track-profiles.json'), JSON.stringify(out) + '\n');
console.log(`${Object.keys(tracks).length} tracks, ${(fs.statSync(path.join(data, 'track-profiles.json')).size / 1024).toFixed(0)} KB`);
for (const [gp, t] of Object.entries(tracks)) console.log(gp.padEnd(26), t.circuit?.padEnd(28) || '', `${t.corners.total} corners`, JSON.stringify({s: t.corners.slow, m: t.corners.medium, f: t.corners.fast}), t.sectors ? 'sectors' : 'no sectors', `${t.straights.length} straights`, t.compounds?.join('') || '');
