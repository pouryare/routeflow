/** Auth for the periodic sweep routes (`/api/rules/run`, `/api/analysis/refresh`,
 *  `/api/predict/refresh`).
 *
 *  Two callers:
 *   - a manager in the browser hitting a «به‌روزرسانی» button — a normal cookie
 *     session, scoped to that manager's own organisation;
 *   - the systemd cron (`scripts/run-sweeps.mjs`) with the shared `SWEEP_TOKEN` in an
 *     `x-sweep-token` header — no cookie, runs for **every** organisation.
 *
 *  The token is compared in constant time. `proxy.ts` has a coarse header check that
 *  lets a token request past the manager-cookie gate; this is the authoritative one.
 */

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { requireRole } from "./session";
import { allOrgIds } from "./repo/organizations";

import { MANAGE_ROLES } from "@/lib/roles";
function tokenMatches(header: string | null): boolean {
  const secret = process.env.SWEEP_TOKEN;
  if (!secret || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export type SweepScope =
  | { ok: true; orgIds: number[]; via: "token" | "session" }
  | { ok: false; response: NextResponse };

/** The organisations this request may sweep, or a 401/403 to return. */
export function sweepScope(req: NextRequest): SweepScope {
  if (tokenMatches(req.headers.get("x-sweep-token"))) {
    return { ok: true, orgIds: allOrgIds(), via: "token" };
  }
  const guard = requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return { ok: false, response: guard.response };
  return { ok: true, orgIds: [guard.session.organizationId], via: "session" };
}

/** The standard sweep response: one entry per organisation swept, plus — when exactly
 *  one was swept (every cookie call, and a single-tenant install) — that entry's fields
 *  spread on top, so the browser buttons and the existing tests keep their flat shape. */
export function sweepResponse<T extends Record<string, unknown>>(
  via: "token" | "session",
  results: ({ organization_id: number } & T)[]
): NextResponse {
  return NextResponse.json({
    ok: true,
    via,
    swept: results.length,
    results,
    ...(results.length === 1 ? results[0] : {}),
  });
}
