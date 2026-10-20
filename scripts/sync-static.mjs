import { cp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {createHash} from 'node:crypto';
import {buildUiStyles} from '../lib/ui-style-build.mjs';

const root = process.cwd();
const calculationFiles=['verified_sources.py','verified-sources.json.gz','telemetry_sources.py','pace_models.py','performance.py','performance_tracks.py','car_physics.py','server.py','session_loader.py','openf1_performance.py','openf1-performance.json.gz','race-cornering.js','corner-geometry.js','corner-position.js','qualifying-telemetry.js','speed-domain.js','alignment.js','telemetry-model.js','car-performance.js','app.js','analysis-core.js','lib/data-cache.mjs','lib/race-corner-loader.mjs','lib/qualifying-corner-loader.mjs'];
const revision=createHash('sha256');
for(const file of calculationFiles)revision.update(file).update(await readFile(resolve(root,file)));
const cacheRevision=revision.digest('hex').slice(0,20);
const sourceRevision=createHash('sha256');
for(const file of ['server.py','session_loader.py','openf1_performance.py','openf1-performance.json.gz','telemetry_sources.py','verified_sources.py','verified-sources.json.gz'])sourceRevision.update(file).update(await readFile(resolve(root,file)));
const rawRevision=sourceRevision.digest('hex').slice(0,20);
const backend=createHash('sha256'),race=createHash('sha256');
for(const file of ['server.py','session_loader.py','openf1_performance.py','openf1-performance.json.gz','telemetry_sources.py','performance.py','performance_tracks.py','car_physics.py','pace_models.py','verified_sources.py','verified-sources.json.gz'])backend.update(file).update(await readFile(resolve(root,file)));
for(const file of ['race-cornering.js','corner-geometry.js','corner-position.js','lib/race-corner-loader.mjs','lib/qualifying-corner-loader.mjs'])race.update(file).update(await readFile(resolve(root,file)));
const backendRevision=backend.digest('hex').slice(0,20),measurementRevision=race.digest('hex').slice(0,20);
await writeFile(resolve(root,'lib/cache-revision.mjs'),`// Generated: source, upstream calculations and race snapshots invalidate independently.\nexport const CACHE_REVISION = ${JSON.stringify(cacheRevision)};\nexport const SOURCE_REVISION = ${JSON.stringify(rawRevision)};\nexport const BACKEND_REVISION = ${JSON.stringify(backendRevision)};\nexport const RACE_REVISION = ${JSON.stringify(measurementRevision)};\n`);
const destination = resolve(root, "public", "apex");
const staticFiles = [
  "index.html",
  "app.js",
  "analysis-core.js",
  "alignment.js",
  "telemetry-model.js",
  "car-performance.js",
  "race-cornering.js",
  "corner-geometry.js",
  "corner-position.js",
  "qualifying-telemetry.js",
  "speed-domain.js",
  "car-performance.css",
  "workspace-ui.css",
  "macos-ui.css",
  "ui-controls.css",
  "ui-system.js",
  "ui-catalog.html",
  "dashboard-ui.js",
  "local-compute.js",
  "styles.css",
  "design-system.css",
  "polish.css",
  "apple-ui.css",
  "trace-focus.css",
];
// Visual-only releases must refresh browser assets without invalidating raw
// timing/telemetry caches. Include every stylesheet and presentation module.
const browserHash=createHash('sha256').update(cacheRevision);
for(const file of staticFiles)browserHash.update(file).update(await readFile(resolve(root,file)));
browserHash.update(await readFile(resolve(root,'lib/ui-style-build.mjs')));
const browserRevision=browserHash.digest('hex').slice(0,20);

await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });

for (const file of staticFiles) {
  await cp(resolve(root, file), resolve(destination, file));
}
// Version the actual browser assets independently of raw-data cache identity.
// A release must not reuse an old module solely because its URL stayed fixed.
for(const file of staticFiles.filter(file=>file.endsWith('.js'))){
  const source=await readFile(resolve(destination,file),'utf8');
  await writeFile(resolve(destination,file),source.replace(/((?:from\s+|import\s+)['"]\.\/[^'"?]+\.js)(?:\?[^'"]*)?(['"])/g,`$1?v=${browserRevision}$2`));
}
for(const filename of ['index.html','ui-catalog.html']){
  const page=await readFile(resolve(destination,filename),'utf8');
  await writeFile(resolve(destination,filename),page.replace(/((?:src|href)="[^"/:?]+\.(?:js|css))(?:\?[^" ]*)?("[^>]*>)/g,`$1?v=${browserRevision}$2`));
}
// One compiled sheet: explicit ownership replaces accidental specificity wars.
const ui=await buildUiStyles(file=>readFile(resolve(root,file),'utf8'));
await writeFile(resolve(destination,'styles.css'),ui.css);
await cp(resolve(root, "assets"), resolve(destination, "assets"), { recursive: true });

const apiOrigin = String(
  process.env.APEX_API_ORIGIN || "https://apex-telemetry-api.vercel.app",
).replace(/\/$/, "");
if (apiOrigin && !/^https:\/\//i.test(apiOrigin)) {
  throw new Error("APEX_API_ORIGIN must be an HTTPS origin");
}
await writeFile(
  resolve(destination, "config.js"),
  `window.APEX_API_ORIGIN = ${JSON.stringify(apiOrigin)};\nwindow.APEX_DATA_VERSION = ${JSON.stringify(cacheRevision)};\nwindow.APEX_SOURCE_VERSION = ${JSON.stringify(rawRevision)};\nwindow.APEX_BACKEND_VERSION = ${JSON.stringify(backendRevision)};\nwindow.APEX_MEASUREMENT_VERSION = ${JSON.stringify(measurementRevision)};\n`,
  "utf8",
);
