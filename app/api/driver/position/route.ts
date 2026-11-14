import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { parsePosition } from "@/lib/vanPositions";
import { recordPosition } from "@/lib/repo/vanPositions";

/** F6: a delivery driver's phone reports its position { lat, lng, accuracy } while a run is in progress. */
export async function POST(req: NextRequest) {
  const guard = await requireRole(req, ["delivery_driver"]);
  if (!guard.ok) return guard.response;
  const p = parsePosition(await req.json().catch(() => null));
  if (typeof p === "string") return NextResponse.json({ ok: false, error: p }, { status: 400 });
  return (await recordPosition(guard.session, p)) === "saved"
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ ok: false, error: "سرویسی در حال انجام نیست" }, { status: 409 });
}
