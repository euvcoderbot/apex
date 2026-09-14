import { cp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const destination = resolve(root, "public", "apex");
const staticFiles = [
  "index.html",
  "app.js",
  "alignment.js",
  "telemetry-model.js",
  "styles.css",
  "design-system.css",
  "polish.css",
  "apple-ui.css",
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
await writeFile(resolve(destination, "styles.css"), `@layer legacy, interface;\n${layers.join("\n")}\n`);
await cp(resolve(root, "assets"), resolve(destination, "assets"), { recursive: true });

const apiOrigin = String(
  process.env.APEX_API_ORIGIN || "https://apex-telemetry-api.vercel.app",
).replace(/\/$/, "");
if (apiOrigin && !/^https:\/\//i.test(apiOrigin)) {
  throw new Error("APEX_API_ORIGIN must be an HTTPS origin");
}
await writeFile(
  resolve(destination, "config.js"),
  `window.APEX_API_ORIGIN = ${JSON.stringify(apiOrigin)};\n`,
  "utf8",
);
