/** UUIDv7 (RFC 9562): a 48-bit big-endian Unix-millisecond timestamp followed by 74
 *  random bits, with the version and variant fields set.
 *
 *  Time-ordered, so the outbox's natural sort is roughly causal and two mutations queued
 *  a second apart never collide. This IS the client_uuid -- the idempotency key the
 *  server upserts on.
 */

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  // Web Crypto is a global in Node 19+, modern browsers and service workers.
  globalThis.crypto.getRandomValues(out);
  return out;
}

function hex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

export function uuidv7(nowMs: number = Date.now()): string {
  const ts = Math.floor(nowMs);
  const bytes = new Uint8Array(16);

  // 48-bit timestamp, big-endian, in bytes 0..5
  bytes[0] = (ts / 2 ** 40) & 0xff;
  bytes[1] = (ts / 2 ** 32) & 0xff;
  bytes[2] = (ts / 2 ** 24) & 0xff;
  bytes[3] = (ts / 2 ** 16) & 0xff;
  bytes[4] = (ts / 2 ** 8) & 0xff;
  bytes[5] = ts & 0xff;

  const rnd = randomBytes(10);
  bytes.set(rnd, 6);

  // version 7 in the high nibble of byte 6
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  // RFC 4122 variant (10xx) in the high bits of byte 8
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const h = hex(bytes);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** The millisecond timestamp packed into a v7 id. */
export function uuidv7Time(id: string): number {
  const h = id.replace(/-/g, "").slice(0, 12);
  return parseInt(h, 16);
}

export const UUIDV7_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
