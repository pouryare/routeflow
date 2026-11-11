import { NextRequest, NextResponse } from "next/server";
import { withDbScope } from "@/lib/database/scope";
import { normalizeHostname } from "@/lib/companyHost";
import { getDb } from "@/lib/db";

/** Caddy asks this before it makes a certificate for an address it has not seen (on-demand TLS, deploy/routeflow):
 *  200 if a company has registered the address, 404 if not, so nobody can make the server mint certificates for
 *  names that are not ours. Caddy calls it straight on the app port; a request that came through Caddy carries
 *  X-Forwarded-For, so the public cannot probe which addresses are registered. */
export async function GET(req: NextRequest) {
  if (req.headers.get("x-forwarded-for")) return new NextResponse(null, { status: 404 });
  const host = normalizeHostname(req.nextUrl.searchParams.get("domain"));
  const known = host
    ? await withDbScope("system", () => getDb().prepare("SELECT 1 FROM company_domains WHERE hostname = ?").get(host))
    : null;
  return new NextResponse(null, { status: known ? 200 : 404 });
}
