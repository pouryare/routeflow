import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { listDeliveries } from "@/lib/repo/deliveries";

export async function GET(req: NextRequest) {
  const guard = requireRole(req, ["owner", "group_manager", "salesperson", "driver"]);
  if (!guard.ok) return guard.response;
  const sp = req.nextUrl.searchParams;
  const orderId = sp.get("order_id");
  const runId = sp.get("run_id");
  return NextResponse.json({
    ok: true,
    deliveries: listDeliveries(guard.session.organizationId, {
      order_id: orderId ? Number(orderId) : undefined,
      run_id: runId ? Number(runId) : undefined,
    }),
  });
}
