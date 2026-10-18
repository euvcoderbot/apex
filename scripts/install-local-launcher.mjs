// Per-user registration only: no administrator, startup task or execution-policy change.
import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
if(process.platform!=='win32')throw new Error('This installer supports Windows only.');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const launcher=path.join(root,'scripts/launch-local.mjs');
const wrapper=path.join(root,'scripts/launch-local.py'),legacyWrapper=path.join(root,'scripts/launch-local.ps1');
if(!existsSync(path.join(root,'.venv/Scripts/python.exe')))throw new Error('The local Python environment is missing.');
const pythonw=path.join(root,'.venv/Scripts/pythonw.exe');
if(!existsSync(pythonw))throw new Error('The windowless Python runtime is missing.');
const key='HKCU\\Software\\Classes\\apex-local',command=`"${pythonw}" "${wrapper}" "%1"`;
const reg=(args)=>execFileSync('reg.exe',args,{windowsHide:true,encoding:'utf8',stdio:['ignore','pipe','pipe']});
let previous='';
try{previous=reg(['query',key+'\\shell\\open\\command','/ve']);}catch{}
if(previous&&![launcher,wrapper,legacyWrapper].some(file=>previous.includes(file)))throw new Error('apex-local is already registered to another app; it was not changed.');
reg(['add',key,'/ve','/d','URL:Apex local compute','/f']);
reg(['add',key,'/v','URL Protocol','/d','','/f']);
reg(['add',key+'\\shell\\open\\command','/ve','/d',command,'/f']);
console.log('Installed for this Windows user. Use local compute now starts the server and opens its dashboard.');
