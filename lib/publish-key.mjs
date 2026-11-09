// Public half of the Ed25519 key that signs data publishes (scripts/publish-data.mjs). The private half stays on the
// publishing PC (%USERPROFILE%\apex-data\publish-key.json) and is never committed. Empty: publishing is disabled.
// Created 2026-11-09. To rotate: move the old private key away, run `node scripts/publish-data.mjs --init-key`, put the new
// public key here and deploy; uploads signed with the old key are then refused.
export const PUBLISH_PUBLIC_KEY = 'OP/0ER8+DtxeKZugtOKH4nwpGs+WdjPXPmTGmp9I6C8=';
