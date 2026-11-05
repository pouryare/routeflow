import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { canUpload, NOT_SET_UP } from "@/lib/storage/files";

/** Whether this company can take a photo or receipt right now (decision 6): the upload buttons
 *  are disabled with the reason when it cannot. */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ ok: false, error: "احراز هویت نشده" }, { status: 401 });
  const ok = await canUpload(session.organizationId);
  return NextResponse.json({ ok: true, can_upload: ok, reason: ok ? null : NOT_SET_UP });
}
