/** FB34: the owner's access review, from the user list and the sign-in log. Pure. */
import { MANAGE_ROLES, type Role } from "@/lib/roles";

export interface AccessUser {
  id: number;
  display_name: string;
  role: Role;
  last_sign_in: string | null;
  has_authenticator: boolean;
}

export interface AccessReview {
  byRole: { role: Role; n: number }[];
  neverSignedIn: AccessUser[];
  managersWithoutCode: AccessUser[];
  idle30: AccessUser[];
}

const IDLE_DAYS = 30;

/** Active users only; idle means signed in before, but not for IDLE_DAYS. */
export function accessReview(users: readonly AccessUser[], nowIso: string): AccessReview {
  const cutoff = Date.parse(nowIso) - IDLE_DAYS * 86_400_000;
  const counts = new Map<Role, number>();
  for (const u of users) counts.set(u.role, (counts.get(u.role) ?? 0) + 1);
  return {
    byRole: [...counts.entries()].map(([role, n]) => ({ role, n })).sort((a, b) => b.n - a.n),
    neverSignedIn: users.filter((u) => !u.last_sign_in),
    managersWithoutCode: users.filter((u) => MANAGE_ROLES.includes(u.role) && !u.has_authenticator),
    idle30: users.filter((u) => u.last_sign_in !== null && Date.parse(u.last_sign_in) < cutoff),
  };
}
