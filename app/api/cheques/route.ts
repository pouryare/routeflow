import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { recordChequePayment, listCheques, ChequeError } from "@/lib/repo/cheques";
import { PaymentError } from "@/lib/repo/payments";
import type { ChequeStatus } from "@/lib/chequeStates";
import { CHEQUE_TRANSITIONS } from "@/lib/chequeStates";

const STATUSES = Object.keys(CHEQUE_TRANSITIONS) as ChequeStatus[];

export async function GET(req: NextRequest) {
  const guard = requireRole(req, ["owner", "group_manager"]);
  if (!guard.ok) return guard.response;

  const s = req.nextUrl.searchParams.get("status");
  const customerId = req.nextUrl.searchParams.get("customer_id");
  return NextResponse.json({
    ok: true,
    cheques: listCheques(guard.session.organizationId, {
      status: STATUSES.includes(s as ChequeStatus) ? (s as ChequeStatus) : undefined,
      customer_id: customerId ? Number(customerId) : undefined,
    }),
  });
}

export async function POST(req: NextRequest) {
  const guard = requireRole(req, ["owner", "group_manager"]);
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
    !Number.isInteger(body.amount_toman) ||
    !body.cheque_no ||
    !body.due_date ||
    !body.received_at
  ) {
    return NextResponse.json({ ok: false, error: "اطلاعات چک ناقص است" }, { status: 400 });
  }

  try {
    const out = recordChequePayment(guard.session.organizationId, {
      customer_id: Number(body.customer_id),
      amount_toman: body.amount_toman as number,
      cheque_no: body.cheque_no,
      bank_name: body.bank_name ?? null,
      due_date: body.due_date,
      received_at: body.received_at,
      received_by: guard.session.user.id,
      note: body.note ?? null,
    });
    return NextResponse.json({ ok: true, ...out }, { status: 201 });
  } catch (e) {
    if (e instanceof ChequeError || e instanceof PaymentError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 409 });
    }
    throw e;
  }
}
