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
import { isVanRole, isOwner, OWNER_ROLES } from "./roles";

export type AppGroupId =
  | "day"
  | "customers"
  | "sales"
  | "ops"
  | "reports"
  | "accounts"
  | "team"
  | "org";

export const APP_GROUPS: { id: AppGroupId; label: string }[] = [
  { id: "day", label: "روز من" },
  { id: "customers", label: "مشتریان" },
  { id: "sales", label: "فروش و دریافت" },
  { id: "ops", label: "تحویل و انبار" },
  { id: "reports", label: "گزارش‌ها" },
  { id: "accounts", label: "حسابداری" },
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

/** Manager-and-above, INCLUDING the platform's god key.
 *
 *  Both of these used to read `r === "owner"` and were therefore correct for every role
 *  except one. `OWNER_ROLES` is `["platform_owner", "owner"]` — platform_owner is a
 *  documented strict superset of owner (lib/roles.ts:68) — so the platform account saw a
 *  menu missing every owner tab, and proxy.ts sent it away from the pages behind them.
 *
 *  Found by the bidirectional drift test in tests/proxy.test.ts, which asserts the nav and
 *  the gate tell the same story. Fixing only the gate would have made them disagree in the
 *  other direction; fixing only the nav would have hidden a page the gate admits. The
 *  constant is what makes one edit enough. */
const isManager = (r: Role) => OWNER_ROLES.includes(r) || r === "group_manager";
const isRepLead = (r: Role) => OWNER_ROLES.includes(r) || r === "group_manager" || r === "rep_manager";

/** A driver's whole menu, and the whole truth.
 *
 *  This is not the full list filtered down. It is written out, because a filter would
 *  leave behind every tab whose `ready` happens to be unconditional -- nineteen of them,
 *  of which a driver can open exactly one. A driver is in the shell for the lead run and
 *  the academy, so the alternative is a header offering eighteen destinations that
 *  proxy.ts answers with a redirect, and Next prefetching each <Link> before anyone
 *  clicks.
 *
 *  So this list is a mirror of the driver allowlist in proxy.ts, and the two are asserted
 *  against each other in tests/proxy.test.ts -- a tab marked ready here that the gate would
 *  redirect is a lie the driver can click, and that test is what stops it coming back.
 *
 *  Two tabs. /leads used to be the third, labelled «توقف‌های من» here and «پین‌های نقشه» on
 *  the same href for a rep lead -- one destination, two names, depending on who was
 *  holding the keys. The stops they drive are now the second section of /driver, where a
 *  dual-hat person sees them and their deliveries together rather than navigating between
 *  two pages for one working day.
 *
 *  The objection library is here because it is useful standing at the door, which is the
 *  same reason proxy.ts allowlists it.
 */
const DRIVER_TABS: AppTab[] = [
  { href: "/driver", label: "مسیر امروز", group: "day", ready: true },
  { href: "/sales/academy", label: "آموزش", group: "day", ready: true },
];

/** The full tab list for a role, in display order, each tab tagged with its group.
 *
 *  Labels are chosen so no two sit next to each other reading alike. Four used to open
 *  with «مسیر»; now the order pipeline is «تابلوی سفارش‌ها», one order's life is
 *  «پیگیری سفارش», the day's van trips are «سفرهای تحویل», and only «مسیریابی» (building
 *  the routes) and «برنامه‌ریز مسیر» (ordering a day's visits) keep the word.
 */
export function appTabs(session: { role: Role }): AppTab[] {
  const r = session.role;
  // Copied, not returned by reference: a caller that sorts or edits the result must not
  // be rearranging the shared constant for the next caller.
  if (isVanRole(r)) return DRIVER_TABS.map((t) => ({ ...t }));
  return [
    // روز من
    { href: "/sales/today", label: "امروز", group: "day", ready: true },
    { href: "/sales/pocket", label: "کارهای من", group: "day", ready: true },
    { href: "/sales/schedule", label: "برنامهٔ تحویل", group: "day", ready: true },
    { href: "/planner", label: "برنامه‌ریز مسیر", group: "day", ready: isManager(r) },

    // مشتریان
    // The CRM is ready for every role that reaches this list. It used to read
    // `r !== "driver"`, which the branch above made dead -- a driver never gets here, so
    // the guard could only ever be true, and tsc said so.
    { href: "/crm", label: "مشتریان و سرنخ‌ها", group: "customers", ready: true },
    { href: "/map", label: "نقشهٔ پوشش", group: "customers", ready: true },
    { href: "/leads", label: "پین‌های نقشه", group: "customers", ready: isRepLead(r) },
    { href: "/sales/complaints", label: "شکایات", group: "customers", ready: r !== "rep_manager" },
    { href: "/gallery", label: "گالری تصاویر", group: "customers", ready: true },

    // فروش و دریافت
    { href: "/sales/orders", label: "سفارش‌ها", group: "sales", ready: true },
    { href: "/sales/products", label: "کالاها و قیمت‌ها", group: "sales", ready: true },
    { href: "/sales/payments", label: "دریافت‌ها", group: "sales", ready: r !== "rep_manager" },
    { href: "/sales/cheques", label: "چک‌ها", group: "sales", ready: isManager(r) },
    { href: "/sales/commission", label: "پورسانت", group: "sales", ready: true },

    // تحویل و انبار
    { href: "/sales/routing", label: "مسیریابی", group: "ops", ready: isManager(r) },
    { href: "/sales/stock", label: "انبار و خرید", group: "ops", ready: true },
    { href: "/sales/batches", label: "سری‌های ساخت", group: "ops", ready: isManager(r) },

    // گزارش‌ها
    { href: "/sales", label: "خلاصهٔ فروش", group: "reports", ready: true },
    { href: "/sales/dashboard", label: "تحلیل فروش", group: "reports", ready: true },
    { href: "/sales/forecast", label: "پیش‌بینی", group: "reports", ready: isManager(r) },
    /* Coverage report. `ready` mirrors proxy.ts, which denies a salesperson /report
       because it aggregates a whole group's revenue, debt and coverage. */
    { href: "/report", label: "گزارش پوشش", group: "reports", ready: r !== "phone_sales" },

    // حسابداری — org-wide money, read from the ledger. Its own group rather than eight more
    // tabs in «فروش و دریافت», which already holds five and is the group's job anyway.
    // `ready` uses isOwner, never `r === "owner"`: platform_owner is a strict superset
    // (lib/roles.ts:68) and a hand-written list would quietly lock them out of the books.
    { href: "/accounting/trial-balance", label: "تراز آزمایشی", group: "accounts", ready: isOwner(r) },
    { href: "/accounting/journal", label: "دفتر روزنامه", group: "accounts", ready: isOwner(r) || r === "group_manager" },
    { href: "/accounting/balance-sheet", label: "ترازنامه", group: "accounts", ready: isOwner(r) },
    { href: "/accounting/income-statement", label: "سود و زیان", group: "accounts", ready: isOwner(r) },
    { href: "/accounting/payables", label: "بدهی تأمین‌کنندگان", group: "accounts", ready: isOwner(r) },
    { href: "/accounting/expenses", label: "هزینه‌ها", group: "accounts", ready: isOwner(r) || r === "group_manager" },
    { href: "/accounting/suppliers", label: "تأمین‌کنندگان", group: "accounts", ready: isOwner(r) },

    // تیم
    { href: "/sales/tasks", label: "کارتابل", group: "team", ready: isRepLead(r) },
    { href: "/sales/reps", label: "نمایندگان فروش", group: "team", ready: isRepLead(r) },
    { href: "/sales/academy", label: "آموزش", group: "team", ready: true },

    // تنظیمات سازمان
    { href: "/sales/admin/users", label: "کاربران", group: "org", ready: isOwner(r) },
    { href: "/sales/admin/groups", label: "گروه‌ها", group: "org", ready: isOwner(r) },
    { href: "/facilities", label: "مکان‌های ما", group: "org", ready: isOwner(r) },
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
