import { appTabs } from "@/lib/appNav";
import { buildMapLink } from "@/lib/deepLink";
import { SELL_ROLES, type Role } from "@/lib/roles";
import type { IconName } from "@/components/meridian/Icon";

/** T14: one action list. An action is declared once here and the places that show it (Ctrl-K, the
 *  customer selection bar) ask this list instead of keeping their own role checks.
 *
 *  Who may see an action is not repeated: it is whoever has the action's page as a ready tab
 *  (`appTabs`), so a button can never lead a role to a page that refuses them (rule 3 of the UI
 *  checklist). `only` narrows it further for the few actions that need more than the page. */
export type Place = "ctrlk" | "customer-selection" | "customer-record";

export interface ActionDef {
  id: string;
  label: string;
  icon: IconName;
  /** The page the action opens; the role must have it as a ready tab. */
  tab: string;
  /** Where to go; defaults to `tab`. A selection action gets the picked ids to build it. */
  href?: (ids: number[]) => string;
  places: Place[];
  /** The filled button on a record sheet; the rest are plain. */
  primary?: boolean;
  only?: Role[];
  /** Extra words Ctrl-K matches besides the label. */
  words?: string;
}

export const ACTIONS: ActionDef[] = [
  { id: "log-expense", label: "ثبت هزینه", icon: "wallet", tab: "/my-expenses", places: ["ctrlk"], words: "خرج فاکتور بنزین وام" },
  { id: "take-payment", label: "ثبت دریافت", icon: "wallet", tab: "/sales/payments", places: ["ctrlk"], words: "پول نقد چک واریز" },
  { id: "new-order", label: "سفارش تازه", icon: "receipt", tab: "/sales/orders", places: ["ctrlk"], words: "فروش فاکتور" },
  { id: "new-lead", label: "سرنخ تازه", icon: "plus", tab: "/crm", places: ["ctrlk"], words: "مشتری جدید" },
  { id: "go-cheques", label: "چک‌ها", icon: "receipt", tab: "/sales/cheques", places: ["ctrlk"], words: "وصول سررسید" },
  { id: "stock-buy", label: "انبار و خرید", icon: "package", tab: "/sales/stock", places: ["ctrlk"], words: "سفارش خرید تامین‌کننده" },
  { id: "customer-info", label: "اطلاعات و مخاطبان", icon: "user", tab: "/crm", href: ([id]) => `/crm/${id}`, places: ["customer-record"] },
  { id: "customer-new-order", label: "ثبت سفارش تازه", icon: "plus", tab: "/sales/orders", href: ([id]) => `/sales/orders/new?customer=${id}`, places: ["customer-record"], primary: true, only: SELL_ROLES },
  { id: "customer-on-map", label: "روی نقشه", icon: "map", tab: "/map", href: ([id]) => `/map?c=${id}`, places: ["customer-record"] },
  { id: "customer-orders", label: "همهٔ سفارش‌ها", icon: "receipt", tab: "/sales/orders", href: ([id]) => `/sales/orders?customer=${id}`, places: ["customer-record"], primary: true },
  { id: "customers-on-map", label: "روی نقشه", icon: "map", tab: "/map", places: ["customer-selection"], href: (ids) => `/map${buildMapLink({ customerIds: ids })}` },
];

/** The actions this role may use in `place`, in declaration order. */
export function actionsFor(role: Role, place: Place): ActionDef[] {
  const ready = new Set(appTabs({ role }).filter((t) => t.ready).map((t) => t.href));
  return ACTIONS.filter((a) => a.places.includes(place) && ready.has(a.tab) && (!a.only || a.only.includes(role)));
}

/** Ctrl-K matches: the label or its extra words contain every word typed. */
export function matchActions(role: Role, q: string, limit = 4): ActionDef[] {
  const words = q.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return actionsFor(role, "ctrlk")
    .filter((a) => words.every((w) => `${a.label} ${a.words ?? ""}`.includes(w)))
    .slice(0, limit);
}
