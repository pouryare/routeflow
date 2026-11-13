/** FB1: the orders list you can search and filter. Pure, so the rules are tested without a page.
 *  Example: pasting «۱۲۳ 0912…, ۱۲۴» finds orders number 123 and 124 and the shop with that phone. */
import type { OrderSummary } from "./orders";

export const STATUS_GROUPS = [
  { id: "draft", label: "پیش‌نویس و بررسی", statuses: ["DRAFT", "PENDING_REVIEW", "PENDING_CREDIT", "ON_HOLD"] },
  { id: "open", label: "در جریان", statuses: ["CONFIRMED", "PLANNED", "READY", "OUT_FOR_DELIVERY", "DELIVERY_FAILED"] },
  { id: "done", label: "تحویل‌شده", statuses: ["DELIVERED", "PARTIALLY_DELIVERED", "CLOSED"] },
  { id: "void", label: "لغو و مرجوعی", statuses: ["CANCELLED", "RETURNED"] },
] as const;

export const DAY_CHOICES = [
  { id: "today", label: "امروز", back: 0 },
  { id: "yesterday", label: "دیروز", back: 1 },
  { id: "week", label: "۷ روز اخیر", back: 6 },
] as const;

export interface OrderListQuery {
  q?: string;
  status?: string;
  payment?: string;
  rep?: string;
  day?: string;
}

const DIGITS: Record<string, string> = Object.fromEntries([..."۰۱۲۳۴۵۶۷۸۹"].map((d, i) => [d, String(i)]).concat([..."٠١٢٣٤٥٦٧٨٩"].map((d, i) => [d, String(i)])));
const ascii = (s: string) => s.replace(/[۰-۹٠-٩]/g, (d) => DIGITS[d]);

/** Pasted text → search tokens: split on spaces, commas (also the Persian one), semicolons and new lines. */
export function searchTokens(q: string | undefined): string[] {
  return ascii(q ?? "").split(/[\s,،;؛]+/).map((t) => t.trim().toLowerCase()).filter(Boolean);
}

function dayIso(todayIso: string, back: number): string {
  const d = new Date(`${todayIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

export function filterOrders(orders: OrderSummary[], f: OrderListQuery, todayIso: string): OrderSummary[] {
  const tokens = searchTokens(f.q);
  const group = STATUS_GROUPS.find((g) => g.id === f.status);
  const day = DAY_CHOICES.find((d) => d.id === f.day);
  return orders.filter((o) => {
    if (group && !(group.statuses as readonly string[]).includes(o.status)) return false;
    if (f.payment && o.payment_status !== f.payment) return false;
    if (f.rep && (o.salesperson_name ?? "") !== f.rep) return false;
    if (day) {
      const date = o.order_date.slice(0, 10);
      if (day.id === "week" ? date < dayIso(todayIso, day.back) || date > todayIso : date !== dayIso(todayIso, day.back)) return false;
    }
    if (tokens.length === 0) return true;
    const number = String(Number(o.order_no.split("-")[1] ?? NaN));
    const phone = ascii(o.customer_phone ?? "").replace(/\D/g, "").replace(/^0/, "");
    const name = o.customer_name.toLowerCase();
    // Any token may match: pasting a list means «show me all of these».
    return tokens.some((t) => o.order_no.toLowerCase() === t || number === t.replace(/^0+/, "") || (/^\d{7,}$/.test(t) && phone.includes(t.replace(/^0/, ""))) || name.includes(t));
  });
}
