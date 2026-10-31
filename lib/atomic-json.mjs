import {writeFile, rename, unlink, mkdir, open} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';

/** Readers see either the previous complete document or the new one. */
export async function atomicJson(target, value) {
  const temporary = target + '.' + randomUUID() + '.tmp';
  try { await writeFile(temporary, JSON.stringify(value)); await rename(temporary, target); }
  finally { await unlink(temporary).catch(() => {}); }
}

/** Shared with the Python capture exporter. Never steal an active writer's lock. */
export async function captureLock(root, run) {
  const dir = path.join(root, 'assets/data/local-captures');
  await mkdir(dir, {recursive: true});
  const lock = path.join(dir, 'index.lock');
  const handle = await open(lock, 'wx').catch(error => {
    if (error.code === 'EEXIST') throw Error('Another capture is updating the index; retry after it finishes.');
    throw error;
  });
  try { return await run(); }
  finally { await handle.close(); await unlink(lock).catch(() => {}); }
}
