import { compressedJson } from "@/lib/httpCache";
import { NextRequest, NextResponse } from "next/server";
import { parsePlace } from "@/lib/entryPlace";
import { entryPlacesFor, saveEntryPlace } from "@/lib/repo/entryPlaces";
import { isId } from "@/lib/inputChecks";
import { canReachGroup, requireRole } from "@/lib/session";
import {
  recordPayment,
  listPayments,
  listPaymentsScoped,
  pagePayments,
  customerGroupOf,
  type PaymentScope,
  PaymentError,
  type PaymentMethod,
  type AllocationInput,
} from "@/lib/repo/payments";
import { isOwner, MANAGE_ROLES } from "@/lib/roles";
import { PAYMENTS_PAGE_SIZE } from "@/lib/paymentsView";


const METHODS: PaymentMethod[] = ["CASH", "POS", "CARD_TO_CARD", "CHEQUE", "CREDIT_NOTE", "OTHER"];

export async function GET(req: NextRequest) {
  const guard = await requireRole(req, [...MANAGE_ROLES, "phone_sales"]);
  if (!guard.ok) return guard.response;

  const customerId = req.nextUrl.searchParams.get("customer_id");
  const session = guard.session;
  if (customerId && !isId(customerId)) {
    return NextResponse.json({ ok: false, error: "شناسه نامعتبر است" }, { status: 400 });
  }
  const customer_id = customerId ? Number(customerId) : undefined;
  // Owners and the platform key see the organisation's receipts; a group manager their group's;
  // a salesperson the ones they took or whose customer they sold to.
  const scope: PaymentScope = isOwner(session.role)
    ? null
    : session.role === "group_manager"
      ? { groupIds: session.groupId === null ? [] : [session.groupId] }
      : { salespersonId: session.user.id };

  /* ?page=N: one page of the list and the receipts the totals cards need, instead of all of them
     (the CSV export still asks without a page). */
  const pageParam = req.nextUrl.searchParams.get("page");
  if (pageParam !== null) {
    const q = req.nextUrl.searchParams;
    const day = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
    const method = q.get("method") ?? "";
    const voided = q.get("voided");
    const page = /^\d{1,6}$/.test(pageParam) ? Math.max(1, Number(pageParam)) : 1;
    const { rows, total } = await pagePayments(
      session.organizationId,
      scope,
      {
        customer_id,
        method: METHODS.includes(method as PaymentMethod) ? method : undefined,
        from: day(q.get("from")),
        to: day(q.get("to")),
        voided: voided === "only" || voided === "all" ? voided : "hide",
      },
      page,
      PAYMENTS_PAGE_SIZE
    );
    // The totals cards cover today, the last 7 days and this month: the live receipts since the
    // earlier of a week ago and the first of the month.
    const since = day(q.get("recent_from"));
    // shortcut: capped at 5,000 receipts in ~5 weeks; read the saved daily totals instead if a company outgrows it.
    const recent = since
      ? (await pagePayments(session.organizationId, scope, { customer_id, from: since, voided: "hide" }, 1, 5000)).rows
      : [];
    // An empty filtered list says how many receipts the filter hides (FilteredEmpty).
    const unfiltered = total === 0 ? (await pagePayments(session.organizationId, scope, { customer_id, voided: "hide" }, 1, 1)).total : 0;
    const places = await entryPlacesFor(session.organizationId, "payment", rows.map((p) => p.id));
    return compressedJson(req, {
      ok: true,
      payments: rows.map((p) => ({ ...p, place: places.get(p.id) ?? null })),
      total,
      page,
      pageSize: PAYMENTS_PAGE_SIZE,
      recent,
      unfiltered,
    });
  }

  const payments = scope === null
    ? await listPayments(session.organizationId, customer_id ? { customer_id } : undefined)
    : await listPaymentsScoped(session.organizationId, { customer_id, ...scope });
  // Z9: where each was taken, when the phone said.
  const places = await entryPlacesFor(session.organizationId, "payment", payments.map((p) => p.id));
  return compressedJson(req, { ok: true, payments: payments.map((p) => ({ ...p, place: places.get(p.id) ?? null })) });
}

export async function POST(req: NextRequest) {
  const guard = await requireRole(req, [...MANAGE_ROLES, "phone_sales"]);
  if (!guard.ok) return guard.response;

  const body = (await req.json().catch(() => null)) as {
    customer_id?: number;
    amount_toman?: number;
    method?: string;
    received_at?: string;
    reference?: string | null;
    note?: string | null;
    allocations?: AllocationInput[];
    place?: unknown;
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
  const owner = await customerGroupOf(guard.session.organizationId, Number(body.customer_id));
  if (owner && owner.group_id !== null && !await canReachGroup(guard.session, owner.group_id)) {
    return NextResponse.json({ ok: false, error: "مشتری پیدا نشد" }, { status: 409 });
  }

  try {
    const id = await recordPayment(guard.session.organizationId, {
      customer_id: Number(body.customer_id),
      amount_toman: body.amount_toman as number,
      method: body.method as PaymentMethod,
      received_at: body.received_at,
      received_by: guard.session.user.id,
      reference: body.reference ?? null,
      note: body.note ?? null,
      allocations: body.allocations,
    });
    await saveEntryPlace(guard.session.organizationId, "payment", id, parsePlace(body.place));
    return NextResponse.json({ ok: true, id }, { status: 201 });
  } catch (e) {
    if (e instanceof PaymentError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 409 });
    }
    throw e;
  }
}
