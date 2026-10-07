import { cp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {createHash} from 'node:crypto';

const root = process.cwd();
const calculationFiles=['performance.py','performance_tracks.py','server.py','session_loader.py','race-cornering.js','corner-geometry.js','qualifying-telemetry.js','alignment.js','telemetry-model.js','car-performance.js','app.js','analysis-core.js','lib/data-cache.mjs','lib/race-corner-loader.mjs'];
const revision=createHash('sha256');
for(const file of calculationFiles)revision.update(file).update(await readFile(resolve(root,file)));
const cacheRevision=revision.digest('hex').slice(0,20);
const sourceRevision=createHash('sha256');
for(const file of ['server.py','session_loader.py'])sourceRevision.update(file).update(await readFile(resolve(root,file)));
const rawRevision=sourceRevision.digest('hex').slice(0,20);
const backend=createHash('sha256'),race=createHash('sha256');
for(const file of ['server.py','session_loader.py','performance.py','performance_tracks.py'])backend.update(file).update(await readFile(resolve(root,file)));
for(const file of ['race-cornering.js','corner-geometry.js','lib/race-corner-loader.mjs'])race.update(file).update(await readFile(resolve(root,file)));
await writeFile(resolve(root,'lib/cache-revision.mjs'),`// Generated: source, upstream calculations and race snapshots invalidate independently.\nexport const CACHE_REVISION = ${JSON.stringify(cacheRevision)};\nexport const SOURCE_REVISION = ${JSON.stringify(rawRevision)};\nexport const BACKEND_REVISION = ${JSON.stringify(backend.digest('hex').slice(0,20))};\nexport const RACE_REVISION = ${JSON.stringify(race.digest('hex').slice(0,20))};\n`);
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
  "qualifying-telemetry.js",
  "car-performance.css",
  "styles.css",
  "design-system.css",
  "polish.css",
  "apple-ui.css",
  "trace-focus.css",
];

await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });

for (const file of staticFiles) {
  await cp(resolve(root, file), resolve(destination, file));
}
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
  `window.APEX_API_ORIGIN = ${JSON.stringify(apiOrigin)};\nwindow.APEX_DATA_VERSION = ${JSON.stringify(cacheRevision)};\n`,
  "utf8",
);
