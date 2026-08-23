import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { readCustomers } from "@/lib/customers";
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

  return etagJson(req, tag, { customers: readCustomers(db) });
}
