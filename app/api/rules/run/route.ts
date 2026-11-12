import { NextRequest } from "next/server";
import { sweepScope, sweepResponse } from "@/lib/sweepAuth";
import { sweepCompanyRules } from "@/lib/repo/rulesSweep";

export const dynamic = "force-dynamic";

/** The periodic rule sweep: a manager's «به‌روزرسانی» click (own org) or the token caller (every org).
 *  The work is `sweepCompanyRules`; the worker (lib/worker.ts) runs the same function on a schedule. */
export async function POST(req: NextRequest) {
  const scope = await sweepScope(req);
  if (!scope.ok) return scope.response;
  const results = [];
  for (const organization_id of scope.orgIds) results.push(await sweepCompanyRules(organization_id));
  return sweepResponse(scope.via, results);
}
