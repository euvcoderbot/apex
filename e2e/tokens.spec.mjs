import {test, expect} from '@playwright/test';
import {readFileSync, writeFileSync, existsSync, mkdirSync} from 'node:fs';

// The design tokens are the contract every component is built on. This records the computed value of every custom
// property declared on :root, in both appearances, and fails when any of them changes. A refactor of where tokens are
// defined must leave this file untouched. Change a value on purpose with:  UPDATE_TOKENS=1 npm run test:e2e -- tokens
const FILE = new URL('./__tokens__/tokens.json', import.meta.url);

test('computed :root custom properties are unchanged, in both appearances', async ({page, browserName}) => {
  test.skip(browserName !== 'chromium', 'values are engine-independent; one engine records them');
  await page.goto('/apex/ui-catalog.html');
  const snapshot = {};
  for (const theme of ['dark', 'light']) {
    snapshot[theme] = await page.evaluate(value => {
      document.documentElement.dataset.theme = value;
      const names = new Set();
      const walk = list => { for (const rule of list) {
        if (rule.cssRules && !rule.style) walk(rule.cssRules);
        else if (rule.style && /(^|,)\s*(:root|html)\b/.test(rule.selectorText || '')) for (const name of rule.style) if (name.startsWith('--')) names.add(name);
      } };
      for (const sheet of document.styleSheets) { try { walk(sheet.cssRules); } catch { /* cross-origin sheet */ } }
      const style = getComputedStyle(document.documentElement);
      return Object.fromEntries([...names].sort().map(name => [name, style.getPropertyValue(name).trim()]));
    }, theme);
  }
  if (process.env.UPDATE_TOKENS) {
    mkdirSync(new URL('./__tokens__/', import.meta.url), {recursive: true});
    writeFileSync(FILE, JSON.stringify(snapshot, null, 1) + '\n');
    return;
  }
  expect(existsSync(FILE), 'run with UPDATE_TOKENS=1 to record the baseline').toBe(true);
  const expected = JSON.parse(readFileSync(FILE, 'utf8'));
  // CSS serializers may use seconds or milliseconds for the same duration.
  // Compare exact time values, without accepting any changed timing.
  const comparable=value=>/^\.?\d+(?:\.\d+)?m?s$/.test(value)
    ? `${Number.parseFloat(value)*(value.endsWith('ms')?1:1000)}ms` : value;
  for (const theme of ['dark', 'light']) {
    const missing = Object.keys(expected[theme]).filter(name => !(name in snapshot[theme]));
    const changed = Object.keys(expected[theme]).filter(name => name in snapshot[theme] && comparable(snapshot[theme][name]) !== comparable(expected[theme][name]))
      .map(name => `${name}: ${expected[theme][name]}  ->  ${snapshot[theme][name]}`);
    expect({theme, missing, changed}).toEqual({theme, missing: [], changed: []});
  }
});
