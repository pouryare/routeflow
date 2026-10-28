/** The discount part of the order form, as plain data and functions: what the person has picked so
 *  far, what it comes to, and the body the API takes. The screen (components/sales/DiscountSection)
 *  only renders this. The rules themselves are in lib/discounts.ts. */

import {
  discountAmount,
  equalShares,
  validateDiscount,
  validateShares,
  type DiscountKind,
  type DiscountReason,
  type ShareLedger,
} from "./discounts";
import { valueOf } from "./keypad";

export interface Payer {
  user_id: number;
  ledger: ShareLedger;
  name: string;
}

export const LEDGER_LABEL: Record<ShareLedger, string> = { sales: "فروشنده", driver: "راننده", manager: "مدیر گروه" };

export const payerKey = (p: { user_id: number; ledger: ShareLedger }) => `${p.ledger}:${p.user_id}`;

export interface DiscountDraft {
  open: boolean;
  kind: DiscountKind;
  /** The keypad's committed string; "" when empty. */
  value: string;
  reason: DiscountReason | "";
  /** The people chosen to pay, in the order picked, each with a share as a keypad string. Empty
   *  means the company absorbs the discount. */
  payers: { key: string; share: string }[];
}

export const emptyDraft = (): DiscountDraft => ({ open: false, kind: "percent", value: "", reason: "", payers: [] });

const asShare = (n: number) => String(n);

/** Adds or removes a payer; the shares reset to an equal split, which the person may then edit. */
export function togglePayer(d: DiscountDraft, key: string): DiscountDraft {
  const has = d.payers.some((p) => p.key === key);
  const keys = has ? d.payers.filter((p) => p.key !== key).map((p) => p.key) : [...d.payers.map((p) => p.key), key];
  const eq = equalShares(keys.length);
  return { ...d, payers: keys.map((k, i) => ({ key: k, share: asShare(eq[i]) })) };
}

export function setShare(d: DiscountDraft, key: string, share: string): DiscountDraft {
  return { ...d, payers: d.payers.map((p) => (p.key === key ? { ...p, share } : p)) };
}

export interface DraftSummary {
  amount: number;
  net: number;
  percent: number;
  /** The first thing wrong with the discount or the shares, in Persian; null when it can be sent. */
  problem: string | null;
}

/** What the discount comes to against an order worth `total`, and whether it can be sent. */
export function summarize(d: DiscountDraft, total: number, payers: readonly Payer[]): DraftSummary {
  const value = valueOf(d.value);
  const amount = d.value === "" ? 0 : discountAmount(d.kind, value, total);
  const base = { amount, net: Math.max(0, total - amount), percent: total > 0 ? (amount / total) * 100 : 0 };
  if (d.value === "") return { ...base, problem: "مقدار تخفیف را وارد کنید" };
  const v = validateDiscount(d.kind, value, total);
  if (v) return { ...base, problem: v };
  if (d.reason === "") return { ...base, problem: "دلیل تخفیف را انتخاب کنید" };
  const sh = validateShares(shareInputs(d, payers));
  return { ...base, problem: sh };
}

function shareInputs(d: DiscountDraft, payers: readonly Payer[]) {
  const byKey = new Map(payers.map((p) => [payerKey(p), p]));
  return d.payers.flatMap((p) => {
    const who = byKey.get(p.key);
    return who ? [{ user_id: who.user_id, ledger: who.ledger, share_pct: valueOf(p.share) }] : [];
  });
}

/** The `discount` field of the order request, or undefined when none was asked for. */
export function toRequestBody(d: DiscountDraft, payers: readonly Payer[]) {
  if (!d.open || d.value === "") return undefined;
  return { kind: d.kind, value: valueOf(d.value), reason: d.reason, shares: shareInputs(d, payers) };
}
