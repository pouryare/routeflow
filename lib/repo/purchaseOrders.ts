import { getDb } from "@/lib/db";
import type { Db } from "@/lib/database/client";
import { faNum } from "@/lib/format";
import { tehranTodayIso } from "@/lib/jalali";
import { PO_OPEN, isLate, poProblem, priceGapPercent, remaining, statusAfterAction, statusAfterReceipt, arrivalsDue, type ArrivalSlot, type PoStatus } from "@/lib/purchaseOrders";
import { productInOrg } from "@/lib/repo/catalogueAdmin";
import type { ScoredOrder } from "@/lib/supplierScore";

export class PurchaseOrderError extends Error {}

export interface PoRow {
  id: number;
  supplier_id: number;
  supplier_name: string;
  status: PoStatus;
  expected_date: string | null;
  expected_slot: ArrivalSlot | null;
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
      `SELECT po.id, po.supplier_id, s.name AS supplier_name, po.status, po.expected_date, po.expected_slot, po.notes, po.created_at
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
export async function applyReceipt(db: Db, organizationId: number, orderId: number, got: { product_id: number; base_qty: number; unit_cost_toman?: number }[]): Promise<PoStatus> {
  const po = (await db.prepare("SELECT status FROM purchase_orders WHERE id = ? AND organization_id = ?").get(orderId, organizationId)) as { status: PoStatus } | undefined;
  if (!po) throw new PurchaseOrderError("سفارش خرید پیدا نشد");
  if (!PO_OPEN.includes(po.status)) throw new PurchaseOrderError("این سفارش خرید دیگر منتظر کالا نیست");
  const now0 = new Date().toISOString();
  for (const g of got) {
    // F66 price flag: a receipt dearer or cheaper than the order raises one alert for the owner, naming the product and the gap.
    if (g.unit_cost_toman !== undefined) {
      const ordered = (await db.prepare("SELECT l.unit_cost_toman, p.name FROM purchase_order_lines l JOIN products p ON p.id = l.product_id WHERE l.purchase_order_id = ? AND l.product_id = ? AND l.unit_cost_toman > 0 ORDER BY l.id LIMIT 1").get(orderId, g.product_id)) as { unit_cost_toman: number; name: string } | undefined;
      const gap = ordered ? priceGapPercent(Number(ordered.unit_cost_toman), g.unit_cost_toman) : null;
      if (ordered && gap !== null) {
        await db.prepare("INSERT INTO alerts (organization_id, severity, category, title, entity_type, entity_id, created_at) VALUES (?, 'warning', 'po_price_diff', ?, 'purchase_order', ?, ?)").run(
          organizationId, `قیمت «${ordered.name}» در رسید ${faNum(Math.abs(gap))}٪ ${gap > 0 ? "بیشتر" : "کمتر"} از سفارش است`, orderId, now0);
      }
    }
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
      `SELECT l.product_id, SUM(l.base_qty - LEAST(l.received_qty, l.base_qty))
                - COALESCE((SELECT SUM(ol.packs_ordered * ol.qty_per_pack) FROM order_lines ol JOIN orders o ON o.id = ol.order_id WHERE o.organization_id = ? AND ol.product_id = l.product_id AND ol.is_preorder = 1 AND o.status NOT IN ('CANCELLED', 'CLOSED', 'RETURNED', 'DELIVERED', 'PARTIALLY_DELIVERED', 'DELIVERY_FAILED')), 0) AS qty, MIN(po.expected_date) AS expected
         FROM purchase_order_lines l JOIN purchase_orders po ON po.id = l.purchase_order_id
        WHERE po.organization_id = ? AND po.status IN ('ordered', 'partly_received')
        GROUP BY l.product_id`
    )
    .all(organizationId, organizationId)) as unknown as { product_id: number; qty: number; expected: string | null }[];
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

/** F87: says which day, and which half of it, an open order is expected. Returns the problem in words, or null once saved. */
export async function scheduleArrival(organizationId: number, id: number, expectedDate: string, slot: ArrivalSlot | null): Promise<string | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expectedDate) || expectedDate < tehranTodayIso()) return "روز رسیدن باید امروز یا بعد از آن باشد";
  const db = getDb();
  const po = (await db.prepare("SELECT status FROM purchase_orders WHERE id = ? AND organization_id = ?").get(id, organizationId)) as { status: PoStatus } | undefined;
  if (!po) return "سفارش خرید پیدا نشد";
  if (po.status !== "draft" && !PO_OPEN.includes(po.status)) return "این سفارش دیگر منتظر کالا نیست";
  await db.prepare("UPDATE purchase_orders SET expected_date = ?, expected_slot = ? WHERE id = ? AND organization_id = ?").run(expectedDate, slot, id, organizationId);
  return null;
}

/** The expected-arrivals list for the warehouse: open orders due within a week, late ones included. */
export async function expectedArrivals(organizationId: number, today = tehranTodayIso()): Promise<PoRow[]> {
  const until = new Date(Date.parse(`${today}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
  return arrivalsDue(await listPurchaseOrders(organizationId, { open: true }), until);
}

/** The products a hand-made purchase order can list (active ones of this company), for the form's picker. */
export async function productPickList(organizationId: number): Promise<{ id: string; label: string }[]> {
  const rows = (await getDb().prepare("SELECT id, name FROM products WHERE organization_id = ? AND active = 1 ORDER BY name").all(organizationId)) as unknown as { id: number; name: string }[];
  return rows.map((r) => ({ id: String(r.id), label: r.name }));
}
