import { NextRequest, NextResponse } from "next/server";
import { isId } from "@/lib/inputChecks";
import { requireRole } from "@/lib/session";
import {
  chequesRepo,
  advanceCheque,
  ChequeError,
  type ReplacementInput,
} from "@/lib/repo/cheques";
import { PaymentError } from "@/lib/repo/payments";
import type { ChequeStatus } from "@/lib/chequeStates";
import { CHEQUE_TRANSITIONS } from "@/lib/chequeStates";
import { MANAGE_ROLES } from "@/lib/roles";

const STATUSES = Object.keys(CHEQUE_TRANSITIONS) as ChequeStatus[];

export async function GET(req: NextRequest, ctx: RouteContext<"/api/cheques/[id]">) {
  const guard = await requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  if (!isId(id)) return NextResponse.json({ ok: false, error: "شناسه نامعتبر است" }, { status: 400 });
  const cheque = await chequesRepo.get(guard.session.organizationId, Number(id));
  if (!cheque) return NextResponse.json({ ok: false, error: "یافت نشد" }, { status: 404 });
  return NextResponse.json({ ok: true, cheque });
}

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/cheques/[id]">) {
  const guard = await requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  if (!isId(id)) return NextResponse.json({ ok: false, error: "شناسه نامعتبر است" }, { status: 400 });
  const body = (await req.json().catch(() => null)) as {
    action?: string;
    to?: string;
    replacement?: ReplacementInput;
  } | null;

  if (body?.action !== "advance" || !body.to || !STATUSES.includes(body.to as ChequeStatus)) {
    return NextResponse.json({ ok: false, error: "کنش نامعتبر است" }, { status: 400 });
  }

  if (!await chequesRepo.get(guard.session.organizationId, Number(id))) {
    return NextResponse.json({ ok: false, error: "یافت نشد" }, { status: 404 });
  }

  try {
    await advanceCheque(
      guard.session.organizationId,
      Number(id),
      body.to as ChequeStatus,
      guard.session.user.id,
      body.replacement ? { replacement: body.replacement } : undefined
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof ChequeError || e instanceof PaymentError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 409 });
    }
    throw e;
  }
}
