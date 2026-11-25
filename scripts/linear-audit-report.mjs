#!/usr/bin/env node
// Renders the measured part of docs/linear-migration-audit.md from an audit run (scripts/audit-linear.mjs), between the
// <!-- measured --> markers, so the document always shows the current state next to the baseline.
//   node scripts/linear-audit-report.mjs [test-results/linear-audit.json]
import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const current = JSON.parse(await readFile(process.argv[2] || path.join(root, 'test-results/linear-audit.json'), 'utf8'));
const baseline = JSON.parse(await readFile(path.join(root, 'docs/linear-audit-baseline.json'), 'utf8'));
const kinds = d => d.families.reduce((m, f) => (m[f.kind] = (m[f.kind] || 0) + 1, m), {});
const rules = d => d.findings.reduce((m, f) => (m[f.rule] = (m[f.rule] || 0) + 1, m), {});
const fmt = o => Object.entries(o || {}).sort((a, b) => +a[0] - +b[0]).map(([k, v]) => `${k}×${v}`).join(' ') || '—';
const esc = s => String(s).replace(/\|/g, '\\|');

let md = `\n_Generated ${current.generated.slice(0, 16)} from ${current.runs} page renders (baseline ${baseline.generated.slice(0, 10)}, ${baseline.runs} renders)._\n\n`;
md += '### Competing component looks (distinct variants per family; target in brackets)\n\n| Family | Baseline | Now | Target |\n| --- | --- | --- | --- |\n';
const kb = kinds(baseline), kc = kinds(current), target = {button: 7, 'button-role': 7, card: 1, heading: 4, 'table-header': 1};
for (const k of Object.keys(target)) md += `| ${k} | ${kb[k] || 0} | ${kc[k] || 0} | ${target[k]} |\n`;
md += '\n### Rule findings (distinct component × value)\n\n| Rule | Baseline | Now |\n| --- | --- | --- |\n';
const rb = rules(baseline), rc = rules(current);
for (const k of [...new Set([...Object.keys(rb), ...Object.keys(rc)])]) md += `| ${k} | ${rb[k] || 0} | ${rc[k] || 0} |\n`;
md += '\n### Layout per route (desktop, 1440)\n\n| Route | Rail | Header | Left edges | Block gaps (px×n) | Nested cards | Row heights (px×n) | Headings (tag:size) |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n';
for (const [route, l] of Object.entries(current.layouts || {}))
  md += `| ${route} | ${l.railWidth} | ${l.headerHeight} | ${l.distinctLeftEdges} | ${fmt(l.blockGaps)} | ${l.nestedCards} | ${fmt(l.rowHeights)} | ${esc(l.headingSequence)} |\n`;
md += '\n### Component variants now (every distinct look, most used first)\n\n| Family | Uses | Look | Example | Routes |\n| --- | --- | --- | --- | --- |\n';
for (const f of current.families) md += `| ${f.kind} | ${f.count} | ${esc(f.sig)} | \`${esc(f.component)}\` «${esc(f.text)}» | ${f.states.slice(0, 3).join(', ')} |\n`;
md += '\n### Rule findings now\n\n| Rule | Value | Component | Uses | Routes |\n| --- | --- | --- | --- | --- |\n';
for (const f of current.findings) md += `| ${f.rule} | ${esc(f.value)} | \`${esc(f.component)}\` | ${f.count} | ${f.states.slice(0, 3).join(', ')} |\n`;

const doc = path.join(root, 'docs/linear-migration-audit.md');
const text = await readFile(doc, 'utf8');
const [head, rest] = text.split('<!-- measured -->');
const tail = rest.split('<!-- /measured -->')[1];
await writeFile(doc, `${head}<!-- measured -->${md}\n<!-- /measured -->${tail}`);
console.log('docs/linear-migration-audit.md updated');
