/** Discounts on an order: what one is worth, who may approve it, and who pays for it.
 *
 *  Pure, so the rules are tested before a screen exists. The decisions this file holds were made
 *  by the owner (2026-10-28):
 *
 *  - the group manager of the order's group, or the owner, approves; the first answer wins;
 *  - a group manager's own discount goes to the owner, the owner's own applies at once;
 *  - every discount waits unless the company has set a percent below which it passes by itself;
 *  - a discount may be charged to commission, split between chosen people (equal by default,
 *    editable, always totalling 100%); the company sets how much of the discount comes out of
 *    commission (100% by default); choosing nobody means the company absorbs it;
 *  - what a person cannot cover in the period carries to the next (see `applyDeductions`).
 */

import { roundToman } from "./money";

export type DiscountKind = "percent" | "amount";

/** The ledger a share is charged in: the seller's, the driver's or the group manager's. */
export type ShareLedger = "sales" | "driver" | "manager";

export const DISCOUNT_REASONS = [
  { id: "competitor", label: "قیمت رقیب" },
  { id: "loyal", label: "مشتری ثابت" },
  { id: "near_expiry", label: "نزدیک انقضا" },
  { id: "damaged", label: "بسته‌بندی آسیب‌دیده" },
  { id: "other", label: "سایر" },
] as const;

export type DiscountReason = (typeof DISCOUNT_REASONS)[number]["id"];

export const isDiscountReason = (v: unknown): v is DiscountReason =>
  DISCOUNT_REASONS.some((r) => r.id === v);

export const DISCOUNT_STATUS_LABEL = {
  pending: "در انتظار تأیید",
  approved: "تأییدشده",
  rejected: "ردشده",
} as const;

export type DiscountStatus = keyof typeof DISCOUNT_STATUS_LABEL;

/** The discount's value in whole Toman for an order worth `orderTotal`: a percent of the total, or
 *  the amount itself, never more than the order. */
export function discountAmount(kind: DiscountKind, value: number, orderTotal: number): number {
  const raw = kind === "percent" ? (orderTotal * value) / 100 : value;
  return Math.min(Math.max(0, roundToman(raw)), Math.max(0, orderTotal));
}

/** Persian message for a discount that cannot be saved, or null when it can. */
export function validateDiscount(kind: DiscountKind, value: number, orderTotal: number): string | null {
  if (!Number.isFinite(value) || value <= 0) return "مقدار تخفیف باید بیشتر از صفر باشد";
  if (kind === "percent") {
    if (value > 100) return "درصد تخفیف از ۱۰۰ بیشتر نمی‌شود";
    if (Math.abs(value * 100 - Math.round(value * 100)) > 1e-6) return "درصد تخفیف حداکثر دو رقم اعشار دارد";
  } else {
    if (!Number.isInteger(value)) return "مبلغ تخفیف را به تومان و بدون اعشار وارد کنید";
    if (orderTotal > 0 && value > orderTotal) return "تخفیف از مبلغ سفارش بیشتر است";
  }
  return null;
}

/** The discount as a percent of the order, for the company's «passes by itself» limit. */
export function discountPercentOf(amount: number, orderTotal: number): number {
  return orderTotal > 0 ? (amount / orderTotal) * 100 : 0;
}

export interface ShareInput {
  user_id: number;
  ledger: ShareLedger;
  share_pct: number;
}

/** Equal shares for the chosen people, adding to exactly 100 (the first people take the extra
 *  hundredths when 100 does not divide evenly: three people get 33.34, 33.33, 33.33). */
export function equalShares(count: number): number[] {
  if (count <= 0) return [];
  const hundredths = 10_000;
  const base = Math.floor(hundredths / count);
  const extra = hundredths - base * count;
  return Array.from({ length: count }, (_, i) => (base + (i < extra ? 1 : 0)) / 100);
}

/** Persian message when the chosen shares are not acceptable, or null. An empty list is fine:
 *  nobody is charged and the company absorbs the discount. */
export function validateShares(shares: readonly ShareInput[]): string | null {
  if (shares.length === 0) return null;
  const seen = new Set<string>();
  for (const s of shares) {
    if (!Number.isFinite(s.share_pct) || s.share_pct <= 0) return "سهم هر نفر باید بیشتر از صفر باشد";
    const key = `${s.ledger}:${s.user_id}`;
    if (seen.has(key)) return "یک نفر دو بار انتخاب شده است";
    seen.add(key);
  }
  const total = shares.reduce((t, s) => t + Math.round(s.share_pct * 100), 0);
  return total === 10_000 ? null : "جمع سهم‌ها باید ۱۰۰٪ باشد";
}

