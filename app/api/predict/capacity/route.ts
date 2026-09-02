import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { getDb } from "@/lib/db";
import { resolvedCapacityFactorsFor } from "@/lib/repo/capacityLearning";

export const dynamic = "force-dynamic";

/** The resolved (configured-or-learned) capacity factors, each with how many
 *  observations the learned value rests on. Manager tool. */
export async function GET(req: NextRequest) {
  const guard = requireRole(req, ["owner", "group_manager"]);
  if (!guard.ok) return guard.response;

  const org = guard.session.organizationId;
  const resolved = resolvedCapacityFactorsFor(org);
  const learnedN = new Map(
    (
      getDb()
        .prepare(
          `SELECT condition_code, MAX(learned_n) AS n FROM capacity_factors
            WHERE (organization_id = ? OR organization_id IS NULL) AND active = 1
            GROUP BY condition_code`
        )
        .all(org) as { condition_code: string; n: number }[]
    ).map((r) => [r.condition_code, r.n])
  );

  return NextResponse.json({
    ok: true,
    factors: resolved.map((f) => ({ ...f, learned_n: learnedN.get(f.condition_code) ?? 0 })),
  });
}
