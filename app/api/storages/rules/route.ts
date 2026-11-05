import { NextRequest, NextResponse } from "next/server";
import { storageOwner, bad } from "@/lib/storage/routeGuard";
import { FILE_KINDS } from "@/lib/storage/driver";
import { startMove } from "@/lib/storage/maintenance";
import { listRules, listStorages, logStorageEvent, replaceRules, type RuleRow } from "@/lib/repo/storages";

/** Replaces the rules: one default ('*') and any per-kind ones, each with an optional mirror
 *  (decision 3). `move_existing` with a new default moves the files on the old default (decision 9). */
export async function PUT(req: NextRequest) {
  const g = await storageOwner(req, true);
  if (!g.ok) return g.response;
  const body = (await req.json().catch(() => null)) as { rules?: unknown; move_existing?: unknown } | null;
  if (!body || !Array.isArray(body.rules) || body.rules.length > FILE_KINDS.length + 1) return bad("قاعده‌ها نامعتبر است");
  const active = new Set((await listStorages(g.org)).filter((s) => s.state === "active").map((s) => s.id));
  const seen = new Set<string>();
  const rules: RuleRow[] = [];
  for (const raw of body.rules as Record<string, unknown>[]) {
    const kind = raw?.file_kind;
    if (kind !== "*" && !(FILE_KINDS as readonly unknown[]).includes(kind)) return bad("نوع فایل نامعتبر است");
    if (seen.has(kind as string)) return bad("هر نوع فایل یک قاعده دارد");
    seen.add(kind as string);
    const storage = Number(raw.storage_id);
    const mirror = raw.mirror_storage_id == null || raw.mirror_storage_id === "" ? null : Number(raw.mirror_storage_id);
    if (!active.has(storage)) return bad("فضای انتخاب‌شده در دسترس نیست");
    if (mirror !== null && (!active.has(mirror) || mirror === storage)) return bad("فضای کپی باید فضای دیگری باشد");
    rules.push({ file_kind: kind as RuleRow["file_kind"], storage_id: storage, mirror_storage_id: mirror });
  }
  if (!seen.has("*")) return bad("یک فضای پیش‌فرض لازم است");
  const before = (await listRules(g.org)).find((r) => r.file_kind === "*")?.storage_id ?? null;
  await replaceRules(g.org, rules);
  await logStorageEvent(g.org, null, "rules_changed", null, g.session.user.id);
  const after = rules.find((r) => r.file_kind === "*")!.storage_id;
  let moveId: number | null = null;
  if (body.move_existing === true && before !== null && before !== after) {
    moveId = await startMove(g.org, before, after, "default", g.session.user.id);
  }
  return NextResponse.json({ ok: true, move_id: moveId });
}
