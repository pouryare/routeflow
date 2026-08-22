import { NextRequest } from "next/server";
import { getDb, Customer } from "@/lib/db";
import { etagFor, etagJson, notModified } from "@/lib/httpCache";

export async function GET(req: NextRequest) {
  const db = getDb();
  const sig = db.prepare("SELECT COUNT(*) c, MAX(synced_at) m FROM customers").get() as {
    c: number;
    m: string | null;
  };
  const tag = etagFor("customers", sig.c, sig.m);
  const cached = notModified(req, tag);
  if (cached) return cached;

  const rows = db.prepare("SELECT * FROM customers ORDER BY business_name").all() as unknown as Customer[];
  return etagJson(tag, { customers: rows });
}
