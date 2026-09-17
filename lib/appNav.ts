/** The app navigation: 30 destinations, grouped by the work they serve.
 *
 *  The groups used to follow the org chart -- فروش، تحویل، مالی، انبار، مدیریت -- which
 *  read well for an owner and badly for everyone else: once a role's unreachable tabs were
 *  hidden, a salesperson was left with three one-item menus and a «مدیریت» menu while
 *  managing nobody. Each group now answers "what am I doing": my day, a customer, an order
 *  and the money it brings, getting goods out, reading the numbers, running the team,
 *  setting up the organisation. A group that holds one tab for a role is drawn as a plain
 *  link (see pillModel), so no role pays for a menu it cannot fill.
 *
 *  Extracted from the layout so the shape can be tested -- the invariants that matter
 *  (every ready tab lands in exactly one group, no two visible tabs share a label or an
 *  href, where each destination lives) are asserted in tests/appNav.test.ts.
 *
 *  `ready` still gates a tab the way it did inline: a tab whose page does not exist for
 *  this role renders as a disabled span, because Next prefetches every <Link> and a link
 *  to a route the role cannot reach 404s in the console before anyone clicks it.
 */
import type { Role } from "./roles";

export type AppGroupId =
  | "day"
  | "customers"
  | "sales"
  | "ops"
  | "reports"
  | "team"
  | "org";

export const APP_GROUPS: { id: AppGroupId; label: string }[] = [
  { id: "day", label: "روز من" },
  { id: "customers", label: "مشتریان" },
  { id: "sales", label: "فروش و دریافت" },
  { id: "ops", label: "تحویل و انبار" },
  { id: "reports", label: "گزارش‌ها" },
  { id: "team", label: "تیم" },
  { id: "org", label: "تنظیمات سازمان" },
];

export type AppTab = {
  href: string;
  label: string;
  group: AppGroupId;
  /** False → renders as a disabled span for this role. */
  ready: boolean;
};

const isManager = (r: Role) => r === "owner" || r === "group_manager";
const isRepLead = (r: Role) => r === "owner" || r === "group_manager" || r === "rep_manager";

/** The full tab list for a role, in display order, each tab tagged with its group.
 *
 *  Labels are chosen so no two sit next to each other reading alike. Four used to open
 *  with «مسیر»; now the order pipeline is «تابلوی سفارش‌ها», one order's life is
 *  «پیگیری سفارش», the day's van trips are «سفرهای تحویل», and only «مسیریابی» (building
 *  the routes) and «برنامه‌ریز مسیر» (ordering a day's visits) keep the word.
 */
export function appTabs(session: { role: Role }): AppTab[] {
  const r = session.role;
  return [
    // روز من
    { href: "/sales/today", label: "امروز", group: "day", ready: true },
    { href: "/sales/pocket", label: "کارهای من", group: "day", ready: true },
    { href: "/sales/schedule", label: "برنامهٔ بازدید", group: "day", ready: true },
    { href: "/planner", label: "برنامه‌ریز مسیر", group: "day", ready: r !== "salesperson" },

    // مشتریان
    { href: "/crm", label: "مشتریان و سرنخ‌ها", group: "customers", ready: r !== "driver" },
    { href: "/map", label: "نقشهٔ پوشش", group: "customers", ready: true },
    { href: "/leads", label: "پین‌های نقشه", group: "customers", ready: isRepLead(r) },
    { href: "/sales/complaints", label: "شکایات", group: "customers", ready: true },
    { href: "/gallery", label: "گالری تصاویر", group: "customers", ready: true },

    // فروش و دریافت
    { href: "/sales/orders", label: "سفارش‌ها", group: "sales", ready: true },
    { href: "/sales/board", label: "تابلوی سفارش‌ها", group: "sales", ready: true },
    { href: "/sales/journey", label: "پیگیری سفارش", group: "sales", ready: true },
    { href: "/sales/products", label: "کالاها و قیمت‌ها", group: "sales", ready: true },
    { href: "/sales/payments", label: "دریافت‌ها", group: "sales", ready: true },
    { href: "/sales/cheques", label: "چک‌ها", group: "sales", ready: isManager(r) },
    { href: "/sales/commission", label: "پورسانت", group: "sales", ready: true },

    // تحویل و انبار
    { href: "/sales/runs", label: "سفرهای تحویل", group: "ops", ready: r !== "salesperson" },
    { href: "/sales/deliveries", label: "تحویل‌ها", group: "ops", ready: isManager(r) },
    { href: "/sales/routing", label: "مسیریابی", group: "ops", ready: isManager(r) },
    { href: "/sales/stock", label: "انبار و خرید", group: "ops", ready: true },
    { href: "/sales/batches", label: "سری‌های ساخت", group: "ops", ready: isManager(r) },

    // گزارش‌ها
    { href: "/sales", label: "خلاصهٔ فروش", group: "reports", ready: true },
    { href: "/sales/dashboard", label: "تحلیل فروش", group: "reports", ready: true },
    { href: "/sales/forecast", label: "پیش‌بینی", group: "reports", ready: isManager(r) },
    /* Coverage report. `ready` mirrors proxy.ts, which denies a salesperson /report
       because it aggregates a whole group's revenue, debt and coverage. */
    { href: "/report", label: "گزارش پوشش", group: "reports", ready: r !== "salesperson" },

    // تیم
    { href: "/sales/tasks", label: "کارتابل", group: "team", ready: isRepLead(r) },
    { href: "/sales/reps", label: "نمایندگان فروش", group: "team", ready: isRepLead(r) },
    { href: "/sales/academy", label: "آموزش", group: "team", ready: true },

    // تنظیمات سازمان
    { href: "/sales/admin/users", label: "کاربران", group: "org", ready: r === "owner" },
    { href: "/sales/admin/groups", label: "گروه‌ها", group: "org", ready: r === "owner" },
    { href: "/facilities", label: "مکان‌های ما", group: "org", ready: r === "owner" },
  ];
}

/** The group whose tab is currently active, by longest-prefix match on the pathname.
 *  Falls back to the first group that has a ready tab. */
export function activeGroup(pathname: string, tabs: AppTab[]): AppGroupId {
  const hit = tabs
    .filter((t) => t.ready && (pathname === t.href || pathname.startsWith(`${t.href}/`)))
    .sort((a, b) => b.href.length - a.href.length)[0];
  if (hit) return hit.group;
  return tabs.find((t) => t.ready)?.group ?? APP_GROUPS[0].id;
}
