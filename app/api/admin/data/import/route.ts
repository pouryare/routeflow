import { NextRequest, NextResponse } from "next/server";
import { orgScopeId, requireRole } from "@/lib/session";
import { OWNER_ROLES } from "@/lib/roles";
import { applyPlan, DataIOError, groupsOf, planFromUpload } from "@/lib/repo/dataIO";
import { guardStepUp } from "@/lib/repo/stepUp";

/** F34, step two of the upload: the owner confirmed. The same file is posted again and its plan is worked out again
 *  here, so what is saved is exactly what the preview of that file showed and nothing the browser says about it is
 *  trusted. Everything is saved in one transaction or nothing is. */
export async function POST(req: NextRequest) {
  const guard = await requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;
  const org = orgScopeId(guard.session);
  if (org === null) return NextResponse.json({ ok: false, error: "ابتدا یک شرکت را انتخاب کنید" }, { status: 400 });

  try {
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) throw new DataIOError("فایلی فرستاده نشد");
    const plan = await planFromUpload(org, file);

    // Changing prices asks for the owner's second step, as the price screen does.
    if (plan.items.some((i) => i.op?.t === "price.set" && (i.status === "new" || i.status === "changed"))) {
      const stepUp = await guardStepUp(req, guard.session, "price_change");
      if (stepUp) return stepUp;
    }
    // Overwriting what is already there (a changed customer or product) asks too (UIB-A2).
    if (plan.items.some((i) => i.status === "changed" && i.op)) {
      const stepUp = await guardStepUp(req, guard.session, "import_overwrite");
      if (stepUp) return stepUp;
    }
    const wanted = Number(form?.get("group_id"));
    let groupId: number | null = null;
    if (Number.isInteger(wanted) && wanted > 0) {
      if (!(await groupsOf(org)).some((g) => g.id === wanted)) throw new DataIOError("گروه پیدا نشد", 404);
      groupId = wanted;
    }
    return NextResponse.json({ ok: true, result: await applyPlan(org, guard.session.user.id, plan, groupId) });
  } catch (e) {
    if (e instanceof DataIOError) return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
    throw e;
  }
}
