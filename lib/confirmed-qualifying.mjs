import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import path from 'node:path';
import {captureKey} from './local-captures.mjs';

// Exported sessions have independently passed the exporter's end-time and
// classification checks. Never infer completion merely from the calendar date.
export async function confirmedQualifying(root, year, event, now = Date.now()) {
  return confirmedSession(root, year, event, 'Qualifying', now);
}

// The same evidence for any session (used for the Race when rebuilding past rounds, whose completion the source
// calendar no longer reports): a settled local OpenF1 export of exactly that session, ended, with a classified field.
export async function confirmedSession(root, year, event, session, now = Date.now()) {
  try {
    const folder = path.join(root, 'assets/data/local-captures');
    const index = JSON.parse(await readFile(path.join(folder, 'index.json'), 'utf8'));
    const query = new URLSearchParams({year: String(year), gp: event.name, round: String(event.round), session});
    const entry = index.entries?.[captureKey('/api/session?' + query)];
    if (!entry?.file || !/^[a-f0-9]+\.json\.gz$/.test(entry.file)) return false;
    const payload = JSON.parse(gunzipSync(await readFile(path.join(folder, entry.file))));
    const capture = payload.local_export;
    const ended = Date.parse(capture?.session_ended_at);
    return payload.event === event.name && payload.session === session
      && Number.isInteger(capture?.session_key) && payload.openf1_session_key === capture.session_key
      && capture.source === 'OpenF1 via local compute' && capture.provisional === false
      && Number.isFinite(ended) && ended < now && Array.isArray(payload.drivers) && payload.drivers.length >= 3;
  } catch { return false; }
}
