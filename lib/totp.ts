/** RFC 6238 time-based one-time passwords (SHA-1, 30 s step, 6 digits: what every authenticator app
 *  speaks) on Node's own crypto, with no dependency. Used for the founder's second login step. */

import crypto from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const STEP_SECONDS = 30;
const DIGITS = 6;

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of text.replace(/=+$/, "").toUpperCase()) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error("invalid base32");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function newTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

export function stepAt(nowMs: number): number {
  return Math.floor(nowMs / 1000 / STEP_SECONDS);
}

export function totpAt(secretBase32: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = crypto.createHmac("sha1", base32Decode(secretBase32)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS;
  return String(code).padStart(DIGITS, "0");
}

/** The step a code is valid for (the current one, or one either side for clock drift), or null.
 *  A step at or before `lastUsedStep` is refused, so a code seen once cannot be replayed. */
export function verifyTotp(secretBase32: string, code: string, lastUsedStep: number | null, nowMs = Date.now()): number | null {
  const clean = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(clean)) return null;
  const now = stepAt(nowMs);
  let hit: number | null = null;
  for (const step of [now - 1, now, now + 1]) {
    // Compare every window in constant time, so the answer does not depend on which one matched.
    const expected = Buffer.from(totpAt(secretBase32, step));
    if (crypto.timingSafeEqual(expected, Buffer.from(clean)) && (lastUsedStep === null || step > lastUsedStep)) hit = step;
  }
  return hit;
}

export function otpauthUri(secretBase32: string, account: string, issuer = "RouteFlow"): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}
