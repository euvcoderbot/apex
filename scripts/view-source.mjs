// Car performance is drawn partly by car-performance.js and partly by React
// views in src/ (react-islands.js). Tests about what the page offers read both.
import {readFileSync, readdirSync} from 'node:fs';

function tsx(dir) {
  return readdirSync(new URL(dir, import.meta.url), {withFileTypes: true}).flatMap(entry =>
    entry.isDirectory() ? tsx(dir + entry.name + '/') : entry.name.endsWith('.tsx') ? [readFileSync(new URL(dir + entry.name, import.meta.url), 'utf8')] : []);
}
export function performanceSource() {
  return [readFileSync(new URL('../car-performance.js', import.meta.url), 'utf8'), ...tsx('../src/')].join('\n');
}
// A control the page offers: a literal data-<key>= attribute, or a
// <SegmentedControl name="<key>"> that renders those buttons.
export const offersControl = (source, key) => new RegExp(`data-${key}=|name="${key}"`).test(source);
