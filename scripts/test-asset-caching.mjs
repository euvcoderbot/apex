import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// public/_headers keeps /apex/*.js and *.css for a year. That is only safe while every page reference to them gets the
// ?v=<revision> that sync-static.mjs adds, which it does only for plain file names in the page's own folder.
test('every script and stylesheet a page loads can be versioned, so year-long caching is safe', () => {
  const headers = readFileSync('public/_headers', 'utf8');
  assert.match(headers, /\/apex\/\*\.js\s+Cache-Control: public, max-age=31536000, immutable/);
  assert.doesNotMatch(headers, /\/apex\/assets\/data/, 'published data keeps the Worker’s own headers');
  for (const page of ['index.html', 'ui-catalog.html']) {
    const html = readFileSync(page, 'utf8');
    for (const [, ref] of html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))(?:\?[^"]*)?"/g)) {
      if (/^(https?:)?\/\//.test(ref)) continue;   // other sites, not ours
      assert.match(ref, /^[^/:?]+\.(js|css)$/, `${page}: ${ref} would not get ?v= and could stay cached after a release`);
    }
  }
});
