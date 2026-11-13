/* E17: sign out after idle hours, per role. Van roles and reps never: a driver in a van with no signal must not
 * lose the work waiting to sync. Example: {"owner": 12} -> an owner who has not used the app for 12 hours is asked to
 * sign in again; a driver is never asked. */
import { isVanRole, type Role } from "@/lib/roles";

/** Roles an owner may set an idle limit for. */
export const IDLE_ROLES = ["owner", "group_manager", "rep_manager", "shareholder"] as const satisfies readonly Role[];
export const MAX_IDLE_HOURS = 720;

export type IdleRules = Partial<Record<Role, number>>;

/** Reads the stored map, keeping only roles that may have a limit and sane hours. */
export function parseIdleRules(json: string | null | undefined): IdleRules {
  if (!json) return {};
  try {
    const raw = JSON.parse(json) as Record<string, unknown>;
    const out: IdleRules = {};
    for (const role of IDLE_ROLES) {
      const h = raw[role];
      if (typeof h === "number" && Number.isInteger(h) && h >= 1 && h <= MAX_IDLE_HOURS) out[role] = h;
    }
    return out;
  } catch {
    return {};
  }
}

/** True when the person has been idle longer than their role's limit. `lastActiveMs` is the later of their last
 *  recorded activity and when this sign-in began. */
export function idleExpired(rules: IdleRules, role: Role, lastActiveMs: number, nowMs: number): boolean {
  if (isVanRole(role) || role === "phone_sales") return false;
  const hours = rules[role];
  return hours !== undefined && nowMs - lastActiveMs > hours * 3_600_000;
}
