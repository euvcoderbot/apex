#!/usr/bin/env node
// Deletes the appearance declarations of the superseded stylesheets that scripts/legacy-overrides.mjs found to change nothing
// (skins.css overrides them in every audited state, theme and width). Kept, whatever the check says:
//   - declarations it could not observe: rules for states it does not open (:hover, :focus, :active, :disabled, :checked,
//     invalid fields), transient surfaces created on demand (toasts, tooltips, hover cards), and media queries other than
//     width/height (forced colours, contrast, reduced motion, print);
//   - selectors the check never saw in the page (the browser dropped them, or they were retired at build time);
//   - layout, custom properties and everything that is not colour, background, border, shadow or type.
//   node scripts/prune-legacy.mjs [test-results/legacy-overrides.json] [--dry]
import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import postcss from 'postcss';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const report = JSON.parse(await readFile(process.argv.find(a => a.endsWith('.json')) || path.join(root, 'test-results/legacy-overrides.json'), 'utf8'));
const dry = process.argv.includes('--dry');
const appearance = /^(?:background(?:-.+)?|color|border(?:-.+)?|box-shadow|text-shadow|font(?:-.+)?|letter-spacing|line-height|text-transform|backdrop-filter|filter)$/;
const norm = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, '').replace(/["']/g, '').replace(/(^|[^:]):(before|after|placeholder|marker|selection)\b/g, '$1::$2');
import {UNOBSERVED as unobserved} from './prune-legacy-rules.mjs';
const seen = new Set(report.seen.map(s => `${s.file}\u0001${s.sel}`));
const needed = new Map();
for (const n of report.needed) { const k = `${n.file}\u0001${n.sel}`; (needed.get(k) || needed.set(k, new Set()).get(k)).add(n.prop); }
// Does removing source property `p` (possibly a shorthand) take away a needed longhand `l`?
const covers = (p, l) => {
  if (p === l || l.startsWith(p + '-')) return true;
  if (p === 'font') return l.startsWith('font-') || l === 'line-height';
  if (p === 'background') return l.startsWith('background-');
  if (p.startsWith('border') && l.startsWith('border')) {
    const parts = p.split('-').slice(1), lp = l.split('-').slice(1);
    if (!parts.length) return !l.endsWith('-radius');
    return parts.every(t => lp.includes(t));
  }
  return false;
};
let total = 0, kept = 0;
for (const file of report.files) {
  const source = await readFile(path.join(root, file), 'utf8');
  const tree = postcss.parse(source, {from: file});
  let removed = 0;
  tree.walkRules(rule => {
    for (let p = rule.parent; p; p = p.parent) {
      if (p.type === 'atrule' && p.name === 'media' && !/(?:min|max)-(?:width|height)|orientation/.test(p.params)) return;
      if (p.type === 'atrule' && (p.name === 'layer' && p.params === 'focus' || p.name === 'keyframes' || p.name === 'font-face')) return;
    }
    if (rule.parent?.type === 'atrule' && /keyframes/.test(rule.parent.name)) return;
    if (unobserved.test(rule.selector)) return;
    const key = `${file}\u0001${norm(rule.selector)}`;
    if (!seen.has(key)) return;
    const need = needed.get(key) || new Set();
    rule.walkDecls(decl => {
      if (decl.parent !== rule || !appearance.test(decl.prop)) return;
      // Either direction: the browser may report a needed declaration under a shorthand the source split up (or the reverse).
      if ([...need].some(l => covers(decl.prop, l) || covers(l, decl.prop))) { kept++; return; }
      decl.remove(); removed++;
    });
  });
  // Rules and blocks left empty go too.
  let changed = true;
  while (changed) { changed = false; tree.walk(n => { if ((n.type === 'rule' || (n.type === 'atrule' && n.nodes)) && !n.nodes.some(c => c.type !== 'comment')) { n.remove(); changed = true; } }); }
  total += removed;
  console.log(`${file}: ${removed} overridden declarations ${dry ? 'would be ' : ''}removed`);
  if (!dry && removed) await writeFile(path.join(root, file), tree.toString());
}
console.log(`total ${total} removed, ${kept} kept because they still show`);
