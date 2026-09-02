import type { DatabaseSync } from "node:sqlite";
import { makeRepo } from "./base";
import {
  CHEQUE_TRANSITIONS,
  canAdvanceCheque,
  type ChequeStatus,
} from "@/lib/chequeStates";
import {
  recordPaymentTxn,
  voidPaymentTxn,
  type AllocationInput,
} from "./payments";

/** A refusal the caller shows the user, not a bug. */
export class ChequeError extends Error {}

export interface ChequeRow {
  id: number;
  organization_id: number;
  customer_id: number;
  amount_toman: number;
  cheque_no: string;
  bank_name: string | null;
  due_date: string;
  status: ChequeStatus;
  received_at: string;
  received_by: number;
  deposited_at: string | null;
  cleared_at: string | null;
  bounced_at: string | null;
  replaced_by_cheque_id: number | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export const chequesRepo = makeRepo<ChequeRow>("cheques", { tenant: true });

export interface RecordChequeInput {
  customer_id: number;
  amount_toman: number;
  cheque_no: string;
  bank_name?: string | null;
  due_date: string;
  received_at: string;
  received_by: number;
  note?: string | null;
  allocations?: AllocationInput[];
}

/** Insert a cheque `in_hand` and a linked CHEQUE payment, allocated like any payment.
 *  The debt is treated as settled while the cheque is live. One transaction. */
function recordChequePaymentTxn(
  db: DatabaseSync,
  organizationId: number,
  input: RecordChequeInput
): { cheque_id: number; payment_id: number } {
  if (!Number.isInteger(input.amount_toman) || input.amount_toman <= 0) {
    throw new ChequeError("مبلغ چک باید عدد صحیح تومان و بزرگ‌تر از صفر باشد");
  }
  const now = new Date().toISOString();

  let chequeId: number;
  try {
    chequeId = Number(
      db
        .prepare(
          `INSERT INTO cheques
             (organization_id, customer_id, amount_toman, cheque_no, bank_name, due_date,
              status, received_at, received_by, note, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'in_hand', ?, ?, ?, ?, ?)`
        )
        .run(
          organizationId,
          input.customer_id,
          input.amount_toman,
          input.cheque_no,
          input.bank_name ?? null,
          input.due_date,
          input.received_at,
          input.received_by,
          input.note ?? null,
          now,
          now
        ).lastInsertRowid
    );
  } catch (e) {
    if (e instanceof Error && /UNIQUE/i.test(e.message)) {
      throw new ChequeError("این شمارهٔ چک برای این مشتری قبلاً ثبت شده است");
    }
    throw e;
  }

  const paymentId = recordPaymentTxn(db, organizationId, {
    customer_id: input.customer_id,
    amount_toman: input.amount_toman,
    method: "CHEQUE",
    received_at: input.received_at,
    received_by: input.received_by,
    cheque_id: chequeId,
    note: input.note ?? null,
    allocations: input.allocations,
  });

  return { cheque_id: chequeId, payment_id: paymentId };
}

export function recordChequePayment(
  organizationId: number,
  input: RecordChequeInput
): { cheque_id: number; payment_id: number } {
  const db = chequesRepo.db();
  db.exec("BEGIN IMMEDIATE");
  try {
    const out = recordChequePaymentTxn(db, organizationId, input);
    db.exec("COMMIT");
    return out;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

const STAMP: Partial<Record<ChequeStatus, "deposited_at" | "cleared_at" | "bounced_at">> = {
  deposited: "deposited_at",
  cleared: "cleared_at",
  bounced: "bounced_at",
};

export interface ReplacementInput {
  cheque_no: string;
  due_date: string;
  bank_name?: string | null;
  amount_toman?: number;
  received_at?: string;
}

/** Move a cheque along its lifecycle, enforcing lib/chequeStates.
 *
 *  - `bounced` voids the linked payment (reversing every allocation, so the debt
 *    re-opens) and raises a customer reminder.
 *  - `replaced` voids the linked payment if it is still live, then records the
 *    replacement cheque + payment (FIFO onto the now-unpaid orders) and links the two.
 */
export function advanceCheque(
  organizationId: number,
  id: number,
  to: ChequeStatus,
  actor: number,
  opts?: { replacement?: ReplacementInput }
): void {
  const db = chequesRepo.db();
  db.exec("BEGIN IMMEDIATE");
  try {
    const cheque = db
      .prepare("SELECT * FROM cheques WHERE id = ? AND organization_id = ?")
      .get(id, organizationId) as ChequeRow | undefined;
    if (!cheque) throw new ChequeError("چک پیدا نشد");

    if (!canAdvanceCheque(cheque.status, to)) {
      throw new ChequeError(
        `گذار از «${cheque.status}» به «${to}» مجاز نیست` +
          (CHEQUE_TRANSITIONS[cheque.status].length === 0 ? " (وضعیت نهایی)" : "")
      );
    }

    const now = new Date().toISOString();
    const linkedPayment = db
      .prepare("SELECT id, voided_at FROM payments WHERE cheque_id = ?")
      .get(id) as { id: number; voided_at: string | null } | undefined;

    if (to === "bounced" || to === "replaced") {
      if (linkedPayment && !linkedPayment.voided_at) {
        voidPaymentTxn(
          db,
          organizationId,
          linkedPayment.id,
          actor,
          to === "bounced" ? "چک برگشت خورد" : "چک جایگزین شد"
        );
      }
    }

    if (to === "bounced") {
      db.prepare(
        `INSERT INTO reminders (entity_type, entity_id, due_date, message, resolved, created_at)
         VALUES ('customer', ?, ?, ?, 0, ?)`
      ).run(
        cheque.customer_id,
        now.slice(0, 10),
        `چک ${cheque.cheque_no} برگشت خورد — پیگیری کنید`,
        now
      );
    }

    let replacementId: number | null = null;
    if (to === "replaced") {
      if (!opts?.replacement) {
        throw new ChequeError("برای جایگزینی، مشخصات چک جدید لازم است");
      }
      const r = opts.replacement;
      const { cheque_id } = recordChequePaymentTxn(db, organizationId, {
        customer_id: cheque.customer_id,
        amount_toman: r.amount_toman ?? cheque.amount_toman,
        cheque_no: r.cheque_no,
        bank_name: r.bank_name ?? cheque.bank_name,
        due_date: r.due_date,
        received_at: r.received_at ?? now,
        received_by: actor,
        note: `جایگزین چک ${cheque.cheque_no}`,
      });
      replacementId = cheque_id;
    }

    const stampCol = STAMP[to];
    db.prepare(
      `UPDATE cheques
          SET status = ?, updated_at = ?,
              replaced_by_cheque_id = COALESCE(?, replaced_by_cheque_id)` +
        (stampCol ? `, ${stampCol} = ?` : "") +
        ` WHERE id = ? AND organization_id = ?`
    ).run(
      ...(stampCol
        ? [to, now, replacementId, now, id, organizationId]
        : [to, now, replacementId, id, organizationId])
    );

    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export function listCheques(
  organizationId: number,
  filter?: { status?: ChequeStatus; customer_id?: number }
): ChequeRow[] {
  const where: Partial<ChequeRow> = {};
  if (filter?.status) where.status = filter.status;
  if (filter?.customer_id) where.customer_id = filter.customer_id;
  return chequesRepo.list(organizationId, where);
}

/** The board view: every cheque bucketed by status. */
export function chequesByStatus(organizationId: number): Record<ChequeStatus, ChequeRow[]> {
  const out = {
    issued: [],
    in_hand: [],
    deposited: [],
    cleared: [],
    bounced: [],
    replaced: [],
    cancelled: [],
  } as Record<ChequeStatus, ChequeRow[]>;
  for (const c of chequesRepo.list(organizationId)) out[c.status].push(c);
  return out;
}
