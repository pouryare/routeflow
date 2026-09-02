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

  // The sweep cron (scripts/run-sweeps.mjs) has no cookie -- it carries the shared
  // SWEEP_TOKEN. This is the coarse gate that lets it past the manager-cookie check;
  // the route (lib/sweepAuth) re-verifies the token in constant time.
  const sweepToken = process.env.SWEEP_TOKEN;
  if (
    sweepToken &&
    req.headers.get("x-sweep-token") === sweepToken &&
    (pathname === "/api/rules/run" ||
      pathname === "/api/analysis/refresh" ||
      pathname === "/api/predict/refresh")
  ) {
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

  // Phase 8: the /reps surface is a manager + rep_manager tool (the routes re-check).
  const isReps = pathname.startsWith("/sales/reps") || pathname.startsWith("/api/sales/reps");
  if (
    isReps &&
    claims.role !== "owner" &&
    claims.role !== "group_manager" &&
    claims.role !== "rep_manager"
  ) {
    return deny("/sales");
  }

  // Board & Pocket: the task Board and the recurrence editor are a manager + rep_manager
  // tool. The Pocket (/sales/pocket, /api/pocket) is opener -- a salesperson's own home --
  // so it is deliberately NOT here. The routes re-check.
  const isTaskBoard =
    pathname.startsWith("/sales/tasks") ||
    pathname.startsWith("/api/board") ||
    pathname.startsWith("/api/task-recurrences");
  if (
    isTaskBoard &&
    claims.role !== "owner" &&
    claims.role !== "group_manager" &&
    claims.role !== "rep_manager"
  ) {
    return deny("/sales");
  }

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

  // The batch board + its write APIs are a warehouse/owner tool. A salesperson files a
  // quality complaint (/sales/complaints stays open to them) but does not run the batch
  // status machine or record stock movements. The routes re-check.
  const isBatchAdmin =
    pathname.startsWith("/sales/batches") ||
    pathname.startsWith("/api/sales/batches") ||
    pathname.startsWith("/api/sales/stock/movements") ||
    // Phase 3: the deliveries board and its retry/complete routes are a desk job. The
    // order-transition route is open to salesperson+/driver -- it gates itself by the
    // transition's own roles.
    pathname.startsWith("/sales/deliveries") ||
    pathname.startsWith("/api/sales/deliveries") ||
    // Phase 5: routing is a desk job.
    pathname.startsWith("/sales/routing") ||
    pathname.startsWith("/api/sales/routing") ||
    pathname.startsWith("/api/sales/vehicles") ||
    pathname.startsWith("/api/sales/route-templates") ||
    pathname.startsWith("/api/sales/runs/") ||
    // Phase 6: weather refresh + factor tuning are manager tools; the read is opener.
    pathname.startsWith("/api/sales/weather/refresh") ||
    pathname.startsWith("/api/sales/capacity-factors") ||
    // Phase 7: targets + rule tuning are manager tools.
    pathname.startsWith("/api/targets") ||
    pathname.startsWith("/api/rules") ||
    // Phase 9: the analysis sweep is a manager/scheduler hook. The read routes gate
    // themselves (kpis/action-center open to salesperson at own scope; why/margin
    // manager-only inside the route).
    pathname.startsWith("/api/analysis/refresh") ||
    // Phase 10: prediction is a manager tool end to end.
    pathname.startsWith("/api/predict") ||
    pathname.startsWith("/sales/forecast");
  if (isBatchAdmin && claims.role !== "owner" && claims.role !== "group_manager") {
    return deny("/sales");
  }

  // A driver has one screen. Sending them anywhere else back to it keeps the whole
  // customer/coverage surface off a device that spends the day in a vehicle, and means a
  // mistyped URL is not the thing standing between a driver and the debt ledger.
  // The sync endpoints are the exception: the driver app IS an offline client, so it
  // must be able to push its outbox and pull its run. The routes scope by session.
  // Phase 7: the driver's briefing + their own task actions live off /driver.
  const isSync = pathname.startsWith("/api/sync");
  const isDriverBriefing =
    pathname === "/today" ||
    pathname === "/api/today" ||
    pathname.startsWith("/api/tasks") ||
    // Phase 8: the objection library is useful at the door.
    pathname.startsWith("/sales/academy") ||
    pathname.startsWith("/api/sales/academy");
  if (claims.role === "driver" && !isDriver && !isSync && !isDriverBriefing) return deny("/driver");

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
