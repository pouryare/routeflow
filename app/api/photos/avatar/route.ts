import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import { encodeImage, AVATAR_MAX_EDGE } from "@/lib/imagePipeline";
import { ensureAvatarDir, avatarPaths, removeAvatarFiles } from "@/lib/avatarStore";
import { requireRole } from "@/lib/session";
import { getDb } from "@/lib/db";
import { userInOrg, setAvatar, readAvatarStem } from "@/lib/repo/avatars";
import { OWNER_ROLES } from "@/lib/roles";

/** 8MB. A phone portrait is 2–4MB; a 20MB phone panorama is a mistake, not a portrait. */
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/** Owner-only, by decision: nobody sets their own face. The stated reason is that staff
 *  would upload inappropriate images, and the answer to that is a gate on the write, not a
 *  moderation queue nobody has staffed. `OWNER_ROLES` is the same gate every other
 *  administrative write in this app uses. */
export async function POST(req: NextRequest) {
  const guard = requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;

  const formData = await req.formData().catch(() => null);
  const file = formData?.get("file");
  const userId = Number(formData?.get("user_id"));

  if (!file || !(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "فایلی انتخاب نشده است" }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ ok: false, error: "فقط فایل تصویر پذیرفته می‌شود" }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { ok: false, error: "حجم فایل نباید بیش از ۸ مگابایت باشد" },
      { status: 413 },
    );
  }
  if (!Number.isInteger(userId)) {
    return NextResponse.json({ ok: false, error: "شناسه کاربر نامعتبر است" }, { status: 400 });
  }

  // Tenant-scoped, same rule as the admin PATCH: an owner administers their own
  // organisation's staff and no one else's. A cross-tenant id reads as "not found".
  const db = getDb();
  if (!userInOrg(db, userId, guard.session.organizationId)) {
    return NextResponse.json({ ok: false, error: "کاربر پیدا نشد" }, { status: 404 });
  }

  const input = Buffer.from(await file.arrayBuffer());
  let encoded;
  try {
    encoded = await encodeImage(input, AVATAR_MAX_EDGE);
  } catch {
    // The declared Content-Type is the client's word, not a fact. A .txt renamed .png
    // clears the `image/` check above and only fails here, so this is the real
    // "not actually an image" door — 422, because the request itself was well-formed.
    return NextResponse.json({ ok: false, error: "فایل تصویر قابل پردازش نیست" }, { status: 422 });
  }

  // A random stem, never the user id and never the username: the filename must not be
  // guessable from the row, and a username is often someone's name in Latin letters.
  const stem = crypto.randomUUID();
  await ensureAvatarDir();
  await Promise.all([
    fs.writeFile(avatarPaths(stem, "avif"), encoded.avif),
    fs.writeFile(avatarPaths(stem, "webp"), encoded.webp),
  ]);

  // The row is written here rather than by a second client PATCH: one request, one outcome,
  // and no window in which the bytes exist but nothing points at them.
  //
  // Read the PREVIOUS stem first: after setAvatar the old one is unrecoverable from the row,
  // and it is the only record that those two files are now garbage. Doing it in this order
  // also means a failure above leaves the old photograph still serving.
  const previousStem = readAvatarStem(db, userId);
  setAvatar(db, userId, `/api/users/${userId}/avatar`, stem);

  // Only now that the row points at the new files is it safe to drop the old ones. A
  // re-upload used to strand two files per upload, forever. Failures here are swallowed by
  // removeAvatarFiles: a stranded file is untidy, and must not fail a good upload.
  await removeAvatarFiles(previousStem);

  return NextResponse.json({ ok: true, avatar_url: `/api/users/${userId}/avatar` });
}