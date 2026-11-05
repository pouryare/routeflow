import { NextRequest, NextResponse } from "next/server";
import { storageOwner, bad } from "@/lib/storage/routeGuard";
import { parseStorageInput } from "@/lib/storage/input";
import { testStorage } from "@/lib/storage/files";
import { devStorageAllowed } from "@/lib/storage/local";
import { ARVAN_PRESETS } from "@/lib/storage/s3";
import { insertStorage, listEvents, listMoves, listRules, listStorages, logStorageEvent, publicStorage } from "@/lib/repo/storages";

/** The storage page's data: storages (never their secret), rules, running moves and the log. */
export async function GET(req: NextRequest) {
  const g = await storageOwner(req);
  if (!g.ok) return g.response;
  const [storages, rules, moves, events] = await Promise.all([listStorages(g.org), listRules(g.org), listMoves(g.org), listEvents(g.org, 50)]);
  return NextResponse.json({
    ok: true,
    storages: storages.map(publicStorage),
    rules,
    moves,
    events,
    presets: ARVAN_PRESETS,
    dev_disk: devStorageAllowed(),
  });
}

/** Adds a storage: checked, tested (write, read, delete, not public), then saved (decisions 4 and 7). */
export async function POST(req: NextRequest) {
  const g = await storageOwner(req, true);
  if (!g.ok) return g.response;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return bad("درخواست نامعتبر است");
  const others = await listStorages(g.org);
  if (others.length >= 20) return bad("هر شرکت حداکثر ۲۰ فضای ذخیره‌سازی دارد");
  const p = parseStorageInput(body, null, others);
  if (!p.ok) return bad(p.error);
  const i = p.input;
  const t = await testStorage(
    i.kind,
    i.kind === "s3" ? { endpoint: i.endpoint!, region: i.region!, bucket: i.bucket!, accessKeyId: i.access_key_id!, secretAccessKey: i.secret! } : null,
    i.path_prefix,
  );
  if (!t.ok) return bad(t.reason, 422);
  const id = await insertStorage(g.org, i, g.session.user.id);
  await logStorageEvent(g.org, id, "added", i.kind === "s3" ? `${i.endpoint} / ${i.bucket}` : "دیسک سرور", g.session.user.id);
  return NextResponse.json({ ok: true, id }, { status: 201 });
}
