import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { savePlan, listPlans, deletePlan } from "@/lib/repo/commissionTiers";
import {
  validatePlan,
  type Plan,
  type PlanMode,
  type RateType,
  type CommissionMetric,
} from "@/lib/commission/tiers";
import { OWNER_ROLES } from "@/lib/roles";

/** Owner only, including against a manager — the same gate as
 *  `app/api/sales/commission/rates/route.ts`, deliberately.
 *
 *  A commission plan is payroll rather than territory: a manager runs a group's sales, which
 *  is not the same authority as deciding what the group is paid. Matching the rates route's
 *  gate rather than inventing one is the point — a second authorisation style in the same
 *  feature ends up stricter than intended in one path and looser in another.
 *
 *  There is no update path either: `savePlan` REPLACES the tiers for a start date, so last
 *  month's statement cannot be restated by editing a cell.
 */

const MODES: PlanMode[] = ["marginal", "accelerator", "cliff"];
const METRICS: CommissionMetric[] = ["kg", "volume_m3", "revenue_toman", "margin_toman", "orders"];
const RATE_TYPES: RateType[] = ["flat", "pct"];

/** Shape-checked before `validatePlan` sees it.
 *
 *  `validatePlan` is arithmetic: it knows about bounds and gaps. It does not know that
 *  `mode: "cliffy"` is not a mode, and a plan reaching it untyped would either throw an
 *  unhelpful TypeError or — worse — pass with an unrecognised mode that quietly fell through
 *  to the default. A bad shape is the caller's 422, with a message it can show. */
function readPlan(raw: unknown): Plan | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  if (!MODES.includes(p.mode as PlanMode)) return null;
  if (!METRICS.includes(p.metric as CommissionMetric)) return null;
  if (!Array.isArray(p.tiers)) return null;

  const tiers = [];
  for (const t of p.tiers as unknown[]) {
    if (!t || typeof t !== "object") return null;
    const x = t as Record<string, unknown>;
    const from = Number(x.from_value);
    const rate = Number(x.rate_value);
    if (!Number.isFinite(from) || !Number.isFinite(rate)) return null;
    if (!RATE_TYPES.includes(x.rate_type as RateType)) return null;
    // `to_value` null means open-ended; anything else must be a real number, so a stray
    // string or an object cannot become a bound.
    const toRaw = x.to_value;
    const to =
      toRaw === null || toRaw === undefined
        ? null
        : Number(toRaw);
    if (to !== null && !Number.isFinite(to)) return null;
    tiers.push({ from_value: from, to_value: to, rate_type: x.rate_type as RateType, rate_value: rate });
  }
  return { mode: p.mode as PlanMode, metric: p.metric as CommissionMetric, tiers };
}

const isIsoDate = (s: unknown): s is string =>
  typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

export async function GET(req: NextRequest) {
  const guard = requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;
  return NextResponse.json({ ok: true, plans: listPlans(guard.session.organizationId) });
}

export async function POST(req: NextRequest) {
  const guard = requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const validFrom = body?.valid_from;
  if (!isIsoDate(validFrom)) {
    return NextResponse.json({ ok: false, error: "تاریخ شروع نامعتبر است" }, { status: 400 });
  }

  const rawId = body?.salesperson_user_id;
  const personId = rawId === undefined || rawId === null ? null : Number(rawId);
  if (personId !== null && !Number.isInteger(personId)) {
    return NextResponse.json({ ok: false, error: "شناسه نامعتبر است" }, { status: 400 });
  }

  // Tenant-scoped, same as the rates route: an owner administers their own organisation's
  // staff. A cross-tenant id reads as "not found", which is also the more honest answer —
  // from this side of the wall that person does not exist at all.
  if (personId !== null) {
    const person = getDb()
      .prepare("SELECT id FROM users WHERE id = ? AND organization_id = ?")
      .get(personId, guard.session.organizationId);
    if (!person) {
      return NextResponse.json({ ok: false, error: "کاربر پیدا نشد" }, { status: 404 });
    }
  }

  const plan = readPlan(body?.plan);
  if (!plan) {
    return NextResponse.json({ ok: false, error: "ساختار پلن نامعتبر است" }, { status: 422 });
  }
  // 422, not 400: the request was well-formed and the CONTENT is unsound. validatePlan's own
  // Persian message goes back verbatim, because it is the one an admin can act on.
  const problem = validatePlan(plan);
  if (problem) {
    return NextResponse.json({ ok: false, error: problem }, { status: 422 });
  }

  savePlan({
    salesperson_user_id: personId,
    organization_id: guard.session.organizationId,
    plan,
    valid_from: validFrom,
    created_by: guard.session.user.id,
  });
  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const guard = requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;

  const q = new URL(req.url).searchParams;
  const from = q.get("from");
  if (!isIsoDate(from)) {
    return NextResponse.json({ ok: false, error: "تاریخ شروع نامعتبر است" }, { status: 400 });
  }
  const rawId = q.get("salesperson_user_id");
  const personId = rawId === null || rawId === "" ? null : Number(rawId);
  if (personId !== null && !Number.isInteger(personId)) {
    return NextResponse.json({ ok: false, error: "شناسه نامعتبر است" }, { status: 400 });
  }

  deletePlan(guard.session.organizationId, personId, from);
  return NextResponse.json({ ok: true });
}