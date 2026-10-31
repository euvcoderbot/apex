import test from 'node:test';
import assert from 'node:assert/strict';
import {sessionWithCircuitCorners} from '../corner-geometry.js';

test('local calculations receive physical circuit positions from the guide',async()=>{
  const session={year:2026,circuit_key:9,corners:[]};
  const result=await sessionWithCircuitCorners(session,async(key,year)=>{
    assert.equal(key,9);assert.equal(year,2026);
    return {corners:[{number:1,trackPosition:{x:'12',y:25}},{number:2,trackPosition:{x:null,y:2}}]};
  });
  assert.deepEqual(result.corners,[{number:'1',letter:'',x:12,y:25,angle:undefined,source:'circuit_position'}]);
  assert.deepEqual(session.corners,[]);
});
test('unavailable circuit metadata stays unavailable instead of being invented',async()=>{
  const session={year:2026,circuit_key:9,corners:[]};
  assert.equal(await sessionWithCircuitCorners(session,async()=>{throw new Error('offline');}),session);
  assert.equal(await sessionWithCircuitCorners(session,null),session);
});

