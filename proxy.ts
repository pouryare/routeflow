import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME, parseSessionToken } from "./lib/auth";

// /sw.js, the manifest, and the offline fallback stay unauthenticated on purpose:
// a service worker script must return the same bytes regardless of session state, or
// the browser's SW update check can be fed the login page's HTML instead of the actual
// script. None of these carry any customer/business data, so exempting them is safe.
const PUBLIC_PATHS = ["/login", "/api/login", "/sw.js", "/manifest.webmanifest", "/offline", "/icon.svg"];

// A coarse gate on the token's own claims -- NOT an authorisation decision. Middleware
// cannot safely reach SQLite, so it cannot know that a user has since been demoted or
// deactivated; a stale claim still passes here. Every route does the authoritative,
// DB-backed check via requireRole() in lib/session.ts. The job of this file is to stop a
// driver's browser downloading the admin bundle, not to protect the data behind it.
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname === p) || pathname.startsWith("/_next")) {
    return NextResponse.next();
  }

  const claims = parseSessionToken(req.cookies.get(COOKIE_NAME)?.value);
  const isApi = pathname.startsWith("/api");

  // uid 0 was the shared-password session, which no longer exists. Such a cookie still
  // has a valid signature, so without this it would sail through here and then fail every
  // API call -- pages loading, nothing on them working. Treat it as signed out, which is
  // what it is, and send the holder to a login form that can actually help them.
  if (!claims || claims.uid === 0) {
    if (isApi) return NextResponse.json({ ok: false, error: "احراز هویت نشده" }, { status: 401 });
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  const deny = (to: string) =>
    isApi
      ? NextResponse.json({ ok: false, error: "دسترسی لازم را ندارید" }, { status: 403 })
      : NextResponse.redirect(new URL(to, req.url));

  const isAdmin = pathname.startsWith("/admin") || pathname.startsWith("/api/admin");
  const isDriver = pathname.startsWith("/driver") || pathname.startsWith("/api/driver");

  if (isAdmin && claims.role !== "owner") return deny("/");
  if (isDriver && claims.role !== "driver") return deny("/");

  // A driver has one screen. Sending them anywhere else back to it keeps the whole
  // customer/coverage surface off a device that spends the day in a vehicle, and means a
  // mistyped URL is not the thing standing between a driver and the debt ledger.
  if (claims.role === "driver" && !isDriver) return deny("/driver");

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
