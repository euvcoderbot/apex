// Published data lives in the Site's R2 bucket (DATA_CACHE), not in the deployment package. The page keeps reading
// `assets/data/<folder>/<file>`; the Worker answers those paths from R2. Publishing is an upload from this PC
// (scripts/publish-data.mjs), so new sessions go live without a redeploy.
//
// Every upload is signed with an Ed25519 key kept on the publishing PC; the Worker holds only the public key
// (lib/publish-key.mjs), so the server has no secret to leak. The signature covers the exact path, the SHA-256 of the
// bytes and the signing time. Content-addressed files (24 hex digits of their SHA-256 + .json.gz) must also match their
// name. Files that change (index.json, events/<year>.json) cannot be replaced by an older signed copy (no rollback by
// replaying an earlier upload), and a signature older than a day is refused.
import {PUBLISH_PUBLIC_KEY} from './publish-key.mjs';

export const DATA_FOLDERS = ['local-captures', 'prerendered', 'sessions', 'local-telemetry', 'telemetry', 'season', 'events'];
export const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_SIGNATURE_AGE_MS = 24 * 3600e3, MAX_CLOCK_SKEW_MS = 10 * 60e3;
const NAME = '(index\\.json|\\d{4}\\.json|[a-f0-9]{20,64}\\.json(?:\\.gz)?)';
const FOLDERS = DATA_FOLDERS.join('|');
const READ = new RegExp(`^/apex/assets/data/(${FOLDERS})/${NAME}$`);
const WRITE = new RegExp(`^/api/publish/(${FOLDERS})/${NAME}$`);
const target = match => match && {folder: match[1], file: match[2], key: `data/${match[1]}/${match[2]}`,
  mutable: match[2] === 'index.json' || /^\d{4}\.json$/.test(match[2]), hashed: /^[a-f0-9]{24}\.json\.gz$/.test(match[2])};

/** A published-data path the Worker answers: `{folder, file, key, mutable, hashed}`, or null. */
export const dataRead = pathname => target(READ.exec(pathname));
/** A publish (upload) path: `{folder, file, key, mutable, hashed}`, or null. */
export const dataWrite = pathname => target(WRITE.exec(pathname));

const bytesToHex = bytes => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
const base64ToBytes = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));
export const sha256Hex = async bytes => bytesToHex(await crypto.subtle.digest('SHA-256', bytes));
/** The exact text a publisher signs for one upload. */
export const signedMessage = (folder, file, hashHex, signedAt) => `apex-publish-v1\n${folder}/${file}\n${hashHex}\n${signedAt}`;

const reply = (status, detail) => new Response(JSON.stringify({detail}), {status, headers: {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}});
const IMMUTABLE = 'public, max-age=31536000, immutable', REVALIDATE = 'public, max-age=0, must-revalidate';

/**
 * Serve published data. Files that change come from R2 first (a publish is newer than any deployment); content-addressed
 * files come from the package when bundled, otherwise from R2. Missing everywhere: the package's own 404.
 */
export async function serveData(request, env, t) {
  const fromBucket = async () => {
    const object = env.DATA_CACHE ? await env.DATA_CACHE.get(t.key) : null;
    if (!object) return null;
    const etag = object.httpEtag;
    if (etag && request.headers.get('If-None-Match') === etag) return new Response(null, {status: 304, headers: {ETag: etag, 'Cache-Control': t.mutable ? REVALIDATE : IMMUTABLE}});
    return new Response(request.method === 'HEAD' ? null : object.body, {headers: {
      'Content-Type': 'application/json', 'Cache-Control': t.mutable ? REVALIDATE : IMMUTABLE, 'X-Content-Type-Options': 'nosniff',
      'Content-Length': String(object.size), ...(etag ? {ETag: etag} : {})}});
  };
  if (t.mutable) return (await fromBucket()) || env.ASSETS.fetch(request);
  const asset = await env.ASSETS.fetch(request);
  if (asset.status !== 404) return asset;
  return (await fromBucket()) || asset;
}

const keys = new Map();
async function verifySignature(message, signatureB64, keyB64) {
  if (!keys.has(keyB64)) keys.set(keyB64, crypto.subtle.importKey('raw', base64ToBytes(keyB64), {name: 'Ed25519'}, false, ['verify']));
  try { return await crypto.subtle.verify({name: 'Ed25519'}, await keys.get(keyB64), base64ToBytes(signatureB64), new TextEncoder().encode(message)); }
  catch { return false; }
}

/** Store one signed upload. (`publicKey` is overridable for tests only; the Worker uses lib/publish-key.mjs.) */
export async function acceptPublish(request, env, t, {now = Date.now(), publicKey = PUBLISH_PUBLIC_KEY} = {}) {
  if (request.method !== 'PUT') return reply(405, 'PUT required');
  if (!env.DATA_CACHE) return reply(503, 'Storage unavailable');
  if (!publicKey) return reply(503, 'Publishing is not configured');
  const signedAt = request.headers.get('X-Apex-Signed-At') || '', signature = request.headers.get('X-Apex-Signature') || '';
  const signedTime = Date.parse(signedAt);
  if (!signature || !Number.isFinite(signedTime)) return reply(401, 'Signature required');
  if (signedTime > now + MAX_CLOCK_SKEW_MS || signedTime < now - MAX_SIGNATURE_AGE_MS) return reply(401, 'Signature expired');
  const declared = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > MAX_FILE_BYTES) return reply(413, 'File too large');
  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > MAX_FILE_BYTES) return reply(413, 'File empty or too large');
  const hash = await sha256Hex(bytes);
  if (!(await verifySignature(signedMessage(t.folder, t.file, hash, signedAt), signature, publicKey))) return reply(403, 'Bad signature');
  if (t.hashed && `${hash.slice(0, 24)}.json.gz` !== t.file) return reply(422, 'Content does not match the file name');
  if (!t.mutable) {
    if (await env.DATA_CACHE.head(t.key)) return new Response(null, {status: 204});
  } else {
    const current = await env.DATA_CACHE.head(t.key);
    const currentAt = Date.parse(current?.customMetadata?.signedAt || '');
    if (Number.isFinite(currentAt) && signedTime <= currentAt) return reply(409, 'A newer version is already published');
  }
  await env.DATA_CACHE.put(t.key, bytes, {httpMetadata: {contentType: 'application/json'}, customMetadata: {signedAt, sha256: hash}});
  return new Response(null, {status: 201});
}
