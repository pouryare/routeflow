import { getDb } from "@/lib/db";
import { readOrders } from "@/lib/orders";
import { ordersToWorkbook } from "@/lib/ordersExport";
import { QUEUE_EXPORT } from "@/lib/queueNames";

/** E7: a big export is built off the request. The row holds its progress and, for 24 hours, the file.
 *
 *  `scope_json` is the order filter the route already computed from the session (`orderFilter`), so the
 *  worker, which has no session, reads exactly what the person could read when they asked. Only the
 *  route writes it; the table is tenant-scoped like every other. */
export const EXPORT_KEEP_HOURS = 24;

type Scope = { sql: string; params: number[] };
export type ExportJob = { id: number; user_id: number; status: "queued" | "running" | "done" | "failed"; progress: number; total: number; filename: string | null; error: string | null };

export async function createExportJob(a: { organizationId: number; userId: number; kind: "orders"; scope: Scope; total: number }): Promise<number> {
  const now = new Date();
  const id = Number(
    (await getDb()
      .prepare(`INSERT INTO export_jobs (organization_id, user_id, kind, scope_json, total, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(a.organizationId, a.userId, a.kind, JSON.stringify(a.scope), a.total, now.toISOString(), new Date(now.getTime() + EXPORT_KEEP_HOURS * 3_600_000).toISOString())).lastInsertRowid,
  );
  // The worker is the normal path; with it switched off the job still finishes, in this process.
  const { enqueueJob } = await import("@/lib/worker");
  if (!(await enqueueJob(QUEUE_EXPORT, { id }))) void runExportJob(id).catch(() => {});
  return id;
}

export async function getExportJob(organizationId: number, id: number): Promise<ExportJob | undefined> {
  return (await getDb()
    .prepare("SELECT id, user_id, status, progress, total, filename, error FROM export_jobs WHERE id = ? AND organization_id = ? AND expires_at > ?")
    .get(id, organizationId, new Date().toISOString())) as ExportJob | undefined;
}

export async function exportFile(organizationId: number, id: number): Promise<{ filename: string; file: Buffer } | undefined> {
  const r = (await getDb()
    .prepare("SELECT filename, file FROM export_jobs WHERE id = ? AND organization_id = ? AND status = 'done' AND expires_at > ?")
    .get(id, organizationId, new Date().toISOString())) as { filename: string; file: Buffer } | undefined;
  return r?.file ? r : undefined;
}

/** Builds the file. Safe to run twice: a job already done or running is left alone. */
export async function runExportJob(id: number): Promise<void> {
  const db = getDb();
  const claimed = await db.prepare("UPDATE export_jobs SET status = 'running' WHERE id = ? AND status = 'queued'").run(id);
  if (!Number(claimed.changes)) return;
  const job = (await db.prepare("SELECT organization_id, user_id, scope_json FROM export_jobs WHERE id = ?").get(id)) as { organization_id: number; user_id: number; scope_json: string };
  try {
    const orders = await readOrders(db, JSON.parse(job.scope_json) as Scope, { limit: 5000 });
    const file = await ordersToWorkbook(orders, async (done) => {
      await db.prepare("UPDATE export_jobs SET progress = ? WHERE id = ?").run(done, id);
    });
    const filename = `orders-${new Date().toISOString().slice(0, 10)}.xlsx`;
    await db.prepare("UPDATE export_jobs SET status = 'done', progress = ?, total = ?, file = ?, filename = ? WHERE id = ?").run(orders.length, orders.length, file, filename, id);
    await tell(job.organization_id, job.user_id, id, "خروجی اکسل آماده است", `${orders.length} سفارش؛ تا ۲۴ ساعت می‌توانید دانلود کنید.`);
  } catch (e) {
    const msg = (e instanceof Error ? e.message : "خطا").slice(0, 300);
    await db.prepare("UPDATE export_jobs SET status = 'failed', error = ? WHERE id = ?").run(msg, id);
    await tell(job.organization_id, job.user_id, id, "خروجی اکسل ساخته نشد", "دوباره امتحان کنید.");
  }
}

async function tell(orgId: number, userId: number, jobId: number, title: string, body: string): Promise<void> {
  await getDb()
    .prepare(`INSERT INTO notifications (organization_id, user_id, type_code, title_fa, body_fa, group_key, priority, created_at) VALUES (?, ?, 'export.ready', ?, ?, ?, 'MEDIUM', ?)`)
    .run(orgId, userId, title, body, `export:${jobId}`, new Date().toISOString());
}

/** Files older than their day are dropped, rows and all. Run with the nightly purge. */
export async function purgeExpiredExports(now = new Date()): Promise<number> {
  const r = await getDb().prepare("DELETE FROM export_jobs WHERE expires_at <= ?").run(now.toISOString());
  return Number(r.changes);
}
