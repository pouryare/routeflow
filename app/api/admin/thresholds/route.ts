import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { OWNER_ROLES } from "@/lib/roles";
import { setThresholds } from "@/lib/repo/thresholds";
import { THRESHOLDS, type Thresholds } from "@/lib/thresholds";

/** The owner's numbers for «مشتری ساکت», «سفارش گیرکرده» and the like (D30). PUT { values: {key: number} }, a
 *  full set; the change is logged by the audit trigger on organizations. */
export async function PUT(req: NextRequest) {
  const guard = await requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;
  const body = (await req.json().catch(() => null)) as { values?: Record<string, unknown> } | null;
  const v = Object.fromEntries(THRESHOLDS.map((t) => [t.key, Number(body?.values?.[t.key])])) as Thresholds;
  const problem = await setThresholds(guard.session.organizationId, v);
  if (problem) return NextResponse.json({ ok: false, error: problem }, { status: 400 });
  return NextResponse.json({ ok: true });
}
