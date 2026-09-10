import crypto from "node:crypto";
import type { Role } from "./db";

// Bumped from "coverage_session". The v1 token carried an expiry and an optional display
// name and nothing else -- there is no uid, role or group to recover from one, so every
// v1 cookie has to be treated as invalid. Renaming makes that automatic instead of
// requiring backward-compatible parsing for a shape that can never satisfy the new
// authorisation checks. The cost is one forced re-login for everyone.
const COOKIE_NAME = "coverage_session_v2";
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

export interface SessionClaims {
  uid: number;
  role: Role;
  /** null for an owner, who is not scoped to a group. */
  gid: number | null;
  /** The tenant. A hint for proxy.ts, which has no safe route to the database -- the
   *  authoritative value is always re-read from the row in lib/session.ts. */
  oid: number;
  /** Snapshot of users.token_version. Bumping that column invalidates every token
   *  already issued to the user -- how a password reset or a deactivation takes effect
   *  immediately rather than in up to 30 days. */
  tv: number;
  exp: number;
  name: string;
  /** Set only while an owner is acting as this user (Login-As, lib/impersonation.ts): the
   *  owner's user id. lib/session.ts re-validates it on every request. */
  act?: number;
}

/** Token shape: "<base64url(JSON claims)>.<hmac-sha256 of that same base64url string>".
 *
 *  The claims are signed, not encrypted: anyone holding the cookie can read their own
 *  role out of it, which is fine. What matters is that they cannot change it -- editing
 *  any claim invalidates the MAC, and the MAC is verified before the JSON is ever
 *  parsed. */
export function createSessionToken(claims: Omit<SessionClaims, "exp">): string {
  const full: SessionClaims = {
    ...claims,
    name: (claims.name ?? "").trim().slice(0, MAX_NAME_LEN),
    exp: Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS,
  };
  const payload = Buffer.from(JSON.stringify(full)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function parseSessionToken(token: string | undefined | null): SessionClaims | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot === -1) return null;
  const payload = token.slice(0, dot);
  const mac = token.slice(dot + 1);

  // Verify before parsing: never hand attacker-controlled bytes to JSON.parse on the
  // strength of a signature you have not checked yet.
  const expected = sign(payload);
  const macBuf = Buffer.from(mac, "hex");
  const expectedBuf = Buffer.from(expected, "hex");
  if (macBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(macBuf, expectedBuf)) return null;

  let claims: SessionClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SessionClaims;
  } catch {
    return null;
  }

  if (typeof claims.uid !== "number" || typeof claims.exp !== "number") return null;
  if (claims.exp <= Math.floor(Date.now() / 1000)) return null;
  return claims;
}

export function verifySessionToken(token: string | undefined | null): boolean {
  return parseSessionToken(token) !== null;
}

// scrypt is Node's own built-in KDF, so this needs no new dependency.
// Stored as "salt:hash", both hex.
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

export { COOKIE_NAME, MAX_AGE_SECONDS };
