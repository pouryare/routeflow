/** The founder's second login step: enrolment, checking a code at sign-in, recovery codes.
 *
 *  The TOTP secret is stored encrypted (AES-256-GCM under a key derived from SESSION_SECRET), so a
 *  copy of the database alone cannot mint codes. Recovery codes are stored as scrypt-free SHA-256 of
 *  a long random value: they carry 50 bits each and are single use, so a fast hash is enough. */

import crypto from "node:crypto";
import { getDb } from "@/lib/db";
import { deriveKey } from "@/lib/auth";
import { newTotpSecret, otpauthUri, verifyTotp } from "@/lib/totp";

const KEY_PURPOSE = "totp-secret";
const RECOVERY_CODE_COUNT = 8;

function seal(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", deriveKey(KEY_PURPOSE), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((b) => b.toString("base64url")).join(".");
}

function open(sealed: string): string | null {
  try {
    const [iv, tag, body] = sealed.split(".").map((p) => Buffer.from(p, "base64url"));
    const decipher = crypto.createDecipheriv("aes-256-gcm", deriveKey(KEY_PURPOSE), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
  } catch {
    return null; // a changed SESSION_SECRET or a damaged value reads as "no usable secret"
  }
}

interface Row {
  totp_secret: string | null;
  totp_enabled_at: string | null;
  totp_last_step: number | null;
}

async function row(userId: number): Promise<Row | undefined> {
  return await getDb().prepare("SELECT totp_secret, totp_enabled_at, totp_last_step FROM users WHERE id = ?").get(userId) as Row | undefined;
}

/** Does signing in as this user need a second step? */
export async function secondFactorRequired(userId: number): Promise<boolean> {
  const r = await row(userId);
  return !!r?.totp_secret && !!r.totp_enabled_at;
}

export async function secondFactorStatus(userId: number): Promise<{ enabled: boolean; pending: boolean; recoveryLeft: number }> {
  const r = await row(userId);
  const left = (await getDb().prepare("SELECT COUNT(*) AS n FROM user_recovery_codes WHERE user_id = ? AND used_at IS NULL").get(userId) as { n: number }).n;
  return { enabled: !!r?.totp_enabled_at, pending: !!r?.totp_secret && !r.totp_enabled_at, recoveryLeft: left };
}

/** Starts (or restarts) enrolment: a fresh secret that does nothing until a code from it is confirmed. */
export async function beginEnrollment(userId: number, account: string): Promise<{ secret: string; uri: string } | null> {
  const r = await row(userId);
  if (r?.totp_enabled_at) return null; // already on: turn it off first
  const secret = newTotpSecret();
  await getDb().prepare("UPDATE users SET totp_secret = ?, totp_enabled_at = NULL, totp_last_step = NULL WHERE id = ?").run(seal(secret), userId);
  return { secret, uri: otpauthUri(secret, account) };
}

function recoveryHash(code: string): string {
  return crypto.createHash("sha256").update(code.replace(/[\s-]/g, "").toLowerCase()).digest("hex");
}

function newRecoveryCodes(): string[] {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const raw = crypto.randomBytes(5).toString("hex"); // 40 bits
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}

/** Turns the second step on if `code` matches the pending secret. Returns the recovery codes ONCE. */
export async function confirmEnrollment(userId: number, code: string): Promise<string[] | null> {
  const r = await row(userId);
  if (!r?.totp_secret || r.totp_enabled_at) return null;
  const secret = open(r.totp_secret);
  if (!secret) return null;
  const step = verifyTotp(secret, code, null);
  if (step === null) return null;
  const db = getDb();
  const codes = newRecoveryCodes();
  const now = new Date().toISOString();
  await db.tx(async () => {
    await db.prepare("UPDATE users SET totp_enabled_at = ?, totp_last_step = ?, token_version = token_version + 1 WHERE id = ?").run(now, step, userId);
    await db.prepare("DELETE FROM user_recovery_codes WHERE user_id = ?").run(userId);
    const ins = db.prepare("INSERT INTO user_recovery_codes (user_id, code_hash, created_at) VALUES (?, ?, ?)");
    for (const c of codes) await ins.run(userId, recoveryHash(c), now);
  });
  return codes;
}

/** Checks the second step at sign-in: a current code (each time step usable once) or an unused recovery code. */
export async function checkSecondFactor(userId: number, code: string): Promise<boolean> {
  const r = await row(userId);
  if (!r?.totp_secret || !r.totp_enabled_at) return false;
  const db = getDb();
  const secret = open(r.totp_secret);
  if (secret) {
    const step = verifyTotp(secret, code, r.totp_last_step);
    if (step !== null) {
      // Only advance: two simultaneous requests with the same code cannot both pass.
      const res = await db.prepare("UPDATE users SET totp_last_step = ? WHERE id = ? AND (totp_last_step IS NULL OR totp_last_step < ?)").run(step, userId, step);
      return res.changes > 0;
    }
  }
  const used = await db
    .prepare("UPDATE user_recovery_codes SET used_at = ? WHERE user_id = ? AND code_hash = ? AND used_at IS NULL")
    .run(new Date().toISOString(), userId, recoveryHash(code));
  return used.changes > 0;
}

/** Turns the second step off. Needs a valid code, so a hijacked session cannot quietly remove it. */
export async function disableSecondFactor(userId: number, code: string): Promise<boolean> {
  if (!await checkSecondFactor(userId, code)) return false;
  const db = getDb();
  await db.tx(async () => {
    await db.prepare("UPDATE users SET totp_secret = NULL, totp_enabled_at = NULL, totp_last_step = NULL, token_version = token_version + 1 WHERE id = ?").run(userId);
    await db.prepare("DELETE FROM user_recovery_codes WHERE user_id = ?").run(userId);
  });
  return true;
}
