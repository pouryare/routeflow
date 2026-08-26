import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { recordPayment } from "@/lib/commissionLedger";
import { isToman } from "@/lib/money";

/** Owner only. Recording a commission payment is recording that money left. */
export async function POST(req: NextRequest) {
  const guard = requireRole(req, ["owner"]);
  if (!guard.ok) return guard.response;

  const body = (await req.json().catch(() => null)) as {
    salesperson_user_id?: unknown;
    amount_toman?: unknown;
    paid_on?: unknown;
    period_from?: unknown;
    period_to?: unknown;
    notes?: unknown;
  } | null;

  const amount = Number(body?.amount_toman);
  if (!isToman(amount) || amount === 0) {
    return NextResponse.json(
      { ok: false, error: "مبلغ باید عدد صحیح تومان و غیر صفر باشد" },
      { status: 400 }
    );
  }

  const paidOn = typeof body?.paid_on === "string" ? body.paid_on : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn) || Number.isNaN(Date.parse(paidOn))) {
    return NextResponse.json({ ok: false, error: "تاریخ پرداخت معتبر نیست" }, { status: 400 });
  }

  const db = getDb();
  const personId = Number(body?.salesperson_user_id);
  const person = db
    .prepare("SELECT id FROM users WHERE id = ? AND role = 'salesperson'")
    .get(personId);
  if (!person) {
    return NextResponse.json({ ok: false, error: "این حساب فروشنده نیست" }, { status: 400 });
  }

  const id = recordPayment(db, {
    salesperson_user_id: personId,
    amount_toman: amount,
    paid_on: paidOn,
    period_from: typeof body?.period_from === "string" ? body.period_from : null,
    period_to: typeof body?.period_to === "string" ? body.period_to : null,
    notes: typeof body?.notes === "string" ? body.notes : null,
    created_by: guard.session.user.id,
  });

  return NextResponse.json({ ok: true, id }, { status: 201 });
}
