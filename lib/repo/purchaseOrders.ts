import { getDb } from "@/lib/db";
import type { Db } from "@/lib/database/client";
import { tehranTodayIso } from "@/lib/jalali";
import { PO_OPEN, isLate, poProblem, remaining, statusAfterAction, statusAfterReceipt, type PoStatus } from "@/lib/purchaseOrders";
import { productInOrg } from "@/lib/repo/catalogueAdmin";
import type { ScoredOrder } from "@/lib/supplierScore";

export class PurchaseOrderError extends Error {}

export interface PoRow {
  id: number;
  supplier_id: number;
  supplier_name: string;
  status: PoStatus;
  expected_date: string | null;
  notes: string | null;
  created_at: string;
  late: boolean;
  total_toman: number;
  lines: { id: number; product_id: number; product_name: string; base_qty: number; unit_cost_toman: number; received_qty: number }[];
}

export async function createPurchaseOrder(
  organizationId: number,
  input: { supplier_id: number; expected_date: string | null; notes?: string | null; created_by: number; send?: boolean; lines: { product_id: number; base_qty: number; unit_cost_toman: number }[] }
): Promise<number> {
  const problem = poProblem(input);
  if (problem) throw new PurchaseOrderError(problem);
  const db = getDb();
  const supplier = await db.prepare("SELECT 1 FROM suppliers WHERE id = ? AND organization_id = ?").get(input.supplier_id, organizationId);
  if (!supplier) throw new PurchaseOrderError("تأمین‌کننده پیدا نشد");
  for (const l of input.lines) if (!(await productInOrg(l.product_id, organizationId))) throw new PurchaseOrderError("کالا پیدا نشد");
  const now = new Date().toISOString();
  return await db.tx(async () => {
    const id = Number(
      (await db
        .prepare("INSERT INTO purchase_orders (organization_id, supplier_id, status, expected_date, notes, created_by, created_at, ordered_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run(organizationId, input.supplier_id, input.send ? "ordered" : "draft", input.expected_date, input.notes?.trim().slice(0, 300) || null, input.created_by, now, input.send ? now : null)).lastInsertRowid
    );
    for (const l of input.lines) {
      await db.prepare("INSERT INTO purchase_order_lines (purchase_order_id, product_id, base_qty, unit_cost_toman) VALUES (?, ?, ?, ?)").run(id, l.product_id, l.base_qty, l.unit_cost_toman);
    }
    return id;
  });
}

/** `open`: only orders still waiting for goods. Late ones first, then by expected day. */
export async function listPurchaseOrders(organizationId: number, opts: { open?: boolean } = {}): Promise<PoRow[]> {
  const db = getDb();
  const rows = (await db
    .prepare(
      `SELECT po.id, po.supplier_id, s.name AS supplier_name, po.status, po.expected_date, po.notes, po.created_at
         FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id
        WHERE po.organization_id = ? ${opts.open ? `AND po.status IN ('ordered', 'partly_received')` : ""}
        ORDER BY po.id DESC`
    )
    .all(organizationId)) as unknown as Omit<PoRow, "late" | "lines" | "total_toman">[];
  const today = tehranTodayIso();
  const out: PoRow[] = [];
  for (const r of rows) {
    const lines = (await db
      .prepare(
        `SELECT l.id, l.product_id, p.name AS product_name, l.base_qty, l.unit_cost_toman, l.received_qty
           FROM purchase_order_lines l JOIN products p ON p.id = l.product_id WHERE l.purchase_order_id = ? ORDER BY l.id`
      )
      .all(r.id)) as unknown as PoRow["lines"];
    const plain = lines.map((l) => ({ ...l, base_qty: Number(l.base_qty), unit_cost_toman: Number(l.unit_cost_toman), received_qty: Number(l.received_qty) }));
    out.push({ ...r, id: Number(r.id), supplier_id: Number(r.supplier_id), lines: plain, late: isLate(r.status, r.expected_date, today), total_toman: plain.reduce((n, l) => n + Math.round(l.base_qty * l.unit_cost_toman), 0) });
  }
  return out.sort((a, b) => Number(b.late) - Number(a.late) || (a.expected_date ?? "9999").localeCompare(b.expected_date ?? "9999") || b.id - a.id);
}

export async function actOnPurchaseOrder(organizationId: number, id: number, action: "send" | "cancel" | "close"): Promise<PoStatus> {
  const db = getDb();
  const po = (await db.prepare("SELECT status FROM purchase_orders WHERE id = ? AND organization_id = ?").get(id, organizationId)) as { status: PoStatus } | undefined;
  if (!po) throw new PurchaseOrderError("سفارش خرید پیدا نشد");
  const next = statusAfterAction(po.status, action);
  if (!next) throw new PurchaseOrderError("این کار برای این وضعیت ممکن نیست");
  await db
    .prepare("UPDATE purchase_orders SET status = ?, ordered_at = CASE WHEN ? = 'ordered' THEN ? ELSE ordered_at END, received_at = CASE WHEN ? = 'closed' THEN ? ELSE received_at END WHERE id = ? AND organization_id = ?")
    .run(next, next, new Date().toISOString(), next, new Date().toISOString(), id, organizationId);
  return next;
}

/** Counts a receipt against its order, inside the receipt's own transaction. Goods that are not on the order are
 *  still received (the receipt has them) but do not change the order. Refuses an order that is not open. */
export async function applyReceipt(db: Db, organizationId: number, orderId: number, got: { product_id: number; base_qty: number }[]): Promise<PoStatus> {
  const po = (await db.prepare("SELECT status FROM purchase_orders WHERE id = ? AND organization_id = ?").get(orderId, organizationId)) as { status: PoStatus } | undefined;
  if (!po) throw new PurchaseOrderError("سفارش خرید پیدا نشد");
  if (!PO_OPEN.includes(po.status)) throw new PurchaseOrderError("این سفارش خرید دیگر منتظر کالا نیست");
  for (const g of got) {
    // two lines of one product fill in turn; whatever is more than the order asked for stays on the receipt only
    const lines = (await db.prepare("SELECT id, base_qty, received_qty FROM purchase_order_lines WHERE purchase_order_id = ? AND product_id = ? ORDER BY id").all(orderId, g.product_id)) as unknown as { id: number; base_qty: number; received_qty: number }[];
    let left = g.base_qty;
    for (const l of lines) {
      if (left <= 0) break;
      const take = Math.min(left, remaining({ base_qty: Number(l.base_qty), received_qty: Number(l.received_qty) }));
      if (take > 0) await db.prepare("UPDATE purchase_order_lines SET received_qty = received_qty + ? WHERE id = ?").run(take, l.id);
      left -= take;
    }
  }
  const lines = ((await db.prepare("SELECT base_qty, received_qty FROM purchase_order_lines WHERE purchase_order_id = ?").all(orderId)) as unknown as { base_qty: number; received_qty: number }[]).map((l) => ({ base_qty: Number(l.base_qty), received_qty: Number(l.received_qty) }));
  const next = statusAfterReceipt(po.status, lines);
  const now = new Date().toISOString();
  await db.prepare("UPDATE purchase_orders SET status = ?, received_at = CASE WHEN ? = 'received' THEN ? ELSE received_at END WHERE id = ?").run(next, next, now, orderId);
  return next;
}

/** What is still on its way, by product: units not yet received on open orders and the earliest expected day.
 *  Feeds the buy list (D17: not to buy again what is coming) and the order form (D27: «expected Tuesday»). */
export async function incomingByProduct(organizationId: number): Promise<Map<number, { qty: number; expected: string | null }>> {
  const rows = (await getDb()
    .prepare(
      `SELECT l.product_id, SUM(l.base_qty - LEAST(l.received_qty, l.base_qty)) AS qty, MIN(po.expected_date) AS expected
         FROM purchase_order_lines l JOIN purchase_orders po ON po.id = l.purchase_order_id
        WHERE po.organization_id = ? AND po.status IN ('ordered', 'partly_received')
        GROUP BY l.product_id`
    )
    .all(organizationId)) as unknown as { product_id: number; qty: number; expected: string | null }[];
  return new Map(rows.filter((r) => Number(r.qty) > 0).map((r) => [Number(r.product_id), { qty: Number(r.qty), expected: r.expected }]));
}

/** The supplier an order is with, or null when the order is not this company's. */
export async function supplierOfOrder(organizationId: number, orderId: number): Promise<{ id: number; name: string } | null> {
  const r = (await getDb().prepare("SELECT s.id, s.name FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id WHERE po.id = ? AND po.organization_id = ?").get(orderId, organizationId)) as { id: number; name: string } | undefined;
  return r ? { id: Number(r.id), name: r.name } : null;
}

/** F31: the finished orders of one supplier, as the scorecard reads them (arrival as a Tehran day). */
export async function supplierOrdersForScore(organizationId: number, supplierId: number): Promise<ScoredOrder[]> {
  const rows = (await getDb()
    .prepare("SELECT status, expected_date, received_at FROM purchase_orders WHERE organization_id = ? AND supplier_id = ? AND status IN ('received', 'closed')")
    .all(organizationId, supplierId)) as unknown as { status: string; expected_date: string | null; received_at: string | null }[];
  return rows.map((r) => ({ status: r.status, expected_date: r.expected_date, arrived_day: r.received_at ? tehranTodayIso(new Date(r.received_at)) : null }));
}
