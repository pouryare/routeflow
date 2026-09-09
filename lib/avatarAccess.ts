import type { Role } from "./roles";

/** Whether `viewer` may see the avatar image of a user belonging to `targetOrgId`.
 *
 *  Avatars are visible ORG-WIDE, not group-scoped like canReachUser in lib/session.ts --
 *  a shared task board or notification list needs to show a colleague's face regardless
 *  of which group that colleague is in, which canReachUser's stricter rule (salesperson/
 *  driver reach only themselves) would wrongly block. The tenant boundary is still real:
 *  a platform_owner may cross it, nobody else may. */
export function canViewUserAvatar(
  viewer: { role: Role; organizationId: number },
  targetOrgId: number,
): boolean {
  if (viewer.role === "platform_owner") return true;
  return viewer.organizationId === targetOrgId;
}
