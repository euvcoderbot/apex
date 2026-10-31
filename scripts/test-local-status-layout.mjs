import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import postcss from 'postcss';

test('local compute status is not squeezed into the icon toolbar width', () => {
  const css = postcss.parse(readFileSync('hig-system.css', 'utf8'));
  const rules = [];
  css.walkRules(rule => {
    if (rule.selector.includes('button.local-compute-status[data-ui-kind="toolbar"]')) rules.push(rule);
  });
  const desktop = rules.find(rule => rule.parent.type === 'root');
  const compact = rules.find(rule => rule.parent.type === 'atrule' && rule.parent.params.includes('860px'));
  const decl = (rule, key) => rule.nodes.find(node => node.prop === key)?.value;
  assert.equal(decl(desktop, 'width'), 'max-content');
  assert.equal(decl(desktop, 'min-width'), 'max-content');
  assert.equal(decl(desktop, 'flex'), '0 0 auto');
  assert.equal(decl(compact, 'width'), '32px');
  assert.equal(decl(compact, 'min-width'), '32px');
});
