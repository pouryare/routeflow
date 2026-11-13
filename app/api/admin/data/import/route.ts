import { NextRequest, NextResponse } from "next/server";
import { orgScopeId, requireRole } from "@/lib/session";
import { OWNER_ROLES } from "@/lib/roles";
import { applyPlan, DataIOError, groupsOf, loadExisting, MAX_UPLOAD_BYTES, readTables } from "@/lib/repo/dataIO";
import { planImport } from "@/lib/dataIO/importPlan";
import { guardStepUp } from "@/lib/repo/stepUp";

/** F34 upload. The same file is posted twice: with no `confirm` field it only answers what WOULD change (the preview
 *  the owner reads), with `confirm=1` it saves it. The plan is worked out again from the file each time, so what is
 *  saved is exactly what the preview of that file showed, and nothing the browser says about it is trusted. */
export async function POST(req: NextRequest) {
  const guard = await requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;
  const org = orgScopeId(guard.session);
  if (org === null) return NextResponse.json({ ok: false, error: "ابتدا یک شرکت را انتخاب کنید" }, { status: 400 });

  try {
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) throw new DataIOError("فایلی فرستاده نشد");
    if (file.size > MAX_UPLOAD_BYTES) throw new DataIOError("فایل از ۵ مگابایت بزرگ‌تر است", 413);

    const tables = await readTables(Buffer.from(await file.arrayBuffer()), file.name);
    const plan = planImport(tables, await loadExisting(org));
    if (!plan.kinds.length) throw new DataIOError("برگه‌ای با سرستون‌های مشتریان، کالاها یا قیمت‌ها پیدا نشد؛ فایل خروجی را الگو کنید");
    if (form?.get("confirm") !== "1") return NextResponse.json({ ok: true, plan });

    // Changing prices asks for the owner's second step, as the price screen does.
    if (plan.items.some((i) => i.op?.t === "price.set" && (i.status === "new" || i.status === "changed"))) {
      const stepUp = await guardStepUp(req, guard.session, "price_change");
      if (stepUp) return stepUp;
    }
    const wanted = Number(form?.get("group_id"));
    let groupId: number | null = null;
    if (Number.isInteger(wanted) && wanted > 0) {
      if (!(await groupsOf(org)).some((g) => g.id === wanted)) throw new DataIOError("گروه پیدا نشد", 404);
      groupId = wanted;
    }
    return NextResponse.json({ ok: true, plan, result: await applyPlan(org, guard.session.user.id, plan, groupId) });
  } catch (e) {
    if (e instanceof DataIOError) return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
    throw e;
  }
}
