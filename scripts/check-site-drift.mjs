#!/usr/bin/env node
// Before a deploy: does the Site source match a pushed commit of the branch? Lists every file whose content differs, and
// every file only one side has, so a fix made straight in the Site source (live, but never pushed) is found before the
// next deploy of the branch removes it. That happened once: versions 223-224 were replaced by a branch deploy.
//
//   node scripts/check-site-drift.mjs <site-source-dir> [commit]      (commit defaults to origin/feat/season-hub)
// Exit code 1 when anything differs. Run it from this repository; it reads the commit with git, not the working tree.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const [site, commit = 'origin/feat/season-hub'] = process.argv.slice(2);
if (!site || !fs.existsSync(site)) { console.error('Usage: node scripts/check-site-drift.mjs <site-source-dir> [commit]'); process.exit(2); }
const git = (...a) => execFileSync('git', a, {encoding: 'buffer', maxBuffer: 1 << 30});
try { git('fetch', '--quiet', 'origin'); } catch {}
const sha = git('rev-parse', commit).toString().trim();
const pushed = git('branch', '-r', '--contains', sha).toString().trim();
if (!pushed) console.log(`warning: ${sha.slice(0, 7)} is on no remote branch: push it before deploying it.`);

// Text files compare with line endings normalised (the Site source and a Windows checkout may differ only in CRLF).
const norm = buf => (buf.includes(0) ? buf : Buffer.from(buf.toString('utf8').replace(/\r\n/g, '\n')));
const hash = buf => crypto.createHash('sha1').update(norm(buf)).digest('hex');
const tree = new Map();
for (const line of git('ls-tree', '-r', '-z', sha).toString().split('\0').filter(Boolean)) {
  const [meta, file] = line.split('\t');
  if (meta.split(' ')[1] === 'blob') tree.set(file, meta.split(' ')[2]);
}
// Data the scheduler refreshes after each session (and publishes to R2) is not code drift.
const IGNORE = /^(\.git|node_modules|\.venv|\.apex-cache|\.fastf1-cache|public|dist|test-results|playwright-report|assets\/data\/(season|events|prerendered|telemetry|sessions|local-captures|local-telemetry))(\/|$)/;
const siteFiles = new Set();
(function walk(dir) {
  for (const e of fs.readdirSync(path.join(site, dir), {withFileTypes: true})) {
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (IGNORE.test(rel)) continue;
    if (e.isDirectory()) walk(rel); else siteFiles.add(rel);
  }
})('');

// Files this repository ignores (published data, caches, builds) are not source: leave them out.
// git check-ignore exits 1 when it matches nothing; its output is still the answer.
let ignoredList = '';
try { ignoredList = execFileSync('git', ['check-ignore', '--no-index', '--stdin'], {input: [...siteFiles].join('\n'), encoding: 'utf8', maxBuffer: 1 << 30}); }
catch (e) { ignoredList = e.stdout || ''; }
for (const f of ignoredList.split('\n').filter(Boolean)) siteFiles.delete(f);
const differ = [], onlySite = [], onlyBranch = [];
for (const file of siteFiles) {
  if (!tree.has(file)) { onlySite.push(file); continue; }
  if (hash(fs.readFileSync(path.join(site, file))) !== hash(git('cat-file', 'blob', tree.get(file)))) differ.push(file);
}
for (const file of tree.keys()) if (!siteFiles.has(file) && !IGNORE.test(file)) onlyBranch.push(file);
const show = (title, list) => { if (list.length) console.log(`${title} (${list.length}):\n  ${list.slice(0, 60).join('\n  ')}${list.length > 60 ? '\n  …' : ''}`); };
show('Differs from the branch', differ);
show('Only in the Site source (not on the branch)', onlySite);
show('Only on the branch (deploy will add)', onlyBranch);
console.log(`${sha.slice(0, 7)} vs ${site}: ${differ.length} differ, ${onlySite.length} only in the Site, ${onlyBranch.length} only on the branch.`);
process.exitCode = differ.length || onlySite.length ? 1 : 0;
