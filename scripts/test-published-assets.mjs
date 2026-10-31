import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {copyPublishedAssets} from '../lib/published-assets.mjs';

test('delivery excludes superseded payloads and ownership files without deleting source captures',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'apex-delivery-'));
  try{
    const source=path.join(root,'source'),target=path.join(root,'public'),folder=path.join(source,'data/local-captures');
    await mkdir(folder,{recursive:true});
    await writeFile(path.join(folder,'index.json'),JSON.stringify({entries:{a:{file:'used.json.gz'}}}));
    for(const name of ['used.json.gz','old.json.gz','index.oslock','interrupted.tmp'])await writeFile(path.join(folder,name),name);
    await copyPublishedAssets(source,target);
    assert.deepEqual((await readdir(path.join(target,'data/local-captures'))).sort(),['index.json','used.json.gz']);
    assert.equal(await readFile(path.join(folder,'old.json.gz'),'utf8'),'old.json.gz');
  }finally{await rm(root,{recursive:true,force:true});}
});
