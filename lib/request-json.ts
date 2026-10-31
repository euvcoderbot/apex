/** Enforce the byte budget while consuming the stream, before allocating JSON. */
export async function limitedJson(request: Request, maximum = 1_000_000): Promise<any> {
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maximum)) {
    throw Object.assign(new Error('Invalid or oversized request body'), {status: /^\d+$/.test(declared) ? 413 : 400});
  }
  const reader = request.body?.getReader();
  if (!reader) throw Object.assign(new Error('JSON body required'), {status: 400});
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const {value, done} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) {
        await reader.cancel().catch(() => {});
        throw Object.assign(new Error('Request too large'), {status: 413});
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)); }
  catch { throw Object.assign(new Error('Invalid JSON'), {status: 400}); }
}
