import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import {
  recordPayment,
  listPayments,
  PaymentError,
  type PaymentMethod,
  type AllocationInput,
} from "@/lib/repo/payments";

const METHODS: PaymentMethod[] = ["CASH", "POS", "CARD_TO_CARD", "CHEQUE", "CREDIT_NOTE", "OTHER"];

export async function GET(req: NextRequest) {
  const guard = requireRole(req, ["owner", "group_manager", "phone_sales"]);
  if (!guard.ok) return guard.response;

  const customerId = req.nextUrl.searchParams.get("customer_id");
  return NextResponse.json({
    ok: true,
    payments: listPayments(
      guard.session.organizationId,
      customerId ? { customer_id: Number(customerId) } : undefined
    ),
  });
}

export async function POST(req: NextRequest) {
  const guard = requireRole(req, ["owner", "group_manager", "phone_sales"]);
  if (!guard.ok) return guard.response;

  const body = (await req.json().catch(() => null)) as {
    customer_id?: number;
    amount_toman?: number;
    method?: string;
    received_at?: string;
    reference?: string | null;
    note?: string | null;
    allocations?: AllocationInput[];
  } | null;

  if (
    !body?.customer_id ||
    !Number.isInteger(body.amount_toman) ||
    !body.method ||
    !METHODS.includes(body.method as PaymentMethod) ||
    !body.received_at
  ) {
    return NextResponse.json({ ok: false, error: "اطلاعات دریافت ناقص است" }, { status: 400 });
  }

  try {
    const id = recordPayment(guard.session.organizationId, {
      customer_id: Number(body.customer_id),
      amount_toman: body.amount_toman as number,
      method: body.method as PaymentMethod,
      received_at: body.received_at,
      received_by: guard.session.user.id,
      reference: body.reference ?? null,
      note: body.note ?? null,
      allocations: body.allocations,
    });
    return NextResponse.json({ ok: true, id }, { status: 201 });
  } catch (e) {
    if (e instanceof PaymentError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 409 });
    }
    throw e;
  }
}
