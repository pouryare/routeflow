import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { OWNER_ROLES } from "@/lib/roles";
import { AssetError, addAsset, listAssets, updateAsset } from "@/lib/repo/assets";

function failure(e: unknown) {
  if (e instanceof AssetError) return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
  throw e;
}

export async function GET(req: NextRequest) {
  const guard = await requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;
  try {
    return NextResponse.json({ ok: true, assets: await listAssets(guard.session) });
  } catch (e) {
    return failure(e);
  }
}

/** { kind, name, serial? } adds a thing to the register. */
export async function POST(req: NextRequest) {
  const guard = await requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;
  const b = (await req.json().catch(() => null)) as { kind?: unknown; name?: unknown; serial?: unknown } | null;
  try {
    await addAsset(guard.session, { kind: b?.kind, name: b?.name, serial: b?.serial });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}

/** { id, holder?: user id | null, condition?, retire? }. */
export async function PATCH(req: NextRequest) {
  const guard = await requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;
  const b = (await req.json().catch(() => null)) as { id?: unknown; holder?: unknown; condition?: unknown; retire?: unknown } | null;
  if (!Number.isInteger(b?.id)) return NextResponse.json({ ok: false, error: "شناسه نامعتبر است" }, { status: 400 });
  if (b!.holder !== undefined && b!.holder !== null && !Number.isInteger(b!.holder)) return NextResponse.json({ ok: false, error: "همکار نامعتبر است" }, { status: 400 });
  try {
    await updateAsset(guard.session, b!.id as number, { holder: b!.holder as number | null | undefined, condition: b!.condition, retire: b!.retire === true });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
