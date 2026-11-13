import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { OWNER_ROLES } from "@/lib/roles";
import { guardStepUp } from "@/lib/repo/stepUp";
import { LedgerError } from "@/lib/repo/ledgerCore";
import { closeYear, reopenYear } from "@/lib/repo/yearClose";
import { closeChecklist, closePeriod, reopenPeriod, openRange } from "@/lib/repo/periodClose";

const KEY = /^\d{4}-\d{2}$/;

/** A2: what is unfinished in a month, before closing it: ?period=1405-07. */
export async function GET(req: NextRequest) {
  const guard = await requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;
  const period = req.nextUrl.searchParams.get("period") ?? "";
  if (!KEY.test(period)) return NextResponse.json({ ok: false, error: "ماه نامعتبر است" }, { status: 400 });
  return NextResponse.json({ ok: true, checklist: await closeChecklist(guard.session.organizationId, period) });
}

/** A2: { period, action: "close" | "reopen" | "open_range", reason?, fromDay?, toDay? }. Reopening asks for the authenticator code and a reason. */
export async function POST(req: NextRequest) {
  const guard = await requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;
  const raw = (await req.json().catch(() => null)) as { year?: unknown; action?: unknown; reason?: unknown } | null;
  if (raw?.action === "close_year" || raw?.action === "reopen_year") {
    const year = Number(raw.year);
    try {
      if (raw.action === "close_year") await closeYear(guard.session.organizationId, year, guard.session.user.id);
      else {
        const stepUp = await guardStepUp(req, guard.session, "reopen_period");
        if (stepUp) return stepUp;
        await reopenYear(guard.session.organizationId, year, guard.session.user.id, typeof raw.reason === "string" ? raw.reason : "");
      }
    } catch (e) {
      if (e instanceof LedgerError) return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
      throw e;
    }
    return NextResponse.json({ ok: true });
  }
  const body = (await req.json().catch(() => null)) as { period?: unknown; action?: unknown; reason?: unknown; fromDay?: unknown; toDay?: unknown } | null;
  if (typeof body?.period !== "string" || !KEY.test(body.period) || (body.action !== "close" && body.action !== "reopen" && body.action !== "open_range")) {
    return NextResponse.json({ ok: false, error: "درخواست نامعتبر است" }, { status: 400 });
  }
  try {
    if (body.action === "close") await closePeriod(guard.session.organizationId, body.period, guard.session.user.id);
    else if (body.action === "open_range") {
      const stepUp = await guardStepUp(req, guard.session, "reopen_period");
      if (stepUp) return stepUp;
      await openRange(guard.session.organizationId, body.period, Number(body.fromDay), Number(body.toDay), guard.session.user.id, typeof body.reason === "string" ? body.reason : "");
    } else {
      const stepUp = await guardStepUp(req, guard.session, "reopen_period");
      if (stepUp) return stepUp;
      await reopenPeriod(guard.session.organizationId, body.period, guard.session.user.id, typeof body.reason === "string" ? body.reason : "");
    }
  } catch (e) {
    if (e instanceof LedgerError) return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
    throw e;
  }
  return NextResponse.json({ ok: true });
}
