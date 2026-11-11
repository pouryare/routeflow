import { NextRequest, NextResponse } from "next/server";
import { withDbScope } from "@/lib/database/scope";
import { requestHostname } from "@/lib/companyHost";
import { resolveHost } from "@/lib/repo/companyDomains";

/** The name and logo the sign-in page shows for the address it was opened on. Public on purpose: it is what
 *  anyone who opens the address sees, and it carries nothing else. No session exists yet, so it runs as "system". */
export async function GET(req: NextRequest) {
  const host = await withDbScope("system", () => resolveHost(requestHostname(req.headers)));
  const body =
    host.kind === "company"
      ? { ok: true, kind: "company", name: host.name, logo: host.logo }
      : { ok: true, kind: host.kind };
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
