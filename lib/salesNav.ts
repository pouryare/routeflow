/** The /sales navigation: 26 destinations, grouped into six.
 *
 *  Extracted from app/sales/layout.tsx so the shape can be tested -- the invariants that
 *  matter (every ready tab lands in exactly one group, no two visible tabs share a label
 *  or an href, nothing still points at the retired /sales/analysis) are asserted in
 *  tests/salesNav.test.ts.
 *
 *  `ready` still gates a tab the way it did inline: a tab whose page does not exist for
 *  this role renders as a disabled span, because Next prefetches every <Link> and a link
 *  to a route the role cannot reach 404s in the console before anyone clicks it.
 */
import type { Role } from "./roles";

export type SalesGroupId = "day" | "sales" | "delivery" | "money" | "stock" | "admin";

export const SALES_GROUPS: { id: SalesGroupId; label: string }[] = [
  { id: "day", label: "روز من" },
  { id: "sales", label: "فروش و سفارش" },
  { id: "delivery", label: "تحویل" },
  { id: "money", label: "مالی" },
  { id: "stock", label: "انبار" },
  { id: "admin", label: "مدیریت" },
];

export type SalesTab = {
  href: string;
  label: string;
  group: SalesGroupId;
  /** False → renders as a disabled span for this role. */
  ready: boolean;
};

const isManager = (r: Role) => r === "owner" || r === "group_manager";
const isRepLead = (r: Role) => r === "owner" || r === "group_manager" || r === "rep_manager";

/** The full tab list for a role, in display order, each tab tagged with its group.
 *
 *  Labels are chosen so no two sit next to each other reading alike: the day dashboard is
 *  «امروز» and the visit plan is «برنامهٔ بازدید»; the assignment board is «تقسیم کار» and
 *  the personal task board is «کارتابل»; the three «نمایندگان» became «نمایندگان فروش» /
 *  «تعریف نمایندگی»; «داشبورد» / «تحلیل» / «تحلیل و KPI» collapsed to one «تحلیل فروش»
 *  (/sales/dashboard), leaving «داشبورد» for the /sales landing overview only.
 */
export function salesTabs(session: { role: Role }): SalesTab[] {
  const r = session.role;
  return [
    // روز من
    { href: "/sales/today", label: "امروز", group: "day", ready: true },
    { href: "/sales/pocket", label: "پاکت", group: "day", ready: true },
    { href: "/sales/schedule", label: "برنامهٔ بازدید", group: "day", ready: true },
    { href: "/sales/journey", label: "مسیر سفارش", group: "day", ready: true },

    // فروش و سفارش
    { href: "/sales/dashboard", label: "تحلیل فروش", group: "sales", ready: true },
    { href: "/sales", label: "داشبورد", group: "sales", ready: true },
    { href: "/sales/orders", label: "سفارش‌ها", group: "sales", ready: true },
    { href: "/sales/forecast", label: "پیش‌بینی", group: "sales", ready: isManager(r) },
    { href: "/sales/products", label: "کالاها و قیمت‌ها", group: "sales", ready: true },
    { href: "/sales/commission", label: "پورسانت", group: "sales", ready: true },

    // تحویل
    { href: "/sales/runs", label: "مسیر تحویل", group: "delivery", ready: r !== "salesperson" },
    { href: "/sales/deliveries", label: "تحویل‌ها", group: "delivery", ready: isManager(r) },
    { href: "/sales/batches", label: "بچ‌ها", group: "delivery", ready: isManager(r) },
    { href: "/sales/routing", label: "مسیریابی", group: "delivery", ready: isManager(r) },

    // مالی
    { href: "/sales/payments", label: "دریافت‌ها", group: "money", ready: true },
    { href: "/sales/cheques", label: "چک‌ها", group: "money", ready: isManager(r) },

    // انبار
    { href: "/sales/stock", label: "انبار و خرید", group: "stock", ready: true },

    // مدیریت
    { href: "/sales/board", label: "تقسیم کار", group: "admin", ready: true },
    { href: "/sales/tasks", label: "کارتابل", group: "admin", ready: isRepLead(r) },
    { href: "/sales/reps", label: "نمایندگان فروش", group: "admin", ready: isRepLead(r) },
    { href: "/sales/academy", label: "آموزش", group: "admin", ready: true },
    { href: "/sales/complaints", label: "شکایات", group: "admin", ready: true },
    { href: "/sales/admin/users", label: "کاربران", group: "admin", ready: r === "owner" },
    { href: "/sales/admin/groups", label: "گروه‌ها", group: "admin", ready: r === "owner" },
    {
      href: "/sales/admin/representatives",
      label: "تعریف نمایندگی",
      group: "admin",
      ready: r === "owner" || r === "rep_manager",
    },
  ];
}

/** The group whose tab is currently active, by longest-prefix match on the pathname.
 *  Falls back to the first group that has a ready tab. */
export function activeSalesGroup(pathname: string, tabs: SalesTab[]): SalesGroupId {
  const hit = tabs
    .filter((t) => t.ready && (pathname === t.href || pathname.startsWith(`${t.href}/`)))
    .sort((a, b) => b.href.length - a.href.length)[0];
  if (hit) return hit.group;
  return tabs.find((t) => t.ready)?.group ?? SALES_GROUPS[0].id;
}
