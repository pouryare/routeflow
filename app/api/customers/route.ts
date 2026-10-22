import { NextRequest } from "next/server";
import { customerListSignature } from "@/lib/repo/customerList";
import { customersIn } from "@/lib/repo/routeAdapters";
import { orgScopeId, requireRole, scopeGroupIds } from "@/lib/session";
import { etagFor, etagJson, notModified } from "@/lib/httpCache";
import { MANAGE_ROLES } from "@/lib/roles";

export async function GET(req: NextRequest) {
  const guard = requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;
  const scope = scopeGroupIds(guard.session);

  const { customers: sig, payments: paySig } = customerListSignature(orgScopeId(guard.session));
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
    customers: customersIn(scope, { organizationId: guard.session.organizationId }),
  });
}
