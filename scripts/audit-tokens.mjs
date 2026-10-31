// Finds custom properties declared on :root more than once and removes the declarations that can never apply.
//
//   node scripts/audit-tokens.mjs            report
//   node scripts/audit-tokens.mjs --write    delete the shadowed declarations
//
// The stylesheets are built into cascade layers (lib/ui-style-build.mjs). For each appearance (dark is the default,
// light is data-theme="light"), a declaration on :root wins by layer first, then specificity, then source order. A
// declaration is shadowed when, for every appearance it applies to, an unconditional declaration of the same property
// in a later layer (or later in the same layer, with at least equal specificity) applies as well. Shadowed declarations
// change nothing; removing them is verified by e2e/tokens.spec.mjs and the screenshot baselines.
import {readFile, writeFile} from 'node:fs/promises';
import postcss from 'postcss';
import {UI_LAYERS, UI_STYLES} from '../lib/ui-style-build.mjs';

const write = process.argv.includes('--write');

/** Which appearances a :root selector matches, and its specificity as [ids, classes/attributes, elements]. */
function classify(selector) {
  const text = selector.trim().replace(/\s+/g, ' ').replace(/'/g, '"');
  const patterns = [
    [/^:root$/, ['dark', 'light'], [0, 1, 0]],
    [/^html$/, ['dark', 'light'], [0, 0, 1]],
    [/^:root\[data-theme="light"\]$/, ['light'], [0, 2, 0]],
    [/^:root\[data-theme="dark"\]$/, ['dark'], [0, 2, 0]],
    [/^html\[data-theme="light"\]$/, ['light'], [0, 1, 1]],
    [/^html\[data-theme="dark"\]$/, ['dark'], [0, 1, 1]],
    [/^:root:not\(\[data-theme="light"\]\)$/, ['dark'], [0, 2, 0]],
    [/^:root:not\(\[data-theme="dark"\]\)$/, ['light'], [0, 2, 0]],
  ];
  for (const [pattern, contexts, specificity] of patterns) if (pattern.test(text)) return {contexts, specificity};
  return null;
}
const compare = (a, b) => a.layer - b.layer || a.specificity[0] - b.specificity[0] || a.specificity[1] - b.specificity[1]
  || a.specificity[2] - b.specificity[2] || a.order - b.order;

const sources = [];
const declarations = [];
let order = 0;
for (const [file, layerName] of UI_STYLES) {
  const css = await readFile(file, 'utf8');
  const root = postcss.parse(css, {from: file});
  sources.push({file, root});
  root.walkDecls(decl => {
    if (!decl.prop.startsWith('--')) return;
    const rule = decl.parent;
    if (rule?.type !== 'rule') return;
    let conditional = false, layer = layerName;
    for (let parent = rule.parent; parent && parent.type !== 'root'; parent = parent.parent) {
      if (parent.type !== 'atrule') continue;
      if (parent.name === 'layer') layer = parent.params.trim() || layer;
      else conditional = true; // @media, @supports, @container: applies only sometimes
    }
    for (const selector of rule.selectors) {
      const match = classify(selector);
      if (!match) continue;
      declarations.push({file, decl, rule, prop: decl.prop, value: decl.value, important: decl.important, conditional, selector,
        layer: UI_LAYERS.indexOf(layer), contexts: match.contexts, specificity: match.specificity, order: order++});
    }
  });
}

const byProp = new Map();
for (const item of declarations) (byProp.get(item.prop) || byProp.set(item.prop, []).get(item.prop)).push(item);

const shadowed = new Set();
for (const [, items] of byProp) {
  for (const a of items) {
    if (a.important) continue;
    const covered = a.contexts.every(context => items.some(b => b !== a && !b.conditional && !b.important && b.contexts.includes(context) && compare(b, a) > 0));
    if (covered) shadowed.add(a);
  }
}

// A declaration with several selectors ("a, b") is only removable when every one of its selectors is shadowed.
const removable = new Map();
for (const item of declarations) {
  const siblings = declarations.filter(other => other.decl === item.decl);
  if (siblings.every(other => shadowed.has(other))) removable.set(item.decl, item);
}

const multiple = [...byProp].filter(([, items]) => new Set(items.map(item => `${item.file}|${item.layer}`)).size > 1);
const perFile = {};
for (const item of removable.values()) perFile[item.file] = (perFile[item.file] || 0) + 1;
const survivors = new Map();
for (const item of declarations) if (!removable.has(item.decl)) (survivors.get(item.prop) || survivors.set(item.prop, new Set()).get(item.prop)).add(item.file);
const stillMultiple = [...survivors].filter(([, files]) => files.size > 1);

console.log(`${byProp.size} custom properties are declared on :root; ${multiple.length} in more than one file.`);
console.log(`${removable.size} declarations are shadowed and can be removed:`, perFile);
console.log(`After removal ${stillMultiple.length} remain in more than one file (conditional or per-appearance overrides):`);
for (const [prop, files] of stillMultiple.slice(0, 40)) console.log(`  ${prop}: ${[...files].join(', ')}`);

if (write) {
  for (const {root} of sources) root.walkDecls(decl => { if (removable.has(decl)) decl.remove(); });
  for (const {file, root} of sources) {
    root.walkRules(rule => { if (!rule.nodes?.length) rule.remove(); });
    await writeFile(file, root.toString());
  }
  console.log('Written. Run npm run test:e2e and npm run test:visual to confirm nothing changed.');
}
