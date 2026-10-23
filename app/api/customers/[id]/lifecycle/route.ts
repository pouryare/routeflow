import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { setLifecycle, LifecycleError } from "@/lib/repo/customers";
import type { CustomerLifecycle } from "@/lib/types";
import { MANAGE_ROLES } from "@/lib/roles";

const VALID: CustomerLifecycle[] = [
  "lead",
  "qualified",
  "sampled",
  "active",
  "dormant",
  "lost",
  "blocked",
];

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/customers/[id]/lifecycle">) {
  const guard = await requireRole(req, [...MANAGE_ROLES, "phone_sales"]);
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as { lifecycle?: string } | null;
  if (!body?.lifecycle || !VALID.includes(body.lifecycle as CustomerLifecycle)) {
    return NextResponse.json({ ok: false, error: "وضعیت نامعتبر است" }, { status: 400 });
  }

  try {
    await setLifecycle(guard.session.organizationId, Number(id), body.lifecycle as CustomerLifecycle);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof LifecycleError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 409 });
    }
    throw e;
  }
}
