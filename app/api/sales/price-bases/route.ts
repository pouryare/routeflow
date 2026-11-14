import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { OWNER_ROLES } from "@/lib/roles";
import { guardStepUp } from "@/lib/repo/stepUp";
import { addLink, applyMove, createBase, listBases, previewMove, removeLink } from "@/lib/repo/priceBases";

const bad = (error: string) => NextResponse.json({ ok: false, error }, { status: 400 });
const int = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) ? v : null);

export async function GET(req: NextRequest) {
  const guard = await requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;
  return NextResponse.json({ ok: true, bases: await listBases(guard.session.organizationId) });
}

/** D14: { action: "create" | "link" | "unlink" | "preview" | "apply", ... }. Only «apply» changes a price, so only it asks for the step-up code. */
export async function POST(req: NextRequest) {
  const guard = await requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;
  const org = guard.session.organizationId;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return bad("درخواست نامعتبر است");
  const done = (refused: string | null) => (refused ? bad(refused) : NextResponse.json({ ok: true }));
  switch (b.action) {
    case "create": {
      const value = int(b.value);
      return typeof b.name === "string" && value !== null ? done(await createBase(org, b.name, value)) : bad("درخواست نامعتبر است");
    }
    case "link": {
      const baseId = int(b.base_id), productId = int(b.product_id), factor = typeof b.factor === "number" ? b.factor : NaN;
      const packagingId = b.packaging_id === null || b.packaging_id === undefined ? null : int(b.packaging_id);
      if (baseId === null || productId === null || (b.packaging_id != null && packagingId === null)) return bad("درخواست نامعتبر است");
      return done(await addLink(org, baseId, productId, packagingId, factor));
    }
    case "unlink": {
      const id = int(b.link_id);
      if (id === null) return bad("درخواست نامعتبر است");
      await removeLink(org, id);
      return NextResponse.json({ ok: true });
    }
    case "preview": {
      const baseId = int(b.base_id), value = int(b.value);
      if (baseId === null || value === null) return bad("درخواست نامعتبر است");
      const rows = await previewMove(org, baseId, value);
      return typeof rows === "string" ? bad(rows) : NextResponse.json({ ok: true, rows });
    }
    case "apply": {
      const stepUp = await guardStepUp(req, guard.session, "price_change");
      if (stepUp) return stepUp;
      const baseId = int(b.base_id), value = int(b.value);
      if (baseId === null || value === null || typeof b.valid_from !== "string") return bad("درخواست نامعتبر است");
      const r = await applyMove(org, baseId, value, b.valid_from, guard.session.user.id);
      return typeof r === "string" ? bad(r) : NextResponse.json({ ok: true, changed: r });
    }
    default:
      return bad("درخواست نامعتبر است");
  }
}
