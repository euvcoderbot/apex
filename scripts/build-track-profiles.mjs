#!/usr/bin/env node
// Track profiles: what each circuit asks of a car, measured on the fastest qualifying lap in the published telemetry.
// Writes assets/data/track-profiles.json, read by the season hub (Schedule: track comparison; Home: next track).
//
// For every Grand Prix with qualifying telemetry, the fastest lap of the session (any driver, any part) gives:
//   length (m), lap time (s), average speed (km/h), full throttle (share of lap time with throttle >= 98%), braking (share
//   of lap time on the brake with the throttle closed), braking zones (separate stretches on the brake), gear changes, and the corners: every
//   speed minimum at least 10 km/h below the fastest point since the previous corner, by apex speed into slow (< 120 km/h),
//   medium (120-200) and fast (> 200).
// Usage: node scripts/build-track-profiles.mjs [year]
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const dir = path.join(root, 'assets/data/telemetry');
const year = Number(process.argv[2]) || 2026;
const index = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
const packs = new Map();
const pack = file => {
  if (!packs.has(file)) packs.set(file, JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, file)))));
  return packs.get(file);
};

const best = new Map();   // gp -> {driver, lap}
for (const [key, file] of Object.entries(index.entries)) {
  const [y, gp, session, driver] = key.split(':');
  if (Number(y) !== year || session !== 'Qualifying') continue;
  for (const lap of Object.values(pack(file).laps || {})) {
    if (lap.driver !== driver || !(lap.samples?.length > 100)) continue;
    const t = lap.samples.at(-1).ElapsedSeconds;
    if (Number.isFinite(t) && t > 0 && !(best.get(gp)?.time <= t)) best.set(gp, {driver, lap: lap.lap, time: t, samples: lap.samples});
  }
}

function profile({samples, time, driver}) {
  let full = 0, brake = 0, zones = 0, changes = 0, onBrake = false;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1], b = samples[i], dt = b.ElapsedSeconds - a.ElapsedSeconds;
    if (!(dt > 0)) continue;
    if (a.Throttle >= 98) full += dt;
    // The brake channel also reads 104 with the throttle open (a flag, not the pedal): braking needs a closed throttle.
    const braking = Number(a.Brake) > 0 && !(a.Throttle >= 30);
    if (braking) brake += dt;
    if (braking && !onBrake) zones++;
    onBrake = braking;
    if (Number.isFinite(a.nGear) && Number.isFinite(b.nGear) && a.nGear !== b.nGear) changes++;
  }
  // Corners: speed minima with a 10 km/h drop from the highest speed since the last one, and a 10 km/h rise after.
  const DROP = 10, v = samples.map(s => s.Speed), corners = [];
  let peak = v[0], i = 1;
  while (i < v.length - 1) {
    if (v[i] > peak) peak = v[i];
    if (v[i] <= v[i - 1] && v[i] <= v[i + 1] && peak - v[i] >= DROP) {
      let j = i, low = v[i], k = i;
      while (j < v.length - 1 && v[j] - low < DROP) { if (v[j] < low) { low = v[j]; k = j; } j++; }
      if (v[j] - low >= DROP) { corners.push(Math.round(low)); peak = v[j]; i = j; continue; }
    }
    i++;
  }
  const length = samples.at(-1).Distance;
  return {
    driver, lap_time: Number(time.toFixed(3)), length: Math.round(length), average_speed: Number((length / time * 3.6).toFixed(1)),
    full_throttle: Number((full / time).toFixed(3)), braking: Number((brake / time).toFixed(3)), braking_zones: zones, gear_changes: changes,
    corners: {slow: corners.filter(c => c < 120).length, medium: corners.filter(c => c >= 120 && c <= 200).length, fast: corners.filter(c => c > 200).length},
    minimum_speed: Math.min(...v.filter(Number.isFinite)).toFixed(0) * 1,
  };
}

const tracks = {};
for (const [gp, lap] of [...best].sort()) tracks[gp] = profile(lap);
const out = {year, method: 'track-profile-v1', generated: new Date().toISOString().slice(0, 10), tracks};
fs.writeFileSync(path.join(root, 'assets/data/track-profiles.json'), JSON.stringify(out, null, 1) + '\n');
console.log(`${Object.keys(tracks).length} tracks`);
for (const [gp, t] of Object.entries(tracks)) console.log(gp.padEnd(26), t.length, t.lap_time, t.average_speed, t.full_throttle, t.braking, t.braking_zones, JSON.stringify(t.corners));
