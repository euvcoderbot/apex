/** Enforce the byte budget while consuming the stream, before allocating JSON. */
import {requireJsonDepth} from './json-depth.mjs';
export async function limitedJson(request: Request, maximum = 1_000_000, readTimeoutMs = 15_000): Promise<any> {
  if(!['','identity'].includes((request.headers.get('content-encoding')||'').toLowerCase()))throw Object.assign(Error('Compressed request bodies are not supported'),{status:415});
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maximum)) {
    throw Object.assign(new Error('Invalid or oversized request body'), {status: /^\d+$/.test(declared) ? 413 : 400});
  }
  const reader = request.body?.getReader();
  if (!reader) throw Object.assign(new Error('JSON body required'), {status: 400});
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(Error('Request body timed out'),{status:408})),readTimeoutMs);});
  try {
    for (;;) {
      const {value, done} = await Promise.race([reader.read(),deadline]);
      if (done) break;
      size += value.byteLength;
      if (size > maximum) {
        await reader.cancel().catch(() => {});
        throw Object.assign(new Error('Request too large'), {status: 413});
      }
      chunks.push(value);
    }
  } catch(error){void reader.cancel().catch(()=>{});throw error;}
  finally {clearTimeout(timer);reader.releaseLock();}
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { const text=new TextDecoder('utf-8', {fatal: true}).decode(bytes);requireJsonDepth(text);return JSON.parse(text); }
  catch { throw Object.assign(new Error('Invalid JSON'), {status: 400}); }
}
