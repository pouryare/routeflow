import { NextRequest, NextResponse } from "next/server";
import { orgScopeId, requireRole } from "@/lib/session";
import { OWNER_ROLES } from "@/lib/roles";
import { DataIOError, planFromUpload } from "@/lib/repo/dataIO";

/** F34, step one of the upload: answers what the file WOULD change and saves nothing (a POST only because a file is
 *  sent). It is its own route so the screen does not announce «انجام شد» for a request that did not save anything. */
export async function POST(req: NextRequest) {
  const guard = await requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;
  const org = orgScopeId(guard.session);
  if (org === null) return NextResponse.json({ ok: false, error: "ابتدا یک شرکت را انتخاب کنید" }, { status: 400 });
  try {
    const file = (await req.formData().catch(() => null))?.get("file");
    if (!(file instanceof File)) throw new DataIOError("فایلی فرستاده نشد");
    return NextResponse.json({ ok: true, plan: await planFromUpload(org, file) });
  } catch (e) {
    if (e instanceof DataIOError) return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
    throw e;
  }
}
