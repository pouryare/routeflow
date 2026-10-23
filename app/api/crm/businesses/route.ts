import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { CRM_VIEWS, listBusinesses, viewCounts, type CrmView } from "@/lib/repo/crm/businesses";
import { createLead } from "@/lib/repo/crm/write";
import { CRM_ROLES, crmErrorResponse } from "@/lib/repo/crm/http";
import { isOneOf } from "@/lib/crm/vocab";

export async function GET(req: NextRequest) {
  const guard = await requireRole(req, [...CRM_ROLES]);
  if (!guard.ok) return guard.response;
  const sp = req.nextUrl.searchParams;
  const view: CrmView = isOneOf(CRM_VIEWS, sp.get("view")) ? (sp.get("view") as CrmView) : "today";
  const { rows, nextOffset } = await listBusinesses(guard.session, { view, q: sp.get("q") ?? undefined, offset: Number(sp.get("offset") ?? 0) || 0 });
  return NextResponse.json({ ok: true, rows, counts: await viewCounts(guard.session), next_offset: nextOffset });
}

export async function POST(req: NextRequest) {
  const guard = await requireRole(req, [...CRM_ROLES]);
  if (!guard.ok) return guard.response;
  const b = (await req.json().catch(() => null)) as { answers?: unknown; client_uuid?: string } | null;
  try {
    const r = await createLead(guard.session, { answers: (b?.answers ?? []) as never, clientUuid: b?.client_uuid ?? null });
    return NextResponse.json({ ok: true, id: r.id, next_task_id: r.nextTaskId }, { status: 201 });
  } catch (e) {
    return crmErrorResponse(e);
  }
}
