import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { rulesFor, setTenantRuleOverride, RuleError } from "@/lib/repo/rules";
import { MANAGE_ROLES } from "@/lib/roles";

export async function GET(req: NextRequest) {
  const guard = requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;
  return NextResponse.json({ ok: true, rules: rulesFor(guard.session.organizationId) });
}

export async function PATCH(req: NextRequest) {
  const guard = requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;
  const b = (await req.json().catch(() => null)) as {
    code?: string;
    active?: boolean;
    cooldown_min?: number;
  } | null;
  if (!b?.code) return NextResponse.json({ ok: false, error: "قانون مشخص نشده است" }, { status: 400 });
  try {
    setTenantRuleOverride(guard.session.organizationId, {
      code: b.code,
      active: b.active,
      cooldown_min: b.cooldown_min,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof RuleError) return NextResponse.json({ ok: false, error: e.message }, { status: 404 });
    throw e;
  }
}
