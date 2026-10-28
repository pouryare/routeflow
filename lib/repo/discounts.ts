/** Asking for, approving and reading discounts on an order. The rules are in lib/discounts.ts;
 *  this is the part that touches the database.
 *
 *  An approved discount sets `orders.discount_toman`, which the order's cached total is net of
 *  (lib/repo/orderFigures.ts), and writes one `discount_commission_shares` row per person charged,
 *  with the Toman each share comes to. A pending one changes nothing about the order's money; it
 *  only holds the order at review (advanceOrder refuses `passReview` while one waits). */

import type { Db } from "@/lib/database/client";
import { getDb } from "@/lib/db";
import {
  canDecideDiscount,
  commissionBase,
  discountAmount,
  discountPercentOf,
  isDiscountReason,
  routeDiscount,
  splitDeduction,
  validateDiscount,
  validateShares,
  type Asker,
  type Decider,
  type DiscountKind,
  type DiscountStatus,
  type ShareInput,
} from "@/lib/discounts";
import { lineTotalToman, type LineSnapshot } from "@/lib/orderMath";
import { refreshOrderFigures } from "./orderFigures";
import { advanceOrder, OrderError } from "./orders";

export class DiscountError extends OrderError {}

export interface DiscountRequest {
  kind: DiscountKind;
  value: number;
  reason: string;
  note?: string | null;
  /** Whose commission pays for it. Empty: the company absorbs it. */
  shares: ShareInput[];
}

export interface DiscountRow {
  id: number;
  organization_id: number;
  order_id: number;
  kind: DiscountKind;
  value: number;
  amount_toman: number;
  reason: string;
  note: string | null;
  status: DiscountStatus;
  requested_by: number;
  requested_at: string;
  decided_by: number | null;
  decided_at: string | null;
  decision_note: string | null;
  commission_base_toman: number;
}

export interface DiscountSettings {
  /** A discount below this percent passes without approval; 0 means every discount waits. */
  auto_pass_pct: number;
  /** How much of an approved discount comes out of commission (100 = all of it). */
  commission_pct: number;
}

export async function discountSettings(organizationId: number, db: Db = getDb()): Promise<DiscountSettings> {
  const row = await db
    .prepare("SELECT discount_auto_pass_pct, discount_commission_pct FROM organizations WHERE id = ?")
    .get(organizationId) as { discount_auto_pass_pct: number; discount_commission_pct: number } | undefined;
  return { auto_pass_pct: Number(row?.discount_auto_pass_pct ?? 0), commission_pct: Number(row?.discount_commission_pct ?? 100) };
}

export async function saveDiscountSettings(organizationId: number, s: DiscountSettings, db: Db = getDb()): Promise<void> {
  if (!(s.auto_pass_pct >= 0 && s.auto_pass_pct <= 100)) throw new DiscountError("حد تخفیف بدون تأیید باید بین ۰ و ۱۰۰ باشد");
  if (!(s.commission_pct >= 0 && s.commission_pct <= 100)) throw new DiscountError("سهم کسر از پورسانت باید بین ۰ و ۱۰۰ باشد");
  await db
    .prepare("UPDATE organizations SET discount_auto_pass_pct = ?, discount_commission_pct = ? WHERE id = ?")
    .run(s.auto_pass_pct, s.commission_pct, organizationId);
}

/** What the order's lines come to before any discount, delivered quantities where there are some. */
async function grossTotal(db: Db, orderId: number): Promise<number> {
  const lines = await db
    .prepare(
      `SELECT packs_ordered, packs_delivered, unit_price_toman, unit_cost_toman, qty_per_pack, kg_per_base_unit
         FROM order_lines WHERE order_id = ?`
    )
    .all(orderId) as unknown as LineSnapshot[];
  return lines.reduce((t, l) => t + lineTotalToman(l), 0);
}

interface OrderBrief {
  id: number;
  status: string;
  group_id: number | null;
  customer_id: number;
  order_type: string;
  created_by: number;
}

