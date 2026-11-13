import { compressedJson } from "@/lib/httpCache";
import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { rulesFor, setTenantRuleOverride, RuleError } from "@/lib/repo/rules";
import { MANAGE_ROLES, OWNER_ROLES } from "@/lib/roles";

export async function GET(req: NextRequest) {
  const guard = await requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;
  return compressedJson(req, { ok: true, rules: await rulesFor(guard.session.organizationId) });
}

/** F130: switch a rule on or off, or change its waiting time. A rule reaches into other people's task lists, so only an owner. */
export async function PATCH(req: NextRequest) {
  const guard = await requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;
  const b = (await req.json().catch(() => null)) as {
    code?: string;
    active?: boolean;
    cooldown_min?: number;
    daily_budget?: number | null;
  } | null;
  const c = b?.cooldown_min;
  if (c !== undefined && !(Number.isInteger(c) && c >= 1 && c <= 43200)) return NextResponse.json({ ok: false, error: "زمان انتظار نامعتبر است" }, { status: 400 });
  const d = b?.daily_budget;
  if (d !== undefined && d !== null && !(Number.isInteger(d) && d >= 1 && d <= 100000)) return NextResponse.json({ ok: false, error: "سقف روزانه نامعتبر است" }, { status: 400 });
  if (!b?.code) return NextResponse.json({ ok: false, error: "قانون مشخص نشده است" }, { status: 400 });
  try {
    await setTenantRuleOverride(guard.session.organizationId, {
      code: b.code,
      active: b.active,
      cooldown_min: b.cooldown_min,
      daily_budget: b.daily_budget,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof RuleError) return NextResponse.json({ ok: false, error: e.message }, { status: 404 });
    throw e;
  }
}
