import { NextRequest, NextResponse } from "next/server";
import { isId } from "@/lib/inputChecks";
import { storageOwner, bad } from "@/lib/storage/routeGuard";
import { parseStorageInput } from "@/lib/storage/input";
import { settingsOf, testStorage } from "@/lib/storage/files";
import { removeIfEmpty, startMove } from "@/lib/storage/maintenance";
import { getStorage, listStorages, logStorageEvent, sealStorageSecret, updateStorage } from "@/lib/repo/storages";

/** Edits a storage. A new secret key is a key swap: tested before it replaces the old one (decision 15). */
export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/storages/[id]">) {
  const g = await storageOwner(req, true);
  if (!g.ok) return g.response;
  const { id } = await ctx.params;
  if (!isId(id)) return bad("شناسه نامعتبر است");
  const existing = await getStorage(g.org, Number(id));
  if (!existing || existing.state === "removed") return bad("فضا پیدا نشد", 404);
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return bad("درخواست نامعتبر است");
  const p = parseStorageInput(body, existing, await listStorages(g.org));
  if (!p.ok) return bad(p.error);
  const i = p.input;
  if (i.kind === "s3") {
    // Test what will be saved: the typed secret, or the stored one when none was typed.
    const merged = { ...existing, ...i, secret_enc: i.secret ? sealStorageSecret(i.secret) : existing.secret_enc };
    let settings;
    try {
      settings = settingsOf(merged);
    } catch (e) {
      return bad((e as Error).message, 422);
    }
    const t = await testStorage("s3", settings, i.path_prefix);
    if (!t.ok) return bad(t.reason, 422);
  }
  await updateStorage(g.org, existing.id, i);
  await logStorageEvent(g.org, existing.id, i.secret ? "key_swapped" : "edited", i.secret ? `کلید تازه: …${i.secret.slice(-4)}` : null, g.session.user.id);
  return NextResponse.json({ ok: true });
}

/** Removes a storage (decision 18): at once when it holds no file, otherwise only after moving its
 *  files to `to`; the storage is removed when the move reaches 100%. */
export async function DELETE(req: NextRequest, ctx: RouteContext<"/api/storages/[id]">) {
  const g = await storageOwner(req, true);
  if (!g.ok) return g.response;
  const { id } = await ctx.params;
  if (!isId(id)) return bad("شناسه نامعتبر است");
  const s = await getStorage(g.org, Number(id));
  if (!s || s.state === "removed") return bad("فضا پیدا نشد", 404);
  if (s.state === "moving_out") return bad("فایل‌های این فضا در حال انتقال است");
  if (await removeIfEmpty(g.org, s.id, g.session.user.id)) return NextResponse.json({ ok: true, removed: true });
  const to = Number(req.nextUrl.searchParams.get("to"));
  const target = (await listStorages(g.org)).find((x) => x.id === to && x.state === "active" && x.id !== s.id);
  if (!target) return bad("این فضا فایل دارد؛ اول بگویید فایل‌ها به کدام فضا منتقل شوند", 409);
  const moveId = await startMove(g.org, s.id, target.id, "remove", g.session.user.id);
  return NextResponse.json({ ok: true, removed: false, move_id: moveId });
}
