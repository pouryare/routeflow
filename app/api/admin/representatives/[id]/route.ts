import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import {
  repsRepo,
  listOnboarding,
  advanceStage,
  completeStep,
  RepStageError,
} from "@/lib/repo/representatives";
import type { RepStage } from "@/lib/repStages";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/admin/representatives/[id]">) {
  const guard = requireRole(req, ["platform_owner", "owner", "rep_manager"]);
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  const rep = repsRepo.get(guard.session.organizationId, Number(id));
  if (!rep) return NextResponse.json({ ok: false, error: "نماینده پیدا نشد" }, { status: 404 });
  return NextResponse.json({
    ok: true,
    representative: rep,
    onboarding: listOnboarding(guard.session.organizationId, Number(id)),
  });
}

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/admin/representatives/[id]">) {
  const guard = requireRole(req, ["platform_owner", "owner", "rep_manager"]);
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as
    | { action: "advance"; stage: RepStage }
    | { action: "complete_step"; step_code: string }
    | null;

  try {
    if (body?.action === "advance") {
      advanceStage(guard.session.organizationId, Number(id), body.stage);
    } else if (body?.action === "complete_step") {
      completeStep(guard.session.organizationId, Number(id), body.step_code, guard.session.user.id);
    } else {
      return NextResponse.json({ ok: false, error: "کنش نامعتبر است" }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof RepStageError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 409 });
    }
    throw e;
  }
}
