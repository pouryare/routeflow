import { boundedText, isDayWithin, isQuantity, isTimestampWithin } from "@/lib/inputChecks";
import { isToman } from "@/lib/money";
import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { recordChequePayment, listCheques, ChequeError } from "@/lib/repo/cheques";
import { PaymentError } from "@/lib/repo/payments";
import type { ChequeStatus } from "@/lib/chequeStates";
import { CHEQUE_TRANSITIONS } from "@/lib/chequeStates";
import { MANAGE_ROLES } from "@/lib/roles";

const STATUSES = Object.keys(CHEQUE_TRANSITIONS) as ChequeStatus[];

export async function GET(req: NextRequest) {
  const guard = await requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;

  const s = req.nextUrl.searchParams.get("status");
  const customerId = req.nextUrl.searchParams.get("customer_id");
  return NextResponse.json({
    ok: true,
    cheques: await listCheques(guard.session.organizationId, {
      status: STATUSES.includes(s as ChequeStatus) ? (s as ChequeStatus) : undefined,
      customer_id: customerId ? Number(customerId) : undefined,
    }),
  });
}

export async function POST(req: NextRequest) {
  const guard = await requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;

  const body = (await req.json().catch(() => null)) as {
    customer_id?: number;
    amount_toman?: number;
    cheque_no?: string;
    bank_name?: string | null;
    due_date?: string;
    received_at?: string;
    note?: string | null;
  } | null;

  if (
    !body?.customer_id ||
    !isToman(body.amount_toman as number) || (body.amount_toman as number) <= 0 ||
    !body.cheque_no ||
    !body.due_date ||
    !body.received_at
  ) {
    return NextResponse.json({ ok: false, error: "اطلاعات چک ناقص است" }, { status: 400 });
  }

  // Dates and the cheque number: a due date of "zzz" or 1900 and a 5,000-character number were all accepted.
  if (!isDayWithin(body.due_date, 366, 5 * 366) || !isTimestampWithin(body.received_at, 5 * 366, 1)) {
    return NextResponse.json({ ok: false, error: "تاریخ چک یا سررسید معتبر نیست" }, { status: 400 });
  }
  const chequeNo = boundedText(body.cheque_no, 40);
  if (!chequeNo) {
    return NextResponse.json({ ok: false, error: "شمارهٔ چک باید حداکثر ۴۰ نویسه باشد" }, { status: 400 });
  }
  const bankName = body.bank_name == null ? null : boundedText(body.bank_name, 80);
  const chequeNote = body.note == null ? null : boundedText(body.note, 2000);
  if ((body.bank_name != null && bankName === null) || (body.note != null && chequeNote === null)) {
    return NextResponse.json({ ok: false, error: "نام بانک یا یادداشت بیش از حد بلند است" }, { status: 400 });
  }

  try {
    const out = await recordChequePayment(guard.session.organizationId, {
      customer_id: Number(body.customer_id),
      amount_toman: body.amount_toman as number,
      cheque_no: chequeNo,
      bank_name: bankName,
      due_date: body.due_date,
      received_at: body.received_at,
      received_by: guard.session.user.id,
      note: chequeNote,
    });
    return NextResponse.json({ ok: true, ...out }, { status: 201 });
  } catch (e) {
    if (e instanceof ChequeError || e instanceof PaymentError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 409 });
    }
    throw e;
  }
}
