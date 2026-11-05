import { NextRequest, NextResponse } from "next/server";
import { isId } from "@/lib/inputChecks";
import { getDb } from "@/lib/db";
import { canReachEntity } from "@/lib/session";
import { storageOwner, bad } from "@/lib/storage/routeGuard";
import { readFile } from "@/lib/storage/files";
import { logStorageEvent, trashedFile, untrash } from "@/lib/repo/storages";

/** The picture of a file in the trash, so the owner can see what they would put back. */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/storages/trash/[id]">) {
  const g = await storageOwner(req);
  if (!g.ok) return g.response;
  const { id } = await ctx.params;
  if (!isId(id)) return bad("شناسه نامعتبر است");
  const f = await trashedFile(g.org, Number(id));
  if (!f || !f.variants.split(",").includes("webp")) return bad("فایل پیدا نشد", 404);
  const bytes = await readFile(f.stem, "webp", f.file_kind);
  if (!bytes) return bad("فایل پیدا نشد", 404);
  return new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": "image/webp", "Cache-Control": "private, no-store" } });
}

/** Puts a deleted photo back where it was. */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/storages/trash/[id]">) {
  const g = await storageOwner(req);
  if (!g.ok) return g.response;
  const { id } = await ctx.params;
  if (!isId(id)) return bad("شناسه نامعتبر است");
  const f = await trashedFile(g.org, Number(id));
  if (!f) return bad("فایل پیدا نشد", 404);
  const ref = f.trash_ref ? (JSON.parse(f.trash_ref) as Record<string, unknown>) : null;
  if (ref?.table !== "photos") return bad("این فایل جایگزین شده و فقط دیدنی است", 409);
  const entityType = ref.entity_type as "customer" | "district";
  const entityId = Number(ref.entity_id);
  if (!await canReachEntity(g.session, entityType, entityId)) return bad("صاحب این عکس دیگر پیدا نمی‌شود", 409);
  const now = new Date().toISOString();
  await getDb()
    .prepare("INSERT INTO photos (entity_type, entity_id, file_stem, caption, taken_at, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(entityType, entityId, f.stem, (ref.caption as string | null) ?? null, (ref.taken_at as string) ?? now, now);
  await untrash(g.org, f.id);
  await logStorageEvent(g.org, f.storage_id, "restored", `${f.file_kind} ${f.stem}`, g.session.user.id);
  return NextResponse.json({ ok: true });
}
