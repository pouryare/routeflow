import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { OWNER_ROLES, MANAGE_ROLES } from "@/lib/roles";
import { exportFile, getExportJob } from "@/lib/repo/exportJobs";

/** E7: progress of a background export, or (`?file=1`) the finished file. Only whoever asked, or an owner. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireRole(req, [...MANAGE_ROLES, "phone_sales"]);
  if (!guard.ok) return guard.response;
  const id = Number((await ctx.params).id);
  const org = guard.session.organizationId;
  const job = Number.isInteger(id) ? await getExportJob(org, id) : undefined;
  if (!job || (job.user_id !== guard.session.user.id && !OWNER_ROLES.includes(guard.session.role))) {
    return NextResponse.json({ ok: false, error: "خروجی پیدا نشد یا مهلتش تمام شده است" }, { status: 404 });
  }
  if (req.nextUrl.searchParams.get("file") === "1") {
    const f = await exportFile(org, id);
    if (!f) return NextResponse.json({ ok: false, error: "فایل هنوز آماده نیست" }, { status: 409 });
    return new Response(new Uint8Array(f.file), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${f.filename}"`,
        "Cache-Control": "no-store",
      },
    });
  }
  return NextResponse.json({ ok: true, status: job.status, progress: job.progress, total: job.total, error: job.error });
}
