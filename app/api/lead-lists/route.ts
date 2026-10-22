import { NextRequest, NextResponse } from "next/server";
import { getDb, readLeadLists } from "@/lib/db";
import { createLeadList } from "@/lib/repo/leadListsAdmin";
import { groupFilter, requireRole, scopeGroupIds } from "@/lib/session";
import { PIN_POOL_ROLES } from "@/lib/roles";

const MAX_NAME = 60;

// lead_lists is option 1: a list is compiled by one group and belongs to it outright.
export async function GET(req: NextRequest) {
  const guard = requireRole(req, PIN_POOL_ROLES);
  if (!guard.ok) return guard.response;

  return NextResponse.json({ ok: true, lists: readLeadLists(getDb(), scopeGroupIds(guard.session)) });
}

interface NewListInput {
  name?: string;
  /** Optional starting membership, so "save this run as a list" is one request rather
   *  than a create followed by a replace that could half-fail. */
  location_ids?: number[];
}

export async function POST(req: NextRequest) {
  const guard = requireRole(req, PIN_POOL_ROLES);
  if (!guard.ok) return guard.response;

  const body = (await req.json().catch(() => null)) as NewListInput | null;
  if (!body) {
    return NextResponse.json({ ok: false, error: "بدنه درخواست نامعتبر است" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ ok: false, error: "نام فهرست الزامی است" }, { status: 400 });
  }
  if (name.length > MAX_NAME) {
    return NextResponse.json({ ok: false, error: "نام فهرست بیش از حد بلند است" }, { status: 400 });
  }

  const ids = sanitiseIds(body.location_ids);
  if (ids === null) {
    return NextResponse.json({ ok: false, error: "فهرست مکان‌ها نامعتبر است" }, { status: 400 });
  }

  const id = createLeadList(name, guard.session.groupId, guard.session.organizationId, ids, groupFilter(guard.session));

  return NextResponse.json({ ok: true, id });
}

/** Integer ids, de-duplicated, order preserved. Returns null when the input is present
 *  but malformed -- distinct from an empty list, which is a legitimate thing to want. */
export function sanitiseIds(raw: unknown): number[] | null {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return null;
  const out: number[] = [];
  const seen = new Set<number>();
  for (const v of raw) {
    if (!Number.isInteger(v) || (v as number) <= 0) return null;
    const n = v as number;
    // A location appearing twice in one route is a mis-tap, not an instruction to drive
    // there twice; the UNIQUE constraint would reject it anyway.
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}
