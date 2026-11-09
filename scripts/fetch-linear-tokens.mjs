#!/usr/bin/env node
// Reads linear.app's published stylesheets and writes their design tokens to design/linear-tokens.json: every custom property
// declared on :root (type, radii, motion, layers, palette), [data-theme="dark"] and [data-theme="light"] (the themes).
// Generated class tokens (--sx-*), build markers and editor internals are left out. This is the reference that
// docs/linear-design.md describes; re-run it when Linear changes its design and review the diff.
//   node scripts/fetch-linear-tokens.mjs
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UA = {'User-Agent': 'ApexData/1.0 (design reference)'};
const page = await (await fetch('https://linear.app/', {headers: UA})).text();
const sheets = [...new Set([...page.matchAll(/href="(https:\/\/static\.linear\.app\/[^"]+\.css)"/g)].map(m => m[1]))];
if (!sheets.length) throw new Error('No stylesheets found on linear.app');

const tokens = {root: {}, dark: {}, light: {}};
const skip = name => /^--(sx-|lightningcss|editor-|active-tab|btn-|icon-(color|default|replacement)|selection-bg)/.test(name);
for (const url of sheets) {
  const css = await (await fetch(url, {headers: UA})).text();
  // Declaration blocks for the three selectors we want; nested @media/@supports blocks are read the same way.
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim().replace(/\s+/g, ' ');
    const key = /^:root(,|$)/.test(selector) ? 'root' : selector === '[data-theme="dark"]' || selector === '[data-theme=dark]' ? 'dark'
      : selector === '[data-theme="light"]' || selector === '[data-theme=light]' ? 'light' : null;
    if (!key) continue;
    for (const d of m[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+)/g)) {
      const value = d[2].trim();
      if (!skip(d[1]) && value) tokens[key][d[1]] = value;
    }
  }
}
const out = {source: 'https://linear.app stylesheets', read: new Date().toISOString().slice(0, 10), sheets: sheets.length, ...tokens};
await writeFile(path.join(root, 'design/linear-tokens.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`design/linear-tokens.json: ${Object.keys(tokens.root).length} root, ${Object.keys(tokens.dark).length} dark, ${Object.keys(tokens.light).length} light tokens from ${sheets.length} sheets`);
