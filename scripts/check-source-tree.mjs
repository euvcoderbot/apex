// Run on GitHub source checkouts only. Site source repositories intentionally
// carry validated prepared data and use release:check instead.
import {execFileSync} from 'node:child_process';
const files=execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
const forbidden=files.filter(file=>/^assets\/data\/(?:local-captures|local-telemetry)\//.test(file)||file==='result.json');
if(forbidden.length)throw Error(`Generated output belongs in the Site checkout, not main: ${forbidden.length} tracked files`);
console.log('Source tree clean: generated local captures and telemetry are not tracked.');
