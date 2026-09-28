import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import {
  fileComplaint,
  listComplaints,
  complaintClusters,
  type ComplaintCategory,
  type ComplaintSeverity,
  type ComplaintStatus,
} from "@/lib/repo/complaints";

const CATEGORIES: ComplaintCategory[] = [
  "spoilage",
  "packaging",
  "foreign_object",
  "short_weight",
  "wrong_product",
  "other",
];
const SEVERITIES: ComplaintSeverity[] = ["low", "medium", "high", "critical"];
const STATUSES: ComplaintStatus[] = ["open", "investigating", "resolved", "dismissed"];

export async function GET(req: NextRequest) {
  const guard = requireRole(req, ["owner", "group_manager", "phone_sales"]);
  if (!guard.ok) return guard.response;

  const sp = req.nextUrl.searchParams;
  const status = sp.get("status");
  const batchId = sp.get("batch_id");
  return NextResponse.json({
    ok: true,
    complaints: listComplaints(guard.session.organizationId, {
      status: STATUSES.includes(status as ComplaintStatus) ? (status as ComplaintStatus) : undefined,
      batch_id: batchId ? Number(batchId) : undefined,
    }),
    clusters: complaintClusters(guard.session.organizationId),
  });
}

export async function POST(req: NextRequest) {
  const guard = requireRole(req, ["owner", "group_manager", "phone_sales"]);
  if (!guard.ok) return guard.response;

  const body = (await req.json().catch(() => null)) as {
    customer_id?: number | null;
    order_id?: number | null;
    product_id?: number | null;
    batch_id?: number | null;
    category?: string;
    severity?: string;
    description?: string | null;
  } | null;

  if (!body?.category || !CATEGORIES.includes(body.category as ComplaintCategory)) {
    return NextResponse.json({ ok: false, error: "دستهٔ شکایت نامعتبر است" }, { status: 400 });
  }

  const id = fileComplaint(guard.session.organizationId, {
    customer_id: body.customer_id ?? null,
    order_id: body.order_id ?? null,
    product_id: body.product_id ?? null,
    batch_id: body.batch_id ?? null,
    reported_by: guard.session.user.id,
    category: body.category as ComplaintCategory,
    severity: SEVERITIES.includes(body.severity as ComplaintSeverity)
      ? (body.severity as ComplaintSeverity)
      : undefined,
    description: body.description ?? null,
  });
  return NextResponse.json({ ok: true, id }, { status: 201 });
}
