import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireRole } from "@/lib/session";

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
  const guard = requireRole(req, ["owner"]);
  if (!guard.ok) return guard.response;

  const groups = getDb()
    .prepare(
      `SELECT g.*, (SELECT COUNT(*) FROM districts d WHERE d.group_id = g.id) AS district_count,
              (SELECT COUNT(*) FROM users u WHERE u.group_id = g.id AND u.active = 1) AS user_count
       FROM groups g ORDER BY g.name`
    )
    .all() as unknown as Record<string, unknown>[];

  return NextResponse.json({ ok: true, groups, palette: GROUP_PALETTE });
}

export async function POST(req: NextRequest) {
  const guard = requireRole(req, ["owner"]);
  if (!guard.ok) return guard.response;

  const body = (await req.json().catch(() => null)) as { name?: string; color?: string } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ ok: false, error: "نام گروه الزامی است" }, { status: 400 });
  }
  const color = GROUP_PALETTE.includes(body?.color ?? "") ? body!.color! : GROUP_PALETTE[0];

  const db = getDb();
  const organizationId = guard.session.user.organization_id;
  try {
    const result = db
      .prepare(
        "INSERT INTO groups (name, slug, color, active, created_at, organization_id) VALUES (?, ?, ?, 1, ?, ?)"
      )
      .run(name, uniqueSlug(db, slugify(name), organizationId), color, new Date().toISOString(), organizationId);
    return NextResponse.json({ ok: true, id: Number(result.lastInsertRowid) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطا";
    // A duplicate name is a thing the owner did, not a server fault -- 409 so the form can
    // say so, rather than a 500 that reads as "the app is broken".
    if (msg.includes("UNIQUE")) {
      return NextResponse.json({ ok: false, error: "گروهی با این نام از قبل وجود دارد" }, { status: 409 });
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

/** Two different names can slugify to the same string ("گروه شرق" and "گروه-شرق"), and
 *  slug is UNIQUE per organisation, so a collision would surface as a duplicate-name
 *  error the owner cannot act on. Suffix instead.
 *
 *  Scoped to this organisation only: a slug taken by a different tenant is not a
 *  collision here, and treating it as one would leak that the other tenant's slug
 *  exists at all. */
function uniqueSlug(db: ReturnType<typeof getDb>, base: string, organizationId: number): string {
  const taken = db.prepare("SELECT 1 FROM groups WHERE slug = ? AND organization_id = ?");
  if (!taken.get(base, organizationId)) return base;
  for (let n = 2; n < 100; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.get(candidate, organizationId)) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}
