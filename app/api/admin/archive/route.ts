import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { requireRole, type Guard } from "@/lib/session";
import { OWNER_ROLES } from "@/lib/roles";
import { withDbScope } from "@/lib/database/scope";
import { tehranTodayIso } from "@/lib/jalali";
import { MAX_HOT_MONTHS, MIN_HOT_MONTHS, validHotMonths } from "@/lib/historyArchive";
import { archiveHistory, setArchiveHotMonths } from "@/lib/repo/historyArchive";

/** Old history to the archive twins (db/migrations/1762700000000_history-archive.sql). One cutoff
 *  for the whole server, so both calls are the platform owner's:
 *    PUT  { months }  how many months stay in the everyday tables (3 to 120);
 *    POST             move what is older now. The nightly timer (deploy/routeflow) sends SWEEP_TOKEN. */

function tokenMatches(header: string | null): boolean {
  const secret = process.env.SWEEP_TOKEN;
  if (!secret || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The platform owner, whether looking across every company or acting in one. */
async function platformOwner(req: NextRequest): Promise<Guard> {
  const guard = await requireRole(req, OWNER_ROLES);
  if (guard.ok && !guard.session.hasRole("platform_owner")) {
    return { ok: false, response: NextResponse.json({ ok: false, error: "دسترسی لازم را ندارید" }, { status: 403 }) };
  }
  return guard;
}

export async function PUT(req: NextRequest) {
  const guard = await platformOwner(req);
  if (!guard.ok) return guard.response;
  const body = (await req.json().catch(() => null)) as { months?: unknown } | null;
  const months = Number(body?.months);
  if (!validHotMonths(months)) {
    return NextResponse.json({ ok: false, error: `بین ${MIN_HOT_MONTHS.toLocaleString("fa-IR")} تا ${MAX_HOT_MONTHS.toLocaleString("fa-IR")} ماه بنویسید` }, { status: 400 });
  }
  await withDbScope("system", () => setArchiveHotMonths(months));
  return NextResponse.json({ ok: true });
}

export async function POST(req: NextRequest) {
  if (!tokenMatches(req.headers.get("x-sweep-token"))) {
    const guard = await platformOwner(req);
    if (!guard.ok) return guard.response;
  }
  const moved = await withDbScope("system", () => archiveHistory(tehranTodayIso()));
  return NextResponse.json({ ok: true, moved });
}