async function orderBrief(db: Db, organizationId: number, orderId: number): Promise<OrderBrief> {
  const order = await db
    .prepare("SELECT id, status, group_id, customer_id, order_type, created_by FROM orders WHERE id = ? AND organization_id = ?")
    .get(orderId, organizationId) as OrderBrief | undefined;
  if (!order) throw new DiscountError("سفارش پیدا نشد");
  return order;
}

/** Every person named as paying must belong to this company; a share on a stranger would move
 *  money out of someone else's statement. */
async function assertSharesInOrg(db: Db, organizationId: number, shares: readonly ShareInput[]): Promise<void> {
  for (const s of shares) {
    const u = await db
      .prepare("SELECT 1 FROM users WHERE id = ? AND organization_id = ? AND active = 1")
      .get(s.user_id, organizationId);
    if (!u) throw new DiscountError("فردِ انتخاب‌شده برای کسر از پورسانت معتبر نیست");
  }
}

/** Asks for a discount on an order that has not been confirmed yet. One open request per order:
 *  asking again replaces a pending one and is refused once one has been approved. Returns the row,
 *  which is already approved when the owner asked or the amount is under the company's limit. */
export async function requestDiscount(
  organizationId: number,
  orderId: number,
  asker: Asker,
  input: DiscountRequest,
  db: Db = getDb()
): Promise<DiscountRow> {
  if (!isDiscountReason(input.reason)) throw new DiscountError("دلیل تخفیف را انتخاب کنید");
  const shareProblem = validateShares(input.shares);
  if (shareProblem) throw new DiscountError(shareProblem);

  return await db.tx(async () => {
    const order = await orderBrief(db, organizationId, orderId);
    if (order.status !== "DRAFT" && order.status !== "PENDING_REVIEW") {
      throw new DiscountError("برای سفارش تأییدشده تخفیف ثبت نمی‌شود");
    }
    const total = await grossTotal(db, orderId);
    const problem = validateDiscount(input.kind, input.value, total);
    if (problem) throw new DiscountError(problem);
    await assertSharesInOrg(db, organizationId, input.shares);

    const approved = await db.prepare("SELECT 1 FROM order_discounts WHERE order_id = ? AND status = 'approved' LIMIT 1").get(orderId);
    if (approved) throw new DiscountError("این سفارش تخفیف تأییدشده دارد");
    await db.prepare("DELETE FROM discount_commission_shares WHERE discount_id IN (SELECT id FROM order_discounts WHERE order_id = ? AND status = 'pending')").run(orderId);
    await db.prepare("DELETE FROM order_discounts WHERE order_id = ? AND status = 'pending'").run(orderId);

    const amount = discountAmount(input.kind, input.value, total);
    const settings = await discountSettings(organizationId, db);
    const routing = routeDiscount(asker, discountPercentOf(amount, total), settings.auto_pass_pct);
    const id = Number(
      (await db
        .prepare(
          `INSERT INTO order_discounts (organization_id, order_id, kind, value, amount_toman, reason, note,
                                         status, requested_by, requested_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
        )
        .run(organizationId, orderId, input.kind, input.value, amount, input.reason, input.note ?? null, asker.id, new Date().toISOString())).lastInsertRowid
    );
    for (const s of input.shares) {
      await db
        .prepare(
          `INSERT INTO discount_commission_shares (organization_id, discount_id, order_id, user_id, ledger, share_pct)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(organizationId, id, orderId, s.user_id, s.ledger, s.share_pct);
    }
    if (routing !== "needs_approval") await settle(db, organizationId, id, "approved", asker.id, null);
    return await readDiscount(db, organizationId, id);
  });
}

/** Writes the verdict, and for an approval fixes the amount against the order as it is now, applies
 *  it to the order and works out each person's Toman. */
async function settle(db: Db, organizationId: number, id: number, verdict: "approved" | "rejected", by: number, note: string | null) {
  const d = await readDiscount(db, organizationId, id);
  const now = new Date().toISOString();
  if (verdict === "rejected") {
    await db
      .prepare("UPDATE order_discounts SET status = 'rejected', decided_by = ?, decided_at = ?, decision_note = ? WHERE id = ?")
      .run(by, now, note, id);
    return;
  }
  const total = await grossTotal(db, d.order_id);
  const amount = discountAmount(d.kind, d.value, total);
  const settings = await discountSettings(organizationId, db);
  const base = commissionBase(amount, settings.commission_pct);
  const shares = await db
    .prepare("SELECT id, share_pct FROM discount_commission_shares WHERE discount_id = ? ORDER BY id")
    .all(id) as unknown as { id: number; share_pct: number }[];
  const parts = splitDeduction(base, shares);
  for (let i = 0; i < shares.length; i++) {
    await db.prepare("UPDATE discount_commission_shares SET amount_toman = ? WHERE id = ?").run(parts[i], shares[i].id);
  }
  await db
    .prepare(
      `UPDATE order_discounts SET status = 'approved', amount_toman = ?, commission_base_toman = ?,
                                  decided_by = ?, decided_at = ?, decision_note = ? WHERE id = ?`
    )
    .run(amount, base, by, now, note, id);
  await db.prepare("UPDATE orders SET discount_toman = ? WHERE id = ?").run(amount, d.order_id);
  await refreshOrderFigures(db, d.order_id);
}

async function readDiscount(db: Db, organizationId: number, id: number): Promise<DiscountRow> {
  const row = await db
    .prepare("SELECT * FROM order_discounts WHERE id = ? AND organization_id = ?")
    .get(id, organizationId) as DiscountRow | undefined;
  if (!row) throw new DiscountError("درخواست تخفیف پیدا نشد");
  return row;
}

/** The decider's answer. Refused for the person who asked, for a group manager outside their own
 *  group, and for anyone who is neither. An approval of a representative's or sample order lets it
 *  on to confirmed, as it would have gone at submit had there been no discount. */
export async function decideDiscount(
  organizationId: number,
  id: number,
  verdict: "approved" | "rejected",
  decider: Decider,
  note?: string | null,
  db: Db = getDb()
): Promise<DiscountRow> {
  const d = await db.tx(async () => {
    const row = await readDiscount(db, organizationId, id);
    if (row.status !== "pending") throw new DiscountError("این درخواست قبلاً تعیین‌تکلیف شده است");
    const order = await orderBrief(db, organizationId, row.order_id);
    const asker = await db.prepare("SELECT id, role FROM users WHERE id = ?").get(row.requested_by) as Asker | undefined;
    if (!asker || !canDecideDiscount(asker, decider, order.group_id)) {
      throw new DiscountError("شما اجازهٔ تعیین‌تکلیف این تخفیف را ندارید");
    }
    await settle(db, organizationId, id, verdict, decider.id, note ?? null);
    return row;
  });

  /* After the transaction: the order machine opens its own. Only an order that is waiting at review
     with nobody to review it (a representative's or a sample) moves on by itself. */
  if (verdict === "approved") {
    const order = await orderBrief(db, organizationId, d.order_id);
    if (order.status === "PENDING_REVIEW") {
      const rep = await db
        .prepare("SELECT 1 FROM representative_profiles WHERE customer_id = ? AND organization_id = ?")
        .get(order.customer_id, organizationId);
      if (rep || order.order_type === "SAMPLE") {
        await advanceOrder(organizationId, d.order_id, "passReview", { id: decider.id, role: "system" });
      }
    }
  }
  return await readDiscount(db, organizationId, id);
}

interface DiscountShareView {
  user_id: number;
  ledger: string;
  display_name: string;
  share_pct: number;
  amount_toman: number;
}

export interface OrderDiscountView extends DiscountRow {
  requested_by_name: string | null;
  decided_by_name: string | null;
  shares: DiscountShareView[];
}

/** The latest discount of an order with the people it is charged to, for the order page. */
export async function discountOfOrder(organizationId: number, orderId: number, db: Db = getDb()): Promise<OrderDiscountView | null> {
  const row = await db
    .prepare(
      `SELECT d.*, ru.display_name AS requested_by_name, du.display_name AS decided_by_name
         FROM order_discounts d
         LEFT JOIN users ru ON ru.id = d.requested_by
         LEFT JOIN users du ON du.id = d.decided_by
        WHERE d.order_id = ? AND d.organization_id = ?
        ORDER BY d.id DESC LIMIT 1`
    )
    .get(orderId, organizationId) as (DiscountRow & { requested_by_name: string | null; decided_by_name: string | null }) | undefined;
  if (!row) return null;
  const shares = await db
    .prepare(
      `SELECT s.user_id, s.ledger, u.display_name, s.share_pct, s.amount_toman
         FROM discount_commission_shares s JOIN users u ON u.id = s.user_id
        WHERE s.discount_id = ? ORDER BY s.id`
    )
    .all(row.id) as unknown as DiscountShareView[];
  return { ...row, shares };
}

export interface PendingDiscountCard {
  id: number;
  order_id: number;
  order_no: string;
  customer_name: string;
  gross_toman: number;
  amount_toman: number;
  percent: number;
  reason: string;
  note: string | null;
  requested_by_name: string;
  requested_at: string;
  shares: { display_name: string; share_pct: number }[];
}

/** The requests this person may answer, oldest first. The decider's rules are applied here so the
 *  deck never shows a card whose buttons would be refused. */
export async function pendingForDecider(organizationId: number, decider: Decider, db: Db = getDb()): Promise<PendingDiscountCard[]> {
  const rows = await db
    .prepare(
      `SELECT d.id, d.order_id, o.order_no, o.group_id, c.business_name AS customer_name, d.kind, d.value,
              d.amount_toman, d.reason, d.note, d.requested_at, d.requested_by,
              ru.display_name AS requested_by_name, ru.role AS requested_by_role
         FROM order_discounts d
         JOIN orders o ON o.id = d.order_id
         JOIN customers c ON c.id = o.customer_id
         JOIN users ru ON ru.id = d.requested_by
        WHERE d.organization_id = ? AND d.status = 'pending'
        ORDER BY d.requested_at, d.id`
    )
    .all(organizationId) as unknown as {
    id: number; order_id: number; order_no: string; group_id: number | null; customer_name: string;
    kind: DiscountKind; value: number; amount_toman: number; reason: string; note: string | null;
    requested_at: string; requested_by: number; requested_by_name: string; requested_by_role: string;
  }[];
  const out: PendingDiscountCard[] = [];
  for (const r of rows) {
    if (!canDecideDiscount({ id: r.requested_by, role: r.requested_by_role }, decider, r.group_id)) continue;
    const gross = await grossTotal(db, r.order_id);
    const amount = discountAmount(r.kind, r.value, gross);
    const shares = await db
      .prepare("SELECT u.display_name, s.share_pct FROM discount_commission_shares s JOIN users u ON u.id = s.user_id WHERE s.discount_id = ? ORDER BY s.id")
      .all(r.id) as unknown as { display_name: string; share_pct: number }[];
    out.push({
      id: r.id, order_id: r.order_id, order_no: r.order_no, customer_name: r.customer_name,
      gross_toman: gross, amount_toman: amount, percent: discountPercentOf(amount, gross), reason: r.reason, note: r.note,
      requested_by_name: r.requested_by_name, requested_at: r.requested_at, shares,
    });
  }
  return out;
}

export interface RecentDiscount {
  id: number;
  order_id: number;
  order_no: string;
  customer_name: string;
  amount_toman: number;
  reason: string;
  status: DiscountStatus;
  requested_by_name: string;
  requested_at: string;
}

/** The latest discounts of the company with their status, for the owner's settings page. */
export async function recentDiscounts(organizationId: number, limit = 20, db: Db = getDb()): Promise<RecentDiscount[]> {
  return await db
    .prepare(
      `SELECT d.id, d.order_id, o.order_no, c.business_name AS customer_name, d.amount_toman, d.reason, d.status,
              ru.display_name AS requested_by_name, d.requested_at
         FROM order_discounts d
         JOIN orders o ON o.id = d.order_id
         JOIN customers c ON c.id = o.customer_id
         JOIN users ru ON ru.id = d.requested_by
        WHERE d.organization_id = ?
        ORDER BY d.id DESC LIMIT ?`
    )
    .all(organizationId, limit) as unknown as RecentDiscount[];
}
