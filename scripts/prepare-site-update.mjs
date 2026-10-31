// Capture a finished event on the local machine. Publication is a separate
// Sites release; no credentials or hosted backend are used here.
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2),value=name=>{const i=args.indexOf(name);return i<0?null:args[i+1];};
const year=value('--year'),gp=value('--gp'),round=value('--round');
if(!/^\d{4}$/.test(year||'')||!gp||!/^\d+$/.test(round||''))throw Error('Supply --year, --gp and --round. Add --race only after the race is confirmed complete.');
async function run(script,more){
  const child=spawn(process.execPath,[path.join(root,script),...more],{cwd:root,stdio:'inherit',windowsHide:true});
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
  if(code!==0)throw Error(`${script} failed (${code}); supported captures remain staged, not published.`);
}
const identity=['--year',year,'--gp',gp,'--round',round];
await run('scripts/export-local-session.mjs',[...identity,'--session','Qualifying',...(args.includes('--refresh')?['--refresh']:[])]);
if(args.includes('--race'))await run('scripts/export-local-session.mjs',[...identity,'--session','Race',...(args.includes('--refresh')?['--refresh']:[])]);
await run('scripts/precompute-local.mjs',['--year',year,'--gp',gp,'--capture',...(args.includes('--race')?['--race']:['--qualifying-only'])]);
console.log('Local snapshots prepared. Validate and publish a Sites release to update the public site.');
