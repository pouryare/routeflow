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
  customerGroupOf,
  PaymentError,
  type PaymentMethod,
  type AllocationInput,
} from "@/lib/repo/payments";
import { isOwner, MANAGE_ROLES } from "@/lib/roles";
import { pagePayments, PAYMENTS_PAGE_SIZE, type Payment } from "@/lib/paymentsView";
import { tehranTodayIso } from "@/lib/jalali";

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
  const payments = isOwner(session.role)
    ? await listPayments(session.organizationId, customer_id ? { customer_id } : undefined)
    : await listPaymentsScoped(session.organizationId, {
        customer_id,
        ...(session.role === "group_manager"
          ? { groupIds: session.groupId === null ? [] : [session.groupId] }
          : { salespersonId: session.user.id }),
      });
  // ?page=N (or "all", for the CSV) sends one filtered page and the summary cards instead of every receipt.
  // shortcut: the scoped list is still read whole and cut here; move the filter and LIMIT into SQL when one
  // company holds more than about 50 000 receipts.
  const sp = req.nextUrl.searchParams;
  const pageParam = sp.get("page");
  let send: typeof payments = payments;
  let extra: Record<string, unknown> = {};
  if (pageParam !== null) {
    const voided = sp.get("voided");
    const filters = {
      method: sp.get("method") ?? "",
      from: sp.get("from") ?? "",
      to: sp.get("to") ?? "",
      voided: (voided === "only" || voided === "all" ? voided : "hide") as "hide" | "only" | "all",
    };
    const now = new Date();
    const today = tehranTodayIso(now);
    const weekAgo = tehranTodayIso(new Date(now.getTime() - 7 * 864e5));
    const size = PAYMENTS_PAGE_SIZE;
    const asked = pageParam === "all" ? { page: 0, size: Number.MAX_SAFE_INTEGER } : { page: Number(pageParam) || 0, size };
    const r = pagePayments(payments as unknown as Payment[], filters, asked.page, asked.size, today, weekAgo);
    send = r.rows as unknown as typeof payments;
    extra = { total: r.total, live: r.live, page: r.page, totals: r.totals, page_size: size };
  }
  // Z9: where each was taken, when the phone said.
  const places = await entryPlacesFor(session.organizationId, "payment", send.map((p) => p.id));
  return compressedJson(req, { ok: true, payments: send.map((p) => ({ ...p, place: places.get(p.id) ?? null })), ...extra });
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