/** How much of a discount comes out of commission, by the company's setting (100 = all of it). */
export function commissionBase(amount: number, commissionPct: number): number {
  const pct = Math.min(100, Math.max(0, commissionPct));
  return roundToman((amount * pct) / 100);
}

/** `total` Toman split by share, in whole Toman adding to exactly `total`: each share is floored,
 *  and what is left over goes one Toman at a time to the largest remainders. */
export function splitDeduction(total: number, shares: readonly { share_pct: number }[]): number[] {
  if (shares.length === 0 || total <= 0) return shares.map(() => 0);
  const exact = shares.map((s) => (total * Math.round(s.share_pct * 100)) / 10_000);
  const floors = exact.map((x) => Math.floor(x));
  let left = total - floors.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => ({ i, frac: x - Math.floor(x) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    floors[i] += 1;
    left -= 1;
  }
  return floors;
}

export interface Asker {
  id: number;
  role: string;
}

export interface Decider {
  id: number;
  role: string;
  group_id: number | null;
}

const isOwnerRole = (role: string) => role === "owner" || role === "platform_owner";

/** What happens to a discount the moment it is asked for. */
export type Routing = "auto_owner" | "auto_limit" | "needs_approval";

export function routeDiscount(asker: Asker, percent: number, autoPassPct: number): Routing {
  if (isOwnerRole(asker.role)) return "auto_owner";
  if (autoPassPct > 0 && percent < autoPassPct) return "auto_limit";
  return "needs_approval";
}

/** Whether `decider` may answer a pending discount asked by `asker` on an order of `orderGroupId`.
 *  Nobody answers their own; the owner answers anything; a group manager answers only for their
 *  own group, and not for another group manager's or an owner's discount. */
export function canDecideDiscount(asker: Asker, decider: Decider, orderGroupId: number | null): boolean {
  if (asker.id === decider.id) return false;
  if (isOwnerRole(decider.role)) return true;
  if (decider.role !== "group_manager") return false;
  if (asker.role === "group_manager" || isOwnerRole(asker.role)) return false;
  return decider.group_id !== null && decider.group_id === orderGroupId;
}

/** A period's deductions against what the person earned in it: the part taken now, and the part
 *  that carries forward because the commission ran out. Never negative. */
export function applyDeductions(accrued: number, deductions: number): { applied: number; carried: number } {
  const owed = Math.max(0, deductions);
  const applied = Math.min(owed, Math.max(0, accrued));
  return { applied, carried: owed - applied };
}

export interface DiscountBody {
  kind: DiscountKind;
  value: number;
  reason: DiscountReason;
  note: string | null;
  shares: ShareInput[];
}

const LEDGERS: readonly string[] = ["sales", "driver", "manager"];

/** The discount part of a request body, checked for shape only (the amount against the order and
 *  the people against the company are checked where the order is known). Missing means no discount. */
export function parseDiscountBody(raw: unknown): { ok: true; discount: DiscountBody | null } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, discount: null };
  if (typeof raw !== "object") return { ok: false, error: "تخفیف نامعتبر است" };
  const r = raw as Record<string, unknown>;
  if (r.kind !== "percent" && r.kind !== "amount") return { ok: false, error: "نوع تخفیف نامعتبر است" };
  const value = Number(r.value);
  if (!Number.isFinite(value)) return { ok: false, error: "مقدار تخفیف نامعتبر است" };
  if (!isDiscountReason(r.reason)) return { ok: false, error: "دلیل تخفیف را انتخاب کنید" };
  const note = typeof r.note === "string" && r.note.trim() ? r.note.trim().slice(0, 300) : null;
  const rawShares = r.shares === undefined ? [] : r.shares;
  if (!Array.isArray(rawShares) || rawShares.length > 10) return { ok: false, error: "فهرست افراد نامعتبر است" };
  const shares: ShareInput[] = [];
  for (const s of rawShares) {
    const o = (s ?? {}) as Record<string, unknown>;
    const userId = Number(o.user_id);
    if (!Number.isInteger(userId) || userId <= 0 || typeof o.ledger !== "string" || !LEDGERS.includes(o.ledger)) {
      return { ok: false, error: "فهرست افراد نامعتبر است" };
    }
    shares.push({ user_id: userId, ledger: o.ledger as ShareLedger, share_pct: Number(o.share_pct) });
  }
  return { ok: true, discount: { kind: r.kind, value, reason: r.reason, note, shares } };
}
