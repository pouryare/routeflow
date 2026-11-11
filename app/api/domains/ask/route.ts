import { NextRequest, NextResponse } from "next/server";
import { withDbScope } from "@/lib/database/scope";
import { normalizeHostname } from "@/lib/companyHost";
import { isRegisteredHost } from "@/lib/repo/companyDomains";

/** Caddy asks this before it makes a certificate for an address it has not seen (on-demand TLS, deploy/routeflow):
 *  200 if a company has registered the address, 404 if not, so nobody can make the server mint certificates for
 *  names that are not ours. Caddy calls it straight on the app port; both Caddy site files answer 404 for this
 *  path (deploy/routeflow), so the public cannot probe which addresses are registered. */
export async function GET(req: NextRequest) {
  const host = normalizeHostname(req.nextUrl.searchParams.get("domain"));
  const known = host ? await withDbScope("system", () => isRegisteredHost(host)) : false;
  return new NextResponse(null, { status: known ? 200 : 404 });
}
