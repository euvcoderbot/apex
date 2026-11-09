// Lap-telemetry packs served from the Site's R2 bucket (DATA_CACHE) instead of the deployment package, which has a
// 256 MiB limit the season's packs outgrow. The package still ships each folder's index.json; the packs themselves are
// uploaded once to R2 (scripts/upload-lap-packs.mjs) and read from there when the package does not contain them.
//
// Uploads need no secret: a pack's filename is the first 24 hex digits of the SHA-256 of its bytes, and the deployed
// index lists every pack that belongs. An upload is stored only when its name is listed in that index and its bytes
// hash to that name, so the most anyone can upload is the exact published file. Nothing else can be written.

export const REMOTE_FOLDERS = ['local-telemetry', 'telemetry'];
export const MAX_PACK_BYTES = 32 * 1024 * 1024;
const FOLDERS = REMOTE_FOLDERS.join('|');
const READ = new RegExp(`^/apex/assets/data/(${FOLDERS})/([a-f0-9]{24}\\.json\\.gz)$`);
const WRITE = new RegExp(`^/api/lap-packs/(${FOLDERS})/([a-f0-9]{24}\\.json\\.gz)$`);
const pack = match => match && {folder: match[1], file: match[2], key: `lap-packs/${match[1]}/${match[2]}`};

/** A pack request the Worker may answer from R2: `{folder, file, key}`, or null. */
export const packRead = pathname => pack(READ.exec(pathname));
/** An upload request: `{folder, file, key}`, or null. */
export const packWrite = pathname => pack(WRITE.exec(pathname));

const headers = {'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff'};
const reply = (status, detail) => new Response(JSON.stringify({detail}), {status, headers: {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}});

/** The packaged file when there is one, otherwise the R2 copy (content-addressed, so cacheable forever). */
export async function servePack(request, env, target) {
  const asset = await env.ASSETS.fetch(request);
  if (asset.status !== 404 || !env.DATA_CACHE) return asset;
  const object = await env.DATA_CACHE.get(target.key);
  if (!object) return asset;
  return new Response(request.method === 'HEAD' ? null : object.body, {headers: {...headers, 'Content-Length': String(object.size)}});
}

async function sha24(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest.slice(0, 12), b => b.toString(16).padStart(2, '0')).join('');
}

/** Store an uploaded pack if, and only if, it is a published pack and the bytes are exactly that pack. */
export async function acceptPack(request, env, target, origin) {
  if (request.method !== 'PUT') return reply(405, 'PUT required');
  if (!env.DATA_CACHE) return reply(503, 'Storage unavailable');
  const declared = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > MAX_PACK_BYTES) return reply(413, 'Pack too large');
  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > MAX_PACK_BYTES) return reply(413, 'Pack empty or too large');
  if (`${await sha24(bytes)}.json.gz` !== target.file) return reply(422, 'Content does not match the pack name');
  const index = await env.ASSETS.fetch(new Request(new URL(`/apex/assets/data/${target.folder}/index.json`, origin)));
  if (!index.ok) return reply(503, 'Published index unavailable');
  const entries = Object.values((await index.json())?.entries || {}).map(entry => (typeof entry === 'string' ? entry : entry?.file));
  if (!entries.includes(target.file)) return reply(403, 'Not a published pack');
  if (await env.DATA_CACHE.head(target.key)) return new Response(null, {status: 204});
  await env.DATA_CACHE.put(target.key, bytes, {httpMetadata: {contentType: 'application/json'}});
  return new Response(null, {status: 201});
}
