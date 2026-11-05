import { NextRequest } from "next/server";
import { sweepScope, sweepResponse } from "@/lib/sweepAuth";
import { bad } from "@/lib/storage/routeGuard";
import { dailySweep, evictCache, runStorageJobs, weeklySweep } from "@/lib/storage/maintenance";

export const dynamic = "force-dynamic";

/** Storage background work (docs/storage.md section 5), from the timers in deploy/routeflow with
 *  `x-sweep-token` (every company) or a manager's session (their own company):
 *  `jobs` every 5 minutes, `daily` (checks, trash purge, held-file notice, cache), `weekly` (spot-check, usage). */
export async function POST(req: NextRequest) {
  const task = req.nextUrl.searchParams.get("task");
  if (task !== "jobs" && task !== "daily" && task !== "weekly") return bad("task باید jobs، daily یا weekly باشد");
  const scope = await sweepScope(req);
  if (!scope.ok) return scope.response;
  const results = [];
  for (const organization_id of scope.orgIds) {
    if (task === "jobs") results.push({ organization_id, ran: await runStorageJobs(organization_id) });
    else if (task === "daily") results.push({ organization_id, ...await dailySweep(organization_id) });
    else results.push({ organization_id, ...await weeklySweep(organization_id) });
  }
  if (task === "daily") await evictCache();
  return sweepResponse(scope.via, results);
}
