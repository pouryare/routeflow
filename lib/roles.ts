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

export const ROLE_LABEL: Record<Role, string> = {
  platform_owner: "مدیر سامانه",
  owner: "مالک",
  group_manager: "مدیر گروه",
  rep_manager: "مدیر نمایندگان",
  phone_sales: "فروش تلفنی",
  field_rep: "بازدیدکننده میدانی",
  delivery_driver: "راننده تحویل",
};

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

/** Where a signed-in person lands. A van role never enters the sales shell; everyone else,
 *  the vendor's platform_owner included, starts on the day's briefing, which already
 *  scopes itself to "all" for them. */
export function homePathFor(role: Role): string {
  return isVanRole(role) ? "/driver" : "/sales/today";
}
