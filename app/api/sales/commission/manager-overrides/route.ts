import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { setManagerOverride } from "@/lib/managerCommissionLedger";

/** Owner only. A مدیر گروه's incentive is set by the owner, the same "payroll is not
 *  territory" rule /api/sales/commission/rates already enforces -- running a group is
 *  not the authority to decide what running it pays. */
export async function POST(req: NextRequest) {
  const guard = requireRole(req, ["owner"]);
  if (!guard.ok) return guard.response;

  const body = (await req.json().catch(() => null)) as {
    manager_user_id?: unknown;
    override_pct?: unknown;
    valid_from?: unknown;
  } | null;

  const pct = Number(body?.override_pct);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
    return NextResponse.json(
      { ok: false, error: "درصد باید عددی بین ۰ و ۱۰۰ باشد" },
      { status: 400 }
    );
  }

  const validFrom = typeof body?.valid_from === "string" ? body.valid_from : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(validFrom) || Number.isNaN(Date.parse(validFrom))) {
    return NextResponse.json({ ok: false, error: "تاریخ شروع نرخ معتبر نیست" }, { status: 400 });
  }

  const db = getDb();
  const rawId = body?.manager_user_id;
  const managerId = rawId === undefined || rawId === null ? null : Number(rawId);

  if (managerId !== null) {
    const person = db.prepare("SELECT id FROM users WHERE id = ? AND role = 'group_manager'").get(managerId);
    if (!person) {
      return NextResponse.json({ ok: false, error: "این حساب مدیر گروه نیست" }, { status: 400 });
    }
  }

  const id = setManagerOverride(db, {
    manager_user_id: managerId,
    override_pct: pct,
    valid_from: validFrom,
    created_by: guard.session.user.id,
  });

  return NextResponse.json({ ok: true, id }, { status: 201 });
}
