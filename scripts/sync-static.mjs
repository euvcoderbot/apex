import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const destination = resolve(root, "public", "apex");
const staticFiles = [
  "index.html",
  "app.js",
  "alignment.js",
  "styles.css",
  "design-system.css",
];

await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });

for (const file of staticFiles) {
  await cp(resolve(root, file), resolve(destination, file));
}
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
