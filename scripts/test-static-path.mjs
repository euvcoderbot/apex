import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {publicAssetPath} from '../lib/static-path.mjs';
for(const [name,paths,root] of [['Windows',path.win32,'C:/site/public'],['POSIX',path.posix,'/site/public']]){
  test(`${name} static paths reject malformed encoding and sibling-prefix traversal`,()=>{
    assert.equal(publicAssetPath(root,'/apex/index.html',paths),paths.resolve(root,'apex/index.html'));
    for(const p of ['/apex/%','/apex/%00','/apex/%5c..'])assert.throws(()=>publicAssetPath(root,p,paths),e=>e.status===400);
    assert.throws(()=>publicAssetPath(root,'/%2e%2e%2fpublic-private/secret.txt',paths),e=>e.status===403);
  });
}
