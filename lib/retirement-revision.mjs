import {createHash} from 'node:crypto';
import {sourceRevisionBytes} from './source-revision.mjs';

function section(text, start, end) {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from + start.length);
  if (from === -1 || to === -1) throw new Error('Could not find retirement rules in performance.py: ' + start.trim());
  return text.slice(from, to);
}

// performance.py also computes pace and tyre metrics. Hash only the rules that
// classify and count retirements, plus the report parser and identity matcher.
export function calculateRetirementRevision(performance, sources) {
  const text = performance.toString('utf8').replace(/\r\n/g, '\n');
  const classifier = section(text, '\ndef get_verified_retirement(', '\ndef analyze(');
  const counts = section(text, "\n        if status in ('Finished', 'Lapped') or status.startswith('+'):\n            team['finishes']", '\n    if qualifying:');
  return createHash('sha256')
    .update('retirement-classifier\0').update(sourceRevisionBytes('performance.py', Buffer.from(classifier)))
    .update('retirement-counts\0').update(sourceRevisionBytes('performance.py', Buffer.from(counts)))
    .update('retirement_sources.py\0').update(sourceRevisionBytes('retirement_sources.py', sources))
    .digest('hex').slice(0, 20);
}

export function isRacePerformanceRoute(route) {
  const url = new URL(route, 'https://release.invalid');
  return url.pathname === '/api/performance' && ['r', 'race'].includes((url.searchParams.get('session') || '').toLowerCase());
}
