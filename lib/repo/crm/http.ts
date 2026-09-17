import { NextResponse } from "next/server";
import { CrmError } from "./write";

export function crmErrorResponse(e: unknown): NextResponse {
  if (e instanceof CrmError) return NextResponse.json({ ok: false, error: e.message, ...(e.extra ?? {}) }, { status: e.status });
  throw e;
}
export const idParam = (raw: string): number | null => (/^\d+$/.test(raw) ? Number(raw) : null);
export const CRM_ROLES = ["owner", "group_manager", "rep_manager", "salesperson", "platform_owner"] as const;
