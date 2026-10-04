/** Who someone is, in a module a browser can import.
 *
 *  This union used to live in db.ts, which is the natural home for it -- except that
 *  db.ts imports node:sqlite, so no client component can touch it. The admin screen
 *  therefore kept its own hand-copied duplicate of the same four strings, and the two
 *  drifted the first time a role was added: a `Record<Role, string>` in one file cannot
 *  notice a union that changed in another.
 *
 *  So the union lives here, with no dependencies at all, and db.ts re-exports it. Adding
 *  a role is now one edit that the type checker propagates everywhere.
 */

export type Role =
  | "platform_owner"
  | "owner"
  | "group_manager"
  | "rep_manager"
  | "phone_sales"
  | "field_rep"
  | "delivery_driver";

/** Ordered widest access first, which is also the order they read best in a dropdown. */
export const ROLES: Role[] = [
  "platform_owner",
  "owner",
  "group_manager",
  "rep_manager",
  "phone_sales",
  "field_rep",
  "delivery_driver",
];

/** The two roles that work a route in a vehicle.
 *
 *  A gate written as `role === "driver"` fails OPEN the moment a second van role exists:
 *  the comparison is simply false, so the gate admits everything instead of refusing. That
 *  is how a field rep ends up holding the whole sales shell. Gate on membership here. */
export const VAN_ROLES: Role[] = ["field_rep", "delivery_driver"];

export function isVanRole(role: Role): boolean {
  return VAN_ROLES.includes(role);
}

/** Roles that manage: full authority inside their own scope.
 *
 *  `platform_owner` is a strict SUPERSET of `owner` — the god key, used only when the
 *  founder acts as himself. The scoping layer in lib/session.ts has treated it as
 *  all-powerful since Phase 0a (`scopeGroupIds` → "all", `orgFilter` → empty); what was
 *  missing was its name in the 185 gates that spelled their own role list.
 *
 *  This constant is that name, stated once, so `tsc` propagates it and
 *  tests/platform-owner-reach.test.ts can assert it against the real source tree.
 *
 *  NOT every role list is a management list. The order state machine's `OrderRole`, the
 *  per-role data-scoping queries, `SELF_ROLES` and the van-only lists are deliberately
 *  excluded — those ask "who does this job", not "who is in charge". */
export const MANAGE_ROLES: Role[] = ["platform_owner", "owner", "group_manager"];

/** Owner-only gates, plus the god key.
 *
 *  A DISTINCT constant from `MANAGE_ROLES`, and the distinction is load-bearing: a bare
 *  `["owner"]` in the original code meant "the owner of this organisation", NOT "any
 *  manager". Swapping those two for MANAGE_ROLES quietly granted group_manager the
 *  organisation's own user list, group CRUD, commission rates, payments and catalogue
 *  writes — and six test files said so immediately.
 *
 *  Kept separate rather than folded in so a future sweep cannot make the same swap: the
 *  name says which is which, and `OWNER_ROLES` reads as owner-only at the call site. */
export const OWNER_ROLES: Role[] = ["platform_owner", "owner"];

/** Owner-only, INCLUDING the platform's god key.
 *
 *  Derived from `OWNER_ROLES` on purpose. Writing `r === "owner"` at a call site is the bug
 *  this exists to prevent: it is correct for everything except `platform_owner`, who is a
 *  strict superset and would be locked out of the accounting section by a gate that reads
 *  right, tests green, and looks deliberate. */
export const isOwner = (r: Role) => OWNER_ROLES.includes(r);

export const ROLE_LABEL: Record<Role, string> = {
  platform_owner: "مدیر سامانه",
  owner: "مالک",
  group_manager: "مدیر گروه",
  rep_manager: "مدیر نمایندگان",
  phone_sales: "فروش تلفنی",
  field_rep: "بازدیدکننده میدانی",
  delivery_driver: "راننده تحویل",
};

