import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { resolveMapsLink } from "@/lib/resolveMapsLink";
import { placeNameFromUrl } from "@/lib/crm/linkName";
import { CRM_ROLES } from "@/lib/repo/crm/http";

export async function POST(req: NextRequest) {
  const guard = await requireRole(req, [...CRM_ROLES]);
  if (!guard.ok) return guard.response;
  const b = (await req.json().catch(() => null)) as { url?: string } | null;
  const url = b?.url?.trim() ?? "";
  if (!/^https?:\/\//.test(url)) return NextResponse.json({ ok: false, error: "لینک معتبر نیست" }, { status: 400 });
  const r = await resolveMapsLink(url, "");
  return NextResponse.json({
    ok: true,
    link: { name: placeNameFromUrl(r.resolvedUrl) ?? placeNameFromUrl(url), lat: r.lat, lng: r.lng, address: r.address, maps_url: url },
  });
}
