// Data identities must not depend on Git's checkout line endings. CRLF is
// intentional: it preserves the identities of the existing Windows-generated
// pre-rendered observations. Binary source recordings remain byte-for-byte.
export function sourceRevisionBytes(file, bytes) {
  return /\.(?:py|js|mjs|json)$/.test(file)
    ? Buffer.from(bytes.toString('utf8').replace(/\r?\n/g, '\r\n'))
    : bytes;
}
