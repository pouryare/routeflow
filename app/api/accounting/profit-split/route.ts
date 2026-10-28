import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { OWNER_ROLES } from "@/lib/roles";
import { LedgerError } from "@/lib/repo/ledgerCore";
import { postSplitIn, previewSplitIn } from "@/lib/repo/routeAdapters";

const validYear = (y: unknown): y is number => Number.isInteger(y) && (y as number) >= 1300 && (y as number) <= 1600;

/** Preview a year's split. A POST because it first brings commission up to date in the books, which writes. */
export async function POST(req: NextRequest) {
  const guard = await requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;
  const body = (await req.json().catch(() => null)) as { year?: unknown; commit?: unknown; approved_on?: unknown } | null;
  if (!validYear(body?.year)) return NextResponse.json({ ok: false, error: "سال معتبر نیست" }, { status: 400 });
  const organizationId = guard.session.organizationId;
  try {
    if (body?.commit === true) {
      const id = await postSplitIn({
        organizationId, year: body.year, createdBy: guard.session.user.id,
        approvedOn: typeof body.approved_on === "string" ? body.approved_on : null,
      });
      return NextResponse.json({ ok: true, id }, { status: 201 });
    }
    return NextResponse.json({ ok: true, preview: await previewSplitIn(organizationId, body.year, guard.session.user.id) });
  } catch (e) {
    if (e instanceof LedgerError) return NextResponse.json({ ok: false, error: e.message }, { status: 409 });
    throw e;
  }
}
