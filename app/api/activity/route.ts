import { NextRequest, NextResponse } from "next/server";
import { getDb, ActivityEntry } from "@/lib/db";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const entityType = searchParams.get("entity_type");
  const entityId = Number(searchParams.get("entity_id"));

  if ((entityType !== "district" && entityType !== "customer") || !Number.isInteger(entityId)) {
    return NextResponse.json({ ok: false, error: "پارامترها نامعتبر است" }, { status: 400 });
  }

  const db = getDb();
  const rows = db
    .prepare(
      "SELECT * FROM activity_log WHERE entity_type = ? AND entity_id = ? ORDER BY created_at DESC LIMIT 50"
    )
    .all(entityType, entityId) as unknown as ActivityEntry[];

  return NextResponse.json({ ok: true, activity: rows });
}
