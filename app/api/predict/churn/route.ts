import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { churnBoard, scoreChurn } from "@/lib/repo/churn";
import { MANAGE_ROLES } from "@/lib/roles";

export const dynamic = "force-dynamic";

const BANDS = ["low", "watch", "high"] as const;

/** `?id=` → one customer's live score; `?band=` → that slice of the board; else the
 *  whole board, highest probability first. Manager tool. */
export async function GET(req: NextRequest) {
  const guard = requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;

  const sp = req.nextUrl.searchParams;
  const id = sp.get("id");
  if (id) {
    return NextResponse.json({
      ok: true,
      id: Number(id),
      score: scoreChurn(guard.session.organizationId, Number(id)),
    });
  }
  const band = sp.get("band");
  const filter = band && (BANDS as readonly string[]).includes(band) ? (band as (typeof BANDS)[number]) : undefined;
  return NextResponse.json({ ok: true, rows: churnBoard(guard.session.organizationId, filter) });
}
