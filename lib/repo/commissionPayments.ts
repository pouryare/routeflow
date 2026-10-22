/** Recording money paid out as commission. Sellers, drivers and group managers are paid the same ACT
 *  (someone left with cash) even though what earned it is computed three different ways, so the insert
 *  is written once here and the three ledgers call it with their own table. The table and column names
 *  come from the fixed KINDS map below, never from a caller. */

import type { DatabaseSync } from "node:sqlite";
import { isToman } from "@/lib/money";
import { orgOfUser } from "@/lib/repo/userOrg";

const KINDS = {
  sales: { table: "commission_payments", person: "salesperson_user_id" },
  driver: { table: "driver_commission_payments", person: "driver_user_id" },
  manager: { table: "manager_commission_payments", person: "manager_user_id" },
} as const;

export type CommissionPaymentKind = keyof typeof KINDS;

export interface CommissionPaymentInput {
  amount_toman: number;
  paid_on: string;
  period_from?: string | null;
  period_to?: string | null;
  notes?: string | null;
  created_by?: number | null;
}

/** `wholeToman` makes a fractional amount a TypeError (the seller and driver ledgers did; the manager
 *  ledger never checked, and keeps not checking). */
export function insertCommissionPayment(
  db: DatabaseSync,
  kind: CommissionPaymentKind,
  personId: number,
  input: CommissionPaymentInput,
  wholeToman: boolean
): number {
  if (wholeToman && !isToman(input.amount_toman)) {
    throw new TypeError("مبلغ پرداخت را به تومان و بدون اعشار وارد کنید");
  }
  const { table, person } = KINDS[kind];
  return Number(
    db
      .prepare(
        `INSERT INTO ${table} (${person}, amount_toman, paid_on, period_from, period_to, notes, created_by, created_at, organization_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        personId,
        input.amount_toman,
        input.paid_on.slice(0, 10),
        input.period_from?.slice(0, 10) ?? null,
        input.period_to?.slice(0, 10) ?? null,
        input.notes ?? null,
        input.created_by ?? null,
        new Date().toISOString(),
        orgOfUser(db, personId, input.created_by)
      ).lastInsertRowid
  );
}

const RATE_KINDS = {
  driver: { table: "driver_commission_rates", person: "driver_user_id", value: "rate_per_kg_toman" },
  manager: { table: "manager_commission_overrides", person: "manager_user_id", value: "override_pct" },
} as const;

/** A dated rate row (insert-only: changing a rate is a new row, so last month's statement cannot be restated
 *  by editing a cell). `personId` null is the company-wide default. The table and columns come from the
 *  fixed RATE_KINDS map; the validation of the value stays with each ledger, which knows its unit. */
export function insertDatedRate(
  db: DatabaseSync,
  kind: keyof typeof RATE_KINDS,
  personId: number | null | undefined,
  value: number,
  input: { valid_from: string; created_by?: number | null }
): number {
  const { table, person, value: valueColumn } = RATE_KINDS[kind];
  return Number(
    db
      .prepare(
        `INSERT INTO ${table} (${person}, ${valueColumn}, valid_from, created_by, created_at, organization_id)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        personId ?? null,
        value,
        input.valid_from.slice(0, 10),
        input.created_by ?? null,
        new Date().toISOString(),
        orgOfUser(db, personId, input.created_by)
      ).lastInsertRowid
  );
}
