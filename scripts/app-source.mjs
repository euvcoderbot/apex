// The session-analysis view is split into consecutive classic scripts that
// share one global scope (index.html loads them in this order). Tests that
// inspect or run "the app" read them joined, exactly as the browser sees them.
import {readFileSync} from 'node:fs';
export const SESSION_SCRIPTS = ["session-state.js", "session-loader.js", "session-laps.js", "session-charts.js", "session-capture.js", "session-hover.js", "session-corners.js", "session-map.js", "session-init.js", "session-tyres.js"];
export function appSource() {
  return SESSION_SCRIPTS.map(file => readFileSync(new URL('../' + file, import.meta.url), 'utf8')).join('\n');
}
