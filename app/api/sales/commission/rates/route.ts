import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { setRate } from "@/lib/commissionLedger";
import { isToman } from "@/lib/money";

/** Owner only, including against a manager.
 *
 *  A commission rate is payroll rather than territory: a manager runs a group's sales,
 *  which is not the same authority as deciding what the group is paid. There is no
 *  update path either -- changing a rate is a new row, so last month's statement cannot
 *  be restated by editing a cell.
 */
export async function POST(req: NextRequest) {
  const guard = requireRole(req, ["owner"]);
  if (!guard.ok) return guard.response;

  const body = (await req.json().catch(() => null)) as {
    salesperson_user_id?: unknown;
    rate_per_kg_toman?: unknown;
    urgent_rate_per_kg_toman?: unknown;
    valid_from?: unknown;
  } | null;

  const rate = Number(body?.rate_per_kg_toman);
  if (!isToman(rate) || rate < 0) {
    return NextResponse.json(
      { ok: false, error: "نرخ باید عدد صحیح تومان و مثبت باشد" },
      { status: 400 }
    );
  }

  const urgentRaw = body?.urgent_rate_per_kg_toman;
  const urgent = urgentRaw === undefined || urgentRaw === null ? null : Number(urgentRaw);
  if (urgent !== null && (!isToman(urgent) || urgent < 0)) {
    return NextResponse.json(
      { ok: false, error: "نرخ فوری باید عدد صحیح تومان و مثبت باشد" },
      { status: 400 }
    );
  }

  const validFrom = typeof body?.valid_from === "string" ? body.valid_from : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(validFrom) || Number.isNaN(Date.parse(validFrom))) {
    return NextResponse.json({ ok: false, error: "تاریخ شروع نرخ معتبر نیست" }, { status: 400 });
  }

  const db = getDb();
  const personId =
    body?.salesperson_user_id === undefined || body?.salesperson_user_id === null
      ? null
      : Number(body.salesperson_user_id);

  if (personId !== null) {
    // A rate attached to a driver or a manager would never be read by anything, so it
    // is a silent no-op rather than a policy -- better refused at the door.
    const person = db
      .prepare("SELECT id FROM users WHERE id = ? AND role = 'salesperson'")
      .get(personId);
    if (!person) {
      return NextResponse.json({ ok: false, error: "این حساب فروشنده نیست" }, { status: 400 });
    }
  }

  const id = setRate(db, {
    salesperson_user_id: personId,
    rate_per_kg_toman: rate,
    urgent_rate_per_kg_toman: urgent,
    valid_from: validFrom,
    created_by: guard.session.user.id,
  });

  return NextResponse.json({ ok: true, id }, { status: 201 });
}
