import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { MANAGE_ROLES } from "@/lib/roles";
import { decideTransfer, requestTransfer } from "@/lib/repo/orderTransfers";

const bad = (error: string) => NextResponse.json({ ok: false, error }, { status: 400 });

/** F96: POST { order_id, to_group_id } asks another group to fulfil a confirmed order. Managers only. */
export async function POST(req: NextRequest) {
  const guard = await requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;
  const b = (await req.json().catch(() => null)) as { order_id?: unknown; to_group_id?: unknown } | null;
  if (typeof b?.order_id !== "number" || typeof b.to_group_id !== "number") return bad("درخواست نامعتبر است");
  const refused = await requestTransfer(guard.session, b.order_id, b.to_group_id);
  return refused ? bad(refused) : NextResponse.json({ ok: true });
}

/** PATCH { id, accept } is the receiving group's answer. */
export async function PATCH(req: NextRequest) {
  const guard = await requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;
  const b = (await req.json().catch(() => null)) as { id?: unknown; accept?: unknown } | null;
  if (typeof b?.id !== "number" || typeof b.accept !== "boolean") return bad("درخواست نامعتبر است");
  const refused = await decideTransfer(guard.session, b.id, b.accept);
  return refused ? bad(refused) : NextResponse.json({ ok: true });
}