/** Names the `Role` union RETIRED but `users.role`'s CHECK still admits, on purpose.
 *
 *  'driver' split into `field_rep` + `delivery_driver` and 'salesperson' into `phone_sales`.
 *  The CHECK keeps admitting both so an account created by a script that predates the split
 *  keeps working instead of failing to log in — see tests/salesperson-role.test.ts, which
 *  asserts the insert still succeeds. Retiring a NAME and refusing the old ROWS are two
 *  different decisions, and only the second one was taken.
 *
 *  The hazard is that the retirement is invisible in the type. `lib/session.ts` and
 *  `user_roles_after_insert` both launder these strings through `as Role`, so the picker
 *  receives "driver" wearing a `Role` costume — and `ROLE_LABEL[r] ?? r` then printed the
 *  raw English token on a Persian screen. Four components had that fallback.
 *
 *  So: the labels live here, and `roleLabel()` is the only sanctioned way to name a role.
 *  tests/role-label-legacy.test.ts reads this CHECK back out of db.ts and fails if anything
 *  storable lacks a label, which is what stops the next retirement from repeating this. */
export const RETIRED_ROLE_LABEL: Record<string, string> = {
  driver: "راننده",
  salesperson: "فروشنده",
};

/** The Persian name for a role, whatever version of the name the row still carries.
 *
 *  Total on purpose: the last argument is a human-facing placeholder, never the raw token.
 *  Returning "driver" to a Persian reader is the bug this exists to make impossible. */
export function roleLabel(role: string): string {
  return (
    ROLE_LABEL[role as Role] ??
    RETIRED_ROLE_LABEL[role] ??
    "نامشخص" // نامشخص = "unknown" — a Persian word, not an empty button.
  );
}

/** What each role is for, shown beside the picker when creating an account -- the labels
 *  alone do not say that a فروشنده sees only their own orders. */
export const ROLE_DESCRIPTION: Record<Role, string> = {
  platform_owner: "دسترسی به همه سازمان‌ها — فقط برای پشتیبانی سامانه",
  owner: "دسترسی کامل به همه گروه‌ها، حساب‌ها و گزارش‌های سازمان خودش",
  group_manager: "همه مشتریان، مناطق و سفارش‌های گروه خودش",
  rep_manager: "نمایندگان سازمان خودش — پروفایل، مراحل پذیرش و اهداف؛ بدون دسترسی به مناطق گروه‌ها",
  phone_sales: "فقط سفارش‌هایی که خودش ثبت کرده، تماس‌هایش و پورسانت خودش",
  field_rep: "بازدیدها و مسیرهای میدانی خودش — مشتری‌های گروه خودش",
  delivery_driver: "فقط مسیر و تحویل‌های امروز خودش",
};

/** Whether this role's browser runs the offline sync client at all.
 *
 * `platform_owner` is the vendor, not a field device: they are the one account that spans
 * every tenant, so there is no single organisation whose rows a pull could hand them. The
 * answer is stated HERE rather than at each of the three places that need it — the two
 * routes, and the shell that decides whether to mount the client — because a
 * `role === "platform_owner"` written out a third time is a list that can drift, which is
 * exactly the failure mode MANAGE_ROLES and OWNER_ROLES exist to prevent.
 *
 * NOT the same question as MANAGE_ROLES/OWNER_ROLES, so deliberately not derived from
 * them: those ask "is this person in charge", this asks "does this person work from a
 * device that goes offline". Deriving one from the other would silently enrol a role the
 * moment it was promoted to management.
 *
 * The routes keep their own refusal even though the shell now declines to ask. The route is
 * the authoritative, DB-backed check — this is a hint that spares the browser a request,
 * not the thing standing between a cross-tenant pull and the wrong account. */
export function hasSyncClient(role: Role): boolean {
  return role !== "platform_owner";
}

/** Where a signed-in person lands. A van role never enters the sales shell; everyone else,
 *  the vendor's platform_owner included, starts on the day's briefing, which already
 *  scopes itself to "all" for them. */
export function homePathFor(role: Role): string {
  return isVanRole(role) ? "/driver" : "/sales/today";
}
