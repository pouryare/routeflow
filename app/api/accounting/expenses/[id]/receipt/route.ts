import { NextRequest, NextResponse } from "next/server";
import { isId } from "@/lib/inputChecks";
import crypto from "node:crypto";
import { requireRole } from "@/lib/session";
import { OWNER_ROLES, type Role } from "@/lib/roles";
import { encodeImage, PHOTO_MAX_EDGE } from "@/lib/imagePipeline";
import { discardFile, readFile, saveFile, storageRefusal, trashFile } from "@/lib/storage/files";
import { isOwnExpense, receiptFor, saveReceipt } from "@/lib/repo/expenseReceipts";

/* The same people who may record an expense may attach and read its receipt. */
const ROLES: Role[] = [...OWNER_ROLES, "group_manager"];
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export async function POST(req: NextRequest, ctx: RouteContext<"/api/accounting/expenses/[id]/receipt">) {
  const guard = await requireRole(req, ROLES);
  if (!guard.ok) return guard.response;
  const journalIdRaw = (await ctx.params).id;
  if (!isId(journalIdRaw)) return NextResponse.json({ ok: false, error: "شناسه نامعتبر است" }, { status: 400 });
  const journalId = Number(journalIdRaw);
  if (!Number.isInteger(journalId)) return NextResponse.json({ ok: false, error: "شناسه نامعتبر است" }, { status: 400 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || !(file instanceof File)) return NextResponse.json({ ok: false, error: "فایلی انتخاب نشده است" }, { status: 400 });
  if (!file.type.startsWith("image/")) return NextResponse.json({ ok: false, error: "فقط فایل تصویر پذیرفته می‌شود" }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES) return NextResponse.json({ ok: false, error: "حجم فایل نباید بیش از ۲۰ مگابایت باشد" }, { status: 413 });
  // Own expense or 404, before any file is written.
  if (!await isOwnExpense(guard.session.organizationId, journalId)) {
    return NextResponse.json({ ok: false, error: "هزینه پیدا نشد" }, { status: 404 });
  }

  let encoded;
  try {
    encoded = await encodeImage(Buffer.from(await file.arrayBuffer()), PHOTO_MAX_EDGE);
  } catch {
    return NextResponse.json({ ok: false, error: "فایل تصویر قابل پردازش نیست" }, { status: 422 });
  }
  const stem = crypto.randomUUID();
  try {
    await saveFile(guard.session.organizationId, "receipt", stem, [
      { ext: "avif", body: encoded.avif, contentType: "image/avif" },
      { ext: "webp", body: encoded.webp, contentType: "image/webp" },
    ]);
  } catch (e) {
    const r = storageRefusal(e);
    if (r) return NextResponse.json({ ok: false, error: r.error }, { status: r.status });
    throw e;
  }
  let replaced: string | null;
  try {
    ({ replaced } = await saveReceipt(guard.session.organizationId, journalId, guard.session.user.id, stem));
  } catch {
    await discardFile(stem);
    return NextResponse.json({ ok: false, error: "هزینه پیدا نشد" }, { status: 404 });
  }
  // The replaced receipt goes to the 30-day trash rather than straight out of the bucket.
  await trashFile(replaced, "receipt", guard.session.user.id, { table: "expense_receipts", journal_id: journalId });
  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function GET(req: NextRequest, ctx: RouteContext<"/api/accounting/expenses/[id]/receipt">) {
  const guard = await requireRole(req, ROLES);
  if (!guard.ok) return guard.response;
  const journalIdRaw = (await ctx.params).id;
  if (!isId(journalIdRaw)) return NextResponse.json({ ok: false, error: "شناسه نامعتبر است" }, { status: 400 });
  const journalId = Number(journalIdRaw);
  const r = Number.isInteger(journalId) ? await receiptFor(guard.session.organizationId, journalId) : null;
  if (!r) return NextResponse.json({ ok: false, error: "رسیدی ثبت نشده است" }, { status: 404 });
  const format = req.nextUrl.searchParams.get("format") === "avif" ? "avif" : "webp";
  const bytes = await readFile(r.file_stem, format, "receipt");
  if (!bytes) return NextResponse.json({ ok: false, error: "فایل رسید پیدا نشد" }, { status: 404 });
  return new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": `image/${format}`, "Cache-Control": "private, max-age=3600" } });
}
