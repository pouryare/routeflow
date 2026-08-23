import { NextRequest, NextResponse } from "next/server";
import { getDb, readLeadLists, setLeadListItems } from "@/lib/db";

const MAX_NAME = 60;

export async function GET() {
  return NextResponse.json({ ok: true, lists: readLeadLists() });
}

interface NewListInput {
  name?: string;
  /** Optional starting membership, so "save this run as a list" is one request rather
   *  than a create followed by a replace that could half-fail. */
  location_ids?: number[];
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as NewListInput | null;
  if (!body) {
    return NextResponse.json({ ok: false, error: "بدنه درخواست نامعتبر است" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ ok: false, error: "نام لیست الزامی است" }, { status: 400 });
  }
  if (name.length > MAX_NAME) {
    return NextResponse.json({ ok: false, error: "نام لیست بیش از حد بلند است" }, { status: 400 });
  }

  const ids = sanitiseIds(body.location_ids);
  if (ids === null) {
    return NextResponse.json({ ok: false, error: "فهرست مکان‌ها نامعتبر است" }, { status: 400 });
  }

  const db = getDb();
  const now = new Date().toISOString();
  const result = db
    .prepare("INSERT INTO lead_lists (name, created_at, updated_at) VALUES (?, ?, ?)")
    .run(name, now, now);
  const id = Number(result.lastInsertRowid);

  if (ids.length) setLeadListItems(db, id, ids);

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
