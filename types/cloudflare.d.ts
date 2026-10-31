// The parts of the Cloudflare Workers runtime this project uses. The full typings
// (@cloudflare/workers-types) redeclare DOM globals such as Response and fetch,
// which conflicts with the browser code in this one program, so only these are declared.
declare module 'cloudflare:workers' {
  export const env: Record<string, unknown>;
}
interface Fetcher { fetch(input: Request | string, init?: RequestInit): Promise<Response>; }
interface D1Database { prepare(query: string): unknown; }
