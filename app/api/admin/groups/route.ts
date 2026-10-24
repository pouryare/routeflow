import { NextRequest, NextResponse } from "next/server";
import { createGroup, listGroups } from "@/lib/repo/groupsAdmin";
import { orgScopeId, requireRole } from "@/lib/session";
import { OWNER_ROLES } from "@/lib/roles";
import { isUniqueViolation } from "@/lib/database/errors";

/** Fixed palette rather than free-form colour input.
 *
 *  Territory tints share a map with the coverage-status colours, so they must never
 *  collide with --good / --warn / --crit, which already mean something specific there.
 *  A free-form picker would let an owner choose exactly the red that means "not allowed".
 *  Kept in sync with GROUP_PALETTE in app/admin/groups/page.tsx. */
export const GROUP_PALETTE = ["#2DE0E6", "#7C6BF0", "#E066B8", "#4FB286", "#D89B3C", "#6C8AE4"];

/** Slug for a group name, Unicode-aware.
 *
 *  Persian names are the normal case here, so stripping to ASCII would produce an empty
 *  slug for almost every real group. Keeps letters and digits in any script, folds
 *  whitespace to hyphens, and falls back to a generated token if a name is entirely
 *  punctuation. */
export function slugify(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}-]/gu, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return base || `group-${Date.now().toString(36)}`;
}

export async function GET(req: NextRequest) {
  const guard = await requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;

  const groups = await listGroups(orgScopeId(guard.session));

  return NextResponse.json({ ok: true, groups, palette: GROUP_PALETTE });
}

export async function POST(req: NextRequest) {
  const guard = await requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;

  const body = (await req.json().catch(() => null)) as { name?: string; color?: string } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (name.length > 60) {
    return NextResponse.json({ ok: false, error: "نام گروه حداکثر ۶۰ نویسه است" }, { status: 400 });
  }
  if (!name) {
    return NextResponse.json({ ok: false, error: "نام گروه الزامی است" }, { status: 400 });
  }
  const color = GROUP_PALETTE.includes(body?.color ?? "") ? body!.color! : GROUP_PALETTE[0];

  try {
    const id = await createGroup(guard.session.organizationId, name, slugify(name), color);
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطا";
    // A duplicate name is a thing the owner did, not a server fault -- 409 so the form can
    // say so, rather than a 500 that reads as "the app is broken".
    if (isUniqueViolation(e)) {
      return NextResponse.json({ ok: false, error: "گروهی با این نام از قبل وجود دارد" }, { status: 409 });
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
