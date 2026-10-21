import { APP_GROUPS, appTabs, type AppGroupId, type AppTab } from "@/lib/appNav";
import type { IconName } from "@/components/meridian/icon-map";
import { isVanRole, type Role } from "@/lib/roles";

/** The phone's navigation: a bar of the few places each role goes dozens of times a day, and a
 *  «بیشتر» sheet holding everything else. The 30-destination pill in the header does not fit a
 *  thumb; this does, and it is derived from the same `appTabs` the pill uses so the two cannot
 *  disagree about what a role may open (tests/mobile-nav.test.ts holds the drift).
 *
 *  Order = thumb order, most used first. A route renamed in appNav fails a test here instead of
 *  silently dropping out of the bar. */
export const PRIMARY_BY_ROLE: Partial<Record<Role, string[]>> = {
  platform_owner: ["/sales/today", "/crm", "/sales/orders", "/map"],
  owner: ["/sales/today", "/crm", "/sales/orders", "/map"],
  group_manager: ["/sales/today", "/crm", "/sales/orders", "/map"],
  rep_manager: ["/sales/today", "/crm", "/sales/tasks", "/map"],
  phone_sales: ["/sales/today", "/crm", "/sales/pocket", "/sales/orders"],
  // Vans: the bar is simply their two tabs (appNav writes that menu out by hand).
  field_rep: ["/driver", "/sales/academy"],
  delivery_driver: ["/driver", "/sales/academy"],
};

/** One glyph per bar destination. Every item is icon AND word (the icon rule), and the glyph is
 *  not a second opinion about the word: it is the same shape the page uses elsewhere. */
export const TAB_ICON: Record<string, IconName> = {
  "/sales/today": "calendar",
  "/crm": "users",
  "/sales/pocket": "clipboard",
  "/sales/orders": "receipt",
  "/sales/tasks": "list",
  "/map": "map",
  "/driver": "route",
  "/sales/academy": "star",
};

export interface BottomTabs {
  primary: AppTab[];
  more: { id: AppGroupId; label: string; tabs: AppTab[] }[];
}

export function bottomTabs(session: { role: Role }): BottomTabs {
  const all = appTabs(session).filter((t) => t.ready);
  const wanted = PRIMARY_BY_ROLE[session.role] ?? [];
  const primary = wanted.map((h) => all.find((t) => t.href === h)).filter((t): t is AppTab => !!t).slice(0, 4);
  const taken = new Set(primary.map((t) => t.href));
  const more = APP_GROUPS.map((g) => ({
    id: g.id,
    label: g.label,
    tabs: all.filter((t) => t.group === g.id && !taken.has(t.href)),
  })).filter((g) => g.tabs.length > 0);
  return { primary, more };
}

export type QuickActionId = "reminder" | "note" | "order" | "payment" | "complaint";

export interface QuickAction {
  id: QuickActionId;
  label: string;
  icon: IconName;
  /** Where it goes. Absent for an action that opens its sheet right where you are. */
  href?: string;
  /** The tab the role must be able to open for this to make sense: no button that leads to a
   *  refusal. */
  requires?: string;
  /** Roles whose page opens but whose write is refused by the API (a rep manager can read the
   *  orders list; the orders endpoint does not let them sell). */
  except?: Role[];
}

/** The things done standing up, from anywhere. A reminder or a note needs no page; the others
 *  open the page's own tap flow (the page reads `?new=1` / `?quick=1` and opens it). */
export const QUICK_ACTIONS: QuickAction[] = [
  { id: "reminder", label: "ثبت یادآوری", icon: "clock" },
  { id: "note", label: "ثبت یادداشت", icon: "edit" },
  { id: "order", label: "سفارش تازه", icon: "receipt", href: "/sales/orders/new?quick=1", requires: "/sales/orders", except: ["rep_manager"] },
  { id: "payment", label: "ثبت دریافت", icon: "wallet", href: "/sales/payments?new=1", requires: "/sales/payments" },
  { id: "complaint", label: "ثبت شکایت", icon: "warn", href: "/sales/complaints?new=1", requires: "/sales/complaints" },
];

export function quickActionsFor(session: { role: Role }): QuickAction[] {
  if (isVanRole(session.role)) return [];
  const reachable = new Set(appTabs(session).filter((t) => t.ready).map((t) => t.href));
  return QUICK_ACTIONS.filter((a) => (!a.requires || reachable.has(a.requires)) && !a.except?.includes(session.role));
}
