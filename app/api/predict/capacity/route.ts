import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { resolvedCapacityFactorsFor, learnedCapacityCounts } from "@/lib/repo/capacityLearning";
import { MANAGE_ROLES } from "@/lib/roles";

export const dynamic = "force-dynamic";

/** The resolved (configured-or-learned) capacity factors, each with how many
 *  observations the learned value rests on. Manager tool. */
export async function GET(req: NextRequest) {
  const guard = requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;

  const org = guard.session.organizationId;
  const learnedN = learnedCapacityCounts(org);
  return NextResponse.json({
    ok: true,
    factors: resolvedCapacityFactorsFor(org).map((f) => ({
      ...f,
      learned_n: learnedN.get(f.condition_code) ?? 0,
    })),
  });
}
