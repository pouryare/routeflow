import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { readCustomers } from "@/lib/customers";
import { requireRole, scopeGroupIds } from "@/lib/session";
import { etagFor, etagJson, notModified } from "@/lib/httpCache";

export async function GET(req: NextRequest) {
  const guard = requireRole(req, ["owner", "group_manager"]);
  if (!guard.ok) return guard.response;
  const scope = scopeGroupIds(guard.session);

  const db = getDb();
  const sig = db.prepare("SELECT COUNT(*) c, MAX(synced_at) m FROM customers").get() as {
    c: number;
    m: string | null;
  };
  // Debt is computed and attached per row now, so a payment changes the body without
  // touching customers.synced_at -- the payments ledger has to be part of the cache key
  // or a stale list survives every receipt.
  const paySig = db
    .prepare("SELECT COUNT(*) c, MAX(COALESCE(voided_at, created_at)) m FROM payments")
    .get() as { c: number; m: string | null };
  // The scope is part of the cache key. Without it an owner and a group manager share a
  // tag for different bodies, so one browser that signs out and back in as the other role
  // revalidates, gets a 304, and redisplays the previous role's list from its own cache.
  const tag = etagFor(
    `customers:${scope === "all" ? "all" : scope.join(",")}`,
    sig.c + paySig.c,
    `${sig.m ?? ""}|${paySig.m ?? ""}`
  );
  const cached = notModified(req, tag);
  if (cached) return cached;

  return etagJson(req, tag, {
    customers: readCustomers(db, scope, { organizationId: guard.session.organizationId }),
  });
}
