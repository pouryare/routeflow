import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { OWNER_ROLES } from "@/lib/roles";
import { parseRatingTags, RATING_TAG_LEN, RATING_TAG_MAX } from "@/lib/ratingTags";
import { setRatingTags } from "@/lib/repo/ratingTags";

/** The company's rating tags, owner only. Drivers read them inside the lead-visit flow context. */
export async function PUT(req: NextRequest) {
  const guard = await requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;
  const tags = parseRatingTags(await req.json().catch(() => null));
  if (!tags) {
    return NextResponse.json(
      { ok: false, error: `هر فهرست تا ${RATING_TAG_MAX.toLocaleString("fa-IR")} برچسب، هرکدام تا ${RATING_TAG_LEN.toLocaleString("fa-IR")} حرف و بدون ویرگول` },
      { status: 400 },
    );
  }
  await setRatingTags(guard.session.organizationId, tags);
  return NextResponse.json({ ok: true, tags });
}
