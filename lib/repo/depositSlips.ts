import { getDb } from "@/lib/db";
import { advanceCheque, ChequeError } from "@/lib/repo/cheques";

export interface SlipView {
  id: number;
  slipNo: number;
  createdAt: string;
  total: number;
  cheques: { chequeNo: string; bankName: string | null; dueDate: string; amount: number; customer: string }[];
}

/** D2: deposit the ticked cheques at once under one numbered slip (the number counts up per company). Every cheque must be in hand. */
export async function depositCheques(organizationId: number, ids: number[], by: number): Promise<number> {
  const uniq = [...new Set(ids)];
  if (uniq.length === 0 || uniq.length > 200) throw new ChequeError("چکی انتخاب نشده است");
  const db = getDb();
  return await db.tx(async () => {
    const rows = (await db
      .prepare(`SELECT id, amount_toman, status FROM cheques WHERE organization_id = ? AND id IN (${uniq.map(() => "?").join(",")})`)
      .all(organizationId, ...uniq)) as unknown as { id: number; amount_toman: number; status: string }[];
    if (rows.length !== uniq.length || rows.some((r) => r.status !== "in_hand")) throw new ChequeError("همهٔ چک‌های انتخاب‌شده باید در دست باشند");
    const total = rows.reduce((s, r) => s + Number(r.amount_toman), 0);
    const slip = Number(
      (await db
        .prepare(
          `INSERT INTO deposit_slips (organization_id, slip_no, cheque_count, total_toman, created_by, created_at)
           SELECT ?, COALESCE(MAX(slip_no), 0) + 1, ?, ?, ?, ? FROM deposit_slips WHERE organization_id = ?`
        )
        .run(organizationId, uniq.length, total, by, new Date().toISOString(), organizationId)).lastInsertRowid
    );
    for (const id of uniq) {
      await advanceCheque(organizationId, id, "deposited", by);
      await db.prepare("UPDATE cheques SET deposit_slip_id = ? WHERE id = ? AND organization_id = ?").run(slip, id, organizationId);
    }
    return slip;
  });
}

export async function slipView(organizationId: number, id: number): Promise<SlipView | null> {
  const db = getDb();
  const s = (await db.prepare("SELECT id, slip_no, created_at, total_toman FROM deposit_slips WHERE id = ? AND organization_id = ?").get(id, organizationId)) as
    | { id: number; slip_no: number; created_at: string; total_toman: number }
    | undefined;
  if (!s) return null;
  const rows = (await db
    .prepare(
      `SELECT c.cheque_no, c.bank_name, c.due_date, c.amount_toman, cu.business_name
         FROM cheques c JOIN customers cu ON cu.id = c.customer_id
        WHERE c.deposit_slip_id = ? AND c.organization_id = ? ORDER BY c.due_date, c.id`
    )
    .all(id, organizationId)) as unknown as { cheque_no: string; bank_name: string | null; due_date: string; amount_toman: number; business_name: string }[];
  return {
    id: Number(s.id),
    slipNo: Number(s.slip_no),
    createdAt: s.created_at,
    total: Number(s.total_toman),
    cheques: rows.map((r) => ({ chequeNo: r.cheque_no, bankName: r.bank_name, dueDate: r.due_date, amount: Number(r.amount_toman), customer: r.business_name })),
  };
}
