import crypto from "node:crypto";

const COOKIE_NAME = "coverage_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days
const MAX_NAME_LEN = 60;

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET env var is not set");
  return s;
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", secret()).update(payload).digest("hex");
}

export interface SessionData {
  expiry: number;
  /** Optional display name the user typed at login -- who's making changes, not an
   *  auth boundary. Threaded into activity_log.changed_by so history entries can say
   *  who made a change, without building out full multi-user accounts. */
  name: string | null;
}

/** issued value: "<expiryEpochSeconds>:<base64url(name)>.<hmac>" (name segment is
 *  empty when none was given -- payload for a token with no name collapses back to
 *  the original plain "<expiry>.<hmac>" shape, so pre-existing cookies stay valid). */
export function createSessionToken(name?: string | null): string {
  const expiry = Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS;
  const trimmed = name?.trim().slice(0, MAX_NAME_LEN) || "";
  const payload = trimmed ? `${expiry}:${Buffer.from(trimmed).toString("base64url")}` : String(expiry);
  return `${payload}.${sign(payload)}`;
}

export function parseSessionToken(token: string | undefined | null): SessionData | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot === -1) return null;
  const payload = token.slice(0, dot);
  const mac = token.slice(dot + 1);

  const expected = sign(payload);
  const macBuf = Buffer.from(mac, "hex");
  const expectedBuf = Buffer.from(expected, "hex");
  if (macBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(macBuf, expectedBuf)) return null;

  const [expiryStr, namePart] = payload.split(":");
  const expiry = Number(expiryStr);
  if (!Number.isFinite(expiry) || expiry <= Math.floor(Date.now() / 1000)) return null;

  let name: string | null = null;
  if (namePart) {
    try {
      name = Buffer.from(namePart, "base64url").toString("utf8") || null;
    } catch {
      name = null;
    }
  }
  return { expiry, name };
}

export function verifySessionToken(token: string | undefined | null): boolean {
  return parseSessionToken(token) !== null;
}

export function checkPassword(candidate: string): boolean {
  const real = process.env.APP_PASSWORD;
  if (!real) throw new Error("APP_PASSWORD env var is not set");
  const a = Buffer.from(candidate);
  const b = Buffer.from(real);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Per-user accounts (additive, alongside the shared APP_PASSWORD above -- the shared
// password keeps working exactly as before, so adding named accounts can never lock
// the team out of the app). scrypt is Node's own built-in KDF, so this needs no new
// dependency. Stored as "salt:hash", both hex.
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const candidate = crypto.scryptSync(password, salt, expected.length);
  if (candidate.length !== expected.length) return false;
  return crypto.timingSafeEqual(candidate, expected);
}

/** Reads the display name out of the request's own session cookie -- for routes
 *  that log activity and want to attribute it, without threading a header through
 *  every mutating fetch() call site across the app. */
export function getActorName(req: { cookies: { get(name: string): { value: string } | undefined } }): string | null {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  return parseSessionToken(token)?.name ?? null;
}

export { COOKIE_NAME, MAX_AGE_SECONDS };
