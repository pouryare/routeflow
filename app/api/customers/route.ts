import { NextRequest } from "next/server";
import { currentCustomerToken, customerListSignature, customersChangedSince } from "@/lib/repo/customerList";
import { compressedJson } from "@/lib/httpCache";
import { customersIn } from "@/lib/repo/routeAdapters";
import { orgScopeId, requireRole, scopeGroupIds } from "@/lib/session";
import { etagFor, etagJson, notModified } from "@/lib/httpCache";
import { MANAGE_ROLES } from "@/lib/roles";

export async function GET(req: NextRequest) {
  const guard = await requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;
  const scope = await scopeGroupIds(guard.session);

  // ?since=<bookmark>: only the customers that changed since, the ids deleted and the list's new size, so a
  // phone that already holds the list pays for the change, not for 700 shops again. A bookmark we do not
  // recognise answers {full:true} and the screen reads the whole list.
  const since = req.nextUrl.searchParams.get("since");
  if (since !== null) {
    const delta = await customersChangedSince(guard.session.organizationId, scope, since);
    return compressedJson(req, delta ? { ok: true, ...delta } : { ok: true, full: true }, { headers: { "Cache-Control": "private, no-store" } });
  }

  const { customers: sig, payments: paySig } = await customerListSignature(orgScopeId(guard.session));
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

  // The bookmark is taken before the rows are read, so a change committed in between shows up in the next delta.
  const token = await currentCustomerToken();
  return etagJson(req, tag, {
    token,
    customers: await customersIn(scope, { organizationId: guard.session.organizationId }),
  });
}
