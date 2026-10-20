import { NextRequest, NextResponse } from "next/server";
import { canReachGroup, requireRole } from "@/lib/session";
import {
  recordPayment,
  listPayments,
  listPaymentsScoped,
  customerGroupOf,
  PaymentError,
  type PaymentMethod,
  type AllocationInput,
} from "@/lib/repo/payments";
import { isOwner, MANAGE_ROLES } from "@/lib/roles";

const METHODS: PaymentMethod[] = ["CASH", "POS", "CARD_TO_CARD", "CHEQUE", "CREDIT_NOTE", "OTHER"];

export async function GET(req: NextRequest) {
  const guard = requireRole(req, [...MANAGE_ROLES, "phone_sales"]);
  if (!guard.ok) return guard.response;

  const customerId = req.nextUrl.searchParams.get("customer_id");
  const session = guard.session;
  const customer_id = customerId ? Number(customerId) : undefined;
  // Owners and the platform key see the organisation's receipts; a group manager their group's;
  // a salesperson the ones they took or whose customer they sold to.
  if (isOwner(session.role)) {
    return NextResponse.json({
      ok: true,
      payments: listPayments(session.organizationId, customer_id ? { customer_id } : undefined),
    });
  }
  return NextResponse.json({
    ok: true,
    payments: listPaymentsScoped(session.organizationId, {
      customer_id,
      ...(session.role === "group_manager"
        ? { groupIds: session.groupId === null ? [] : [session.groupId] }
        : { salespersonId: session.user.id }),
    }),
  });
}

export async function POST(req: NextRequest) {
  const guard = requireRole(req, [...MANAGE_ROLES, "phone_sales"]);
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

  // A receipt against another group's customer is refused as if the customer did not exist,
  // like every other cross-group write.
  const owner = customerGroupOf(guard.session.organizationId, Number(body.customer_id));
  if (owner && owner.group_id !== null && !canReachGroup(guard.session, owner.group_id)) {
    return NextResponse.json({ ok: false, error: "مشتری پیدا نشد" }, { status: 409 });
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
