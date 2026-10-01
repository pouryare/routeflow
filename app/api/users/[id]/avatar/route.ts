import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { readAvatarStem } from "@/lib/repo/avatars";
import { getSession } from "@/lib/session";
import { AVATAR_PRESETS, readAvatarBytes, safePresetKey } from "@/lib/avatarStore";

/** The encoded bytes for one person's avatar.
 *
 *  Authenticated-but-not-privileged on purpose. `/driver` shows a colleague's face on the
 *  route screen, so a MANAGE_ROLES gate here would blank every avatar in the vehicle app —
 *  the one surface where recognising the person in front of you matters most. There is no
 *  private photograph here: it is the same face the app's own people lists already show,
 *  and a login is required to ask at all.
 *
 *  `?key=<preset>` serves one of the canned portraits; without it the user's own
 *  `avatar_stem` is used. `?format=avif` returns AVIF and anything else WebP, which is what
 *  a `<picture>` fallback chain expects. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!getSession(req)) {
    return NextResponse.json({ ok: false, error: "احراز هویت نشده" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const userId = Number(id);
  if (!Number.isInteger(userId)) {
    return NextResponse.json({ ok: false, error: "شناسه نامعتبر" }, { status: 400 });
  }

  const q = new URL(req.url).searchParams;
  const format = q.get("format") === "avif" ? "avif" : "webp";

  // `undefined` is "no such user" and `null` is "a real user with no photo". Both are a 404
  // to a caller, but they are not the same fact, so the repo keeps them apart.
  const ownStem = readAvatarStem(getDb(), userId);
  if (ownStem === undefined) {
    return NextResponse.json({ ok: false, error: "عکس پیدا نشد" }, { status: 404 });
  }

  // safePresetKey is the boundary: a key reaches a filesystem path, so "../../etc/passwd"
  // must be refused here rather than trusted because a caller "only ever passes presets".
  const presetKey = q.has("key") ? safePresetKey(q.get("key")) : null;
  if (q.has("key") && (!presetKey || !AVATAR_PRESETS.some((p) => p.key === presetKey))) {
    return NextResponse.json({ ok: false, error: "عکس پیدا نشد" }, { status: 404 });
  }

  const fileStem = presetKey ?? ownStem;
  if (!fileStem) {
    return NextResponse.json({ ok: false, error: "عکس پیدا نشد" }, { status: 404 });
  }

  const bytes = await readAvatarBytes(fileStem, format);
  if (!bytes) {
    return NextResponse.json({ ok: false, error: "عکس پیدا نشد" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": format === "avif" ? "image/avif" : "image/webp",
      "Cache-Control": "private, max-age=3600",
    },
  });
}