import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {sourceRevisionBytes} from '../lib/source-revision.mjs';

test('source identities are independent of LF, CRLF and mixed checkout line endings',()=>{
  for(const file of ['server.py','session-state.js','lib/cache.mjs','recordings.json']){
    const inputs=['first\nsecond\nthird\n','first\r\nsecond\r\nthird\r\n','first\r\nsecond\nthird\r\n'];
    const hashes=inputs.map(text=>createHash('sha256').update(file).update(sourceRevisionBytes(file,Buffer.from(text))).digest('hex'));
    assert.equal(new Set(hashes).size,1,file);
    assert.equal(sourceRevisionBytes(file,Buffer.from(inputs[0])).toString(),inputs[1]);
    assert.notEqual(hashes[0],createHash('sha256').update(file).update(sourceRevisionBytes(file,Buffer.from('changed\n'))).digest('hex'));
  }
});

test('compressed and binary sources are never interpreted as text',()=>{
  const recording=gzipSync('first\nsecond\r\n');
  assert.equal(sourceRevisionBytes('recording.json.gz',recording),recording);
  const image=Buffer.from([0,13,10,255]);
  assert.equal(sourceRevisionBytes('track.png',image),image);
});
