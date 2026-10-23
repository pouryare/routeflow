import { makeRepo } from "./base";
import type { BatchRow } from "./batches";

export class ComplaintError extends Error {}

export type ComplaintCategory =
  | "spoilage"
  | "packaging"
  | "foreign_object"
  | "short_weight"
  | "wrong_product"
  | "other";
export type ComplaintSeverity = "low" | "medium" | "high" | "critical";
export type ComplaintStatus = "open" | "investigating" | "resolved" | "dismissed";

export interface ComplaintRow {
  id: number;
  organization_id: number;
  customer_id: number | null;
  order_id: number | null;
  product_id: number | null;
  batch_id: number | null;
  reported_at: string;
  reported_by: number | null;
  category: ComplaintCategory;
  severity: ComplaintSeverity;
  description: string | null;
  status: ComplaintStatus;
  resolution: string | null;
  resolved_at: string | null;
  resolved_by: number | null;
  created_at: string;
}

export const complaintsRepo = makeRepo<ComplaintRow>("quality_complaints", { tenant: true });

export interface FileComplaintInput {
  customer_id?: number | null;
  order_id?: number | null;
  product_id?: number | null;
  batch_id?: number | null;
  reported_by: number;
  category: ComplaintCategory;
  severity?: ComplaintSeverity;
  description?: string | null;
}

/** Log a complaint. When an order + product are named but no batch, infer the batch
 *  from what that order line actually received. */
export async function fileComplaint(organizationId: number, input: FileComplaintInput): Promise<number> {
  const db = complaintsRepo.db();
  let batchId = input.batch_id ?? null;
  if (!batchId && input.order_id && input.product_id) {
    const row = await db
      .prepare(
        `SELECT dlb.batch_id
           FROM delivery_line_batches dlb
           JOIN order_lines ol ON ol.id = dlb.order_line_id
          WHERE ol.order_id = ? AND ol.product_id = ? AND dlb.batch_id IS NOT NULL
          LIMIT 1`
      )
      .get(input.order_id, input.product_id) as { batch_id: number } | undefined;
    if (row) batchId = row.batch_id;
  }
  const now = new Date().toISOString();
  return Number(
    (await db
      .prepare(
        `INSERT INTO quality_complaints
           (organization_id, customer_id, order_id, product_id, batch_id, reported_at,
            reported_by, category, severity, description, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`
      )
      .run(
        organizationId,
        input.customer_id ?? null,
        input.order_id ?? null,
        input.product_id ?? null,
        batchId,
        now,
        input.reported_by,
        input.category,
        input.severity ?? "medium",
        input.description ?? null,
        now
      )).lastInsertRowid
  );
}

export async function updateComplaint(
  organizationId: number,
  id: number,
  patch: { status?: ComplaintStatus; severity?: ComplaintSeverity; resolution?: string | null },
  actor: number
): Promise<void> {
  const row = await complaintsRepo.get(organizationId, id);
  if (!row) throw new ComplaintError("شکایت پیدا نشد");

  const fields: Partial<ComplaintRow> = {};
  if (patch.status !== undefined) fields.status = patch.status;
  if (patch.severity !== undefined) fields.severity = patch.severity;
  if (patch.resolution !== undefined) fields.resolution = patch.resolution;
  if (patch.status === "resolved" || patch.status === "dismissed") {
    fields.resolved_at = new Date().toISOString();
    fields.resolved_by = actor;
  }
  await complaintsRepo.patch(organizationId, id, fields);
}

export async function listComplaints(
  organizationId: number,
  filter?: { status?: ComplaintStatus; batch_id?: number; customer_id?: number }
): Promise<ComplaintRow[]> {
  const where: Partial<ComplaintRow> = {};
  if (filter?.status) where.status = filter.status;
  if (filter?.batch_id) where.batch_id = filter.batch_id;
  if (filter?.customer_id) where.customer_id = filter.customer_id;
  return (await complaintsRepo
    .list(organizationId, where))
    .sort((a, b) => (a.reported_at < b.reported_at ? 1 : -1));
}

export interface ComplaintCluster {
  batch_id: number;
  batch_code: string;
  product_id: number;
  count: number;
  severities: string[];
}

/** Batches with several unresolved complaints in a recent window -- a signal to look,
 *  not a verdict. */
export async function complaintClusters(
  organizationId: number,
  opts?: { sinceDays?: number; minCount?: number }
): Promise<ComplaintCluster[]> {
  const sinceDays = opts?.sinceDays ?? 30;
  const minCount = opts?.minCount ?? 2;
  return (await complaintsRepo
    .db()
    .prepare(
      `SELECT qc.batch_id, b.batch_code, b.product_id,
              COUNT(*) AS count,
              GROUP_CONCAT(DISTINCT qc.severity) AS severities
         FROM quality_complaints qc
         JOIN batches b ON b.id = qc.batch_id
        WHERE qc.organization_id = ?
          AND qc.batch_id IS NOT NULL
          AND qc.status IN ('open', 'investigating')
          AND qc.reported_at >= date('now', ?)
        GROUP BY qc.batch_id
        HAVING COUNT(*) >= ?
        ORDER BY count DESC`
    )
    .all(organizationId, `-${sinceDays} days`, minCount))
    .map((r) => {
      const row = r as { batch_id: number; batch_code: string; product_id: number; count: number; severities: string };
      return { ...row, severities: row.severities ? row.severities.split(",") : [] };
    });
}

export interface BackwardTrace {
  complaint: ComplaintRow;
  order: { id: number; order_no: string } | null;
  batch: BatchRow | null;
  purchase_line: { id: number; unit_cost_toman: number; purchase_id: number } | null;
  supplier_batch_ref: string | null;
}

/** Complaint → order → batch → purchase line → supplier's own lot reference. */
export async function backwardTrace(organizationId: number, complaintId: number): Promise<BackwardTrace | null> {
  const complaint = await complaintsRepo.get(organizationId, complaintId);
  if (!complaint) return null;
  const db = complaintsRepo.db();

  const order = complaint.order_id
    ? ((await db.prepare("SELECT id, order_no FROM orders WHERE id = ?").get(complaint.order_id) as
        | { id: number; order_no: string }
        | undefined) ?? null)
    : null;

  const batch = complaint.batch_id
    ? ((await db.prepare("SELECT * FROM batches WHERE id = ? AND organization_id = ?").get(
        complaint.batch_id,
        organizationId
      ) as BatchRow | undefined) ?? null)
    : null;

  const purchase_line =
    batch?.purchase_line_id != null
      ? ((await db
          .prepare(
            "SELECT id, unit_cost_toman, purchase_id FROM purchase_lines WHERE id = ?"
          )
          .get(batch.purchase_line_id) as
          | { id: number; unit_cost_toman: number; purchase_id: number }
          | undefined) ?? null)
      : null;

  return {
    complaint,
    order,
    batch,
    purchase_line,
    supplier_batch_ref: batch?.supplier_batch_ref ?? null,
  };
}
