import { getDb } from "@/lib/db";
import { IDLE_ROLES, MAX_IDLE_HOURS, parseIdleRules, type IdleRules } from "@/lib/idleSignout";

const TTL_MS = 60_000;
const cache = new Map<number, { rules: IdleRules; until: number }>();

/** The company's idle limits, remembered for a minute (asked on every request). */
export async function idleRulesFor(organizationId: number): Promise<IdleRules> {
  const hit = cache.get(organizationId);
  if (hit && hit.until > Date.now()) return hit.rules;
  const r = (await getDb().prepare("SELECT idle_signout_json FROM organizations WHERE id = ?").get(organizationId)) as { idle_signout_json: string | null } | undefined;
  const rules = parseIdleRules(r?.idle_signout_json);
  cache.set(organizationId, { rules, until: Date.now() + TTL_MS });
  return rules;
}

/** Saves the limits ({role: hours}, 0 or empty = never); returns a problem in words, or null. */
export async function setIdleRules(organizationId: number, hours: Record<string, unknown>): Promise<string | null> {
  const out: IdleRules = {};
  for (const role of IDLE_ROLES) {
    const h = Number(hours[role] ?? 0);
    if (!Number.isInteger(h) || h < 0 || h > MAX_IDLE_HOURS) return `ساعت باید بین ۱ تا ${MAX_IDLE_HOURS} باشد (یا خالی برای «هرگز»)`;
    if (h > 0) out[role] = h;
  }
  await getDb().prepare("UPDATE organizations SET idle_signout_json = ? WHERE id = ?").run(Object.keys(out).length ? JSON.stringify(out) : null, organizationId);
  cache.delete(organizationId);
  return null;
}

const touched = new Map<number, number>();
const TOUCH_EVERY_MS = 5 * 60_000;

/** Notes that this person used the app, at most every five minutes per server process. */
export async function touchActive(userId: number, nowMs = Date.now()): Promise<void> {
  if ((touched.get(userId) ?? 0) > nowMs - TOUCH_EVERY_MS) return;
  if (touched.size > 5000) touched.clear();
  touched.set(userId, nowMs);
  await getDb().prepare("UPDATE users SET last_active_at = ? WHERE id = ?").run(new Date(nowMs).toISOString(), userId);
}
