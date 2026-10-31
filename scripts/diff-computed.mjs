// node scripts/diff-computed.mjs before.json after.json : lists the elements whose computed style differs.
import {readFileSync} from 'node:fs';
const norm = t => t.replace(/ui-[a-z]+-[0-9]+/g, 'ui-id');
const [a, b] = process.argv.slice(2).map(f => JSON.parse(norm(readFileSync(f, 'utf8'))));
let total = 0;
for (const key of Object.keys(a)) {
  const x = a[key], y = b[key] || [];
  const diffs = [];
  for (let i = 0; i < Math.max(x.length, y.length); i++) if (x[i] !== y[i]) diffs.push([x[i], y[i]]);
  total += diffs.length;
  if (diffs.length) console.log(`${key}: ${diffs.length} elements differ (${x.length} vs ${y.length})`, diffs.slice(0, 2).map(d => '\n   - ' + (d[0] || '').slice(0, 260) + '\n   + ' + (d[1] || '').slice(0, 260)).join(''));
}
console.log(total ? `${total} differences` : 'identical');
