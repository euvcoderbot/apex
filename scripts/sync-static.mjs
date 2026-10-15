import { cp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {createHash} from 'node:crypto';

const root = process.cwd();
const calculationFiles=['verified_sources.py','verified-sources.json.gz','telemetry_sources.py','pace_models.py','performance.py','performance_tracks.py','server.py','session_loader.py','race-cornering.js','corner-geometry.js','corner-position.js','qualifying-telemetry.js','alignment.js','telemetry-model.js','car-performance.js','app.js','analysis-core.js','lib/data-cache.mjs','lib/race-corner-loader.mjs','lib/qualifying-corner-loader.mjs'];
const revision=createHash('sha256');
for(const file of calculationFiles)revision.update(file).update(await readFile(resolve(root,file)));
const cacheRevision=revision.digest('hex').slice(0,20);
const sourceRevision=createHash('sha256');
for(const file of ['server.py','session_loader.py','telemetry_sources.py','verified_sources.py','verified-sources.json.gz'])sourceRevision.update(file).update(await readFile(resolve(root,file)));
const rawRevision=sourceRevision.digest('hex').slice(0,20);
const backend=createHash('sha256'),race=createHash('sha256');
for(const file of ['server.py','session_loader.py','telemetry_sources.py','performance.py','performance_tracks.py','pace_models.py','verified_sources.py','verified-sources.json.gz'])backend.update(file).update(await readFile(resolve(root,file)));
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
  "car-performance.css",
  "workspace-ui.css",
  "dashboard-ui.js",
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
const page=await readFile(resolve(destination,'index.html'),'utf8');
await writeFile(resolve(destination,'index.html'),page.replace(/((?:src|href)="[^"/:?]+\.(?:js|css))(?:\?[^" ]*)?("[^>]*>)/g,`$1?v=${browserRevision}$2`));
// Keep the exact cascade, but remove the render-blocking @import waterfall.
// The browser receives all three layers in its first stylesheet response.
const layers = await Promise.all([
  ["design-system.css", "legacy"], ["polish.css", "legacy"], ["apple-ui.css", "interface"],
].map(async ([file, layer]) => `@layer ${layer} {\n${await readFile(resolve(root, file), "utf8")}\n}`));
await writeFile(resolve(destination, "styles.css"), `@layer focus, legacy, interface;\n${layers.join("\n")}\n`);
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
