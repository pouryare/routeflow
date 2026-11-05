import type { Db } from "@/lib/database/client";
import { getDb } from "@/lib/db";
import type { DocumentSettings } from "@/lib/documentSettings";

/** A13: the company's footer texts and order prefix (nulls mean the defaults). */
export async function documentSettingsFor(organizationId: number, db: Db = getDb()): Promise<DocumentSettings> {
  const r = (await db
    .prepare("SELECT receipt_footer, delivery_note_footer, order_prefix FROM organizations WHERE id = ?")
    .get(organizationId)) as { receipt_footer: string | null; delivery_note_footer: string | null; order_prefix: string | null } | undefined;
  return { receiptFooter: r?.receipt_footer ?? null, deliveryNoteFooter: r?.delivery_note_footer ?? null, orderPrefix: r?.order_prefix ?? null };
}

export async function setDocumentSettings(organizationId: number, s: DocumentSettings): Promise<void> {
  await getDb()
    .prepare("UPDATE organizations SET receipt_footer = ?, delivery_note_footer = ?, order_prefix = ? WHERE id = ?")
    .run(s.receiptFooter, s.deliveryNoteFooter, s.orderPrefix, organizationId);
}
