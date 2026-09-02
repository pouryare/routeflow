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
function loginUrlFor(req: NextRequest, pathname: string): URL {
  const url = new URL("/login", req.url);
  // The login form reads this to say that a session ended, rather than showing a bare
  // form to someone who believed they were still signed in.
  url.searchParams.set("next", pathname);
  return url;
}

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
    const res = isApi
      ? NextResponse.json({ ok: false, error: "احراز هویت نشده" }, { status: 401 })
      : NextResponse.redirect(loginUrlFor(req, pathname));
    // Clear it on the way out. A cookie that can never work again is worse than none:
    // the browser keeps presenting it, every navigation takes the same round trip to be
    // refused, and the holder has no way to tell a dead session from a broken app.
    res.cookies.set(COOKIE_NAME, "", { path: "/", maxAge: 0 });
    return res;
  }

  const deny = (to: string) =>
    isApi
      ? NextResponse.json({ ok: false, error: "دسترسی لازم را ندارید" }, { status: 403 })
      : NextResponse.redirect(new URL(to, req.url));

  const isAdmin = pathname.startsWith("/sales/admin") || pathname.startsWith("/api/admin");
  const isDriver = pathname.startsWith("/driver") || pathname.startsWith("/api/driver");
  // The representatives admin surface is also open to rep_manager -- it is the channel
  // they run. Every other admin path stays owner-only. The routes themselves re-check.
  const isRepAdmin =
    pathname.startsWith("/sales/admin/representatives") ||
    pathname.startsWith("/api/admin/representatives");

  if (isAdmin && claims.role !== "owner" && !(isRepAdmin && claims.role === "rep_manager")) {
    return deny("/sales");
  }
  if (isDriver && claims.role !== "driver") return deny("/sales");

  // /analytics and /report aggregate a whole group's revenue, debt and coverage, and
  // /report hands the reader a CSV of every row behind the totals. A salesperson is
  // scoped to their own orders, so for them these are not a wider view of their own data
  // but somebody else's -- they get their own figures at /sales/me instead.
  const isGroupWide = pathname.startsWith("/analytics") || pathname.startsWith("/report");
  if (isGroupWide && claims.role === "salesperson") return deny("/sales");

  // The cheque board and its API are a manager/owner tool -- a salesperson records a
  // cheque as a payment via /sales/payments, but does not run the deposit/bounce
  // lifecycle. The API re-checks; this keeps the bundle and the tab off their screen.
  const isCheques = pathname.startsWith("/sales/cheques") || pathname.startsWith("/api/cheques");
  if (isCheques && claims.role !== "owner" && claims.role !== "group_manager") {
    return deny("/sales");
  }

  // A driver has one screen. Sending them anywhere else back to it keeps the whole
  // customer/coverage surface off a device that spends the day in a vehicle, and means a
  // mistyped URL is not the thing standing between a driver and the debt ledger.
  if (claims.role === "driver" && !isDriver) return deny("/driver");

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
