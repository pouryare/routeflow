import { BULK_INLINE_MAX, type BulkActor, type BulkPlan } from "@/lib/bulkEdit";
import { applyBulkEdit, previewBulkEdit } from "@/lib/repo/bulkEdit";
import { createBulkJob } from "@/lib/repo/exportJobs";

/** Small changes run now; a big one is queued and the person is told when it is done (E7). */
export async function startBulkEdit(a: BulkActor, plan: BulkPlan): Promise<{ queued: false; changed: number } | { queued: true; jobId: number }> {
  if (plan.ids.length <= BULK_INLINE_MAX) return { queued: false, changed: await applyBulkEdit(a, plan) };
  await previewBulkEdit(a, plan); // refuses a value the person may not set before anything is queued
  return { queued: true, jobId: await createBulkJob(a, plan) };
}
