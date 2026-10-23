import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME, parseSessionToken } from "./lib/auth";
import { isVanRole, MANAGE_ROLES, OWNER_ROLES } from "@/lib/roles";

// /sw.js, the manifest, and the offline fallback stay unauthenticated on purpose:
// a service worker script must return the same bytes regardless of session state, or
// the browser's SW update check can be fed the login page's HTML instead of the actual
// script. None of these carry any customer/business data, so exempting them is safe.
const PUBLIC_PATHS = ["/login", "/api/login", "/api/login/second-factor", "/sw.js", "/manifest.webmanifest", "/offline", "/icon.svg"];

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

/** Paths a session that must change its password may still reach (F35). A file with an
 *  extension is a static asset (icons, fonts), which carries nothing behind the gate. */
function isPasswordChangePath(pathname: string): boolean {
  return (
    pathname === "/password" ||
    pathname === "/api/me/password" ||
    pathname === "/api/logout" ||
    /\.[a-z0-9]+$/i.test(pathname)
  );
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

  /* F35: a password an owner chose is a one-time key. Until it is replaced, the only places open
     are the form that replaces it, its route, and signing out; everything else is sent there. */
  if (claims.pw === 1 && !isPasswordChangePath(pathname)) {
    return isApi
      ? NextResponse.json({ ok: false, error: "ابتدا رمز عبور تازه‌ای انتخاب کنید" }, { status: 403 })
      : NextResponse.redirect(new URL("/password", req.url));
  }

  const deny = (to: string) =>
    isApi
      ? NextResponse.json({ ok: false, error: "دسترسی لازم را ندارید" }, { status: 403 })
      : NextResponse.redirect(new URL(to, req.url));

  const isAdmin = pathname.startsWith("/sales/admin") || pathname.startsWith("/api/admin");
  // The account switcher: owner/platform_owner only, and it shares the admin gate so the
  // two cannot drift. Listed separately because it is NOT under /admin.
  const isSwitch = pathname === "/switch" || pathname.startsWith("/api/admin/impersonatable");
  const isDriver = pathname.startsWith("/driver") || pathname.startsWith("/api/driver");
  // The representatives admin surface is also open to rep_manager -- it is the channel
  // they run. Every other admin path stays owner-only. The routes themselves re-check.
  const isRepAdmin = pathname.startsWith("/api/admin/representatives");

  // Phase 8: the /reps surface is a manager + rep_manager tool (the routes re-check).
  const isReps = pathname.startsWith("/sales/reps") || pathname.startsWith("/api/sales/reps");
  if (
    isReps &&
    !OWNER_ROLES.includes(claims.role) &&
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
    !OWNER_ROLES.includes(claims.role) &&
    claims.role !== "group_manager" &&
    claims.role !== "rep_manager"
  ) {
    return deny("/sales");
  }

  /* Login-As: «بازگشت» is called while the session is still the impersonated user's, so
     this one method on this one path is open to any signed-in session. The route itself
     refuses anything that is not a genuine impersonation by the saved owner. */
  const isEndImpersonation = pathname === "/api/admin/impersonate" && req.method === "DELETE";
  if ((isAdmin || isSwitch) && !isEndImpersonation
      && !OWNER_ROLES.includes(claims.role)
      && !(isRepAdmin && claims.role === "rep_manager")) {
    return deny("/sales");
  }
  /* A platform_owner is let through to see NotAVanNotice, which offers the switcher. Without
     this exemption the request is bounced here and the notice never renders — the spec's
     §4.3 calls this out by name. Scoped to platform_owner ONLY: an owner or group_manager
     is still denied, because they were not invited to inspect a driver's day. */
  if (isDriver && !isVanRole(claims.role) && claims.role !== "platform_owner") return deny("/sales");

  // /report aggregates a whole group's revenue, debt and coverage, and hands the reader a
  // CSV of every row behind the totals. A salesperson is
  // scoped to their own orders, so for them these are not a wider view of their own data
  // but somebody else's -- they get their own figures at /sales/me instead.
  const isGroupWide = pathname.startsWith("/report");
  if (isGroupWide && claims.role === "phone_sales") return deny("/sales");

  // The reason report counts a whole group's failures and cancellations; a manager/owner view.
  if (pathname.startsWith("/sales/reasons") && !OWNER_ROLES.includes(claims.role) && claims.role !== "group_manager") {
    return deny("/sales");
  }

  // The cheque board and its API are a manager/owner tool -- a salesperson records a
  // cheque as a payment via /sales/payments, but does not run the deposit/bounce
  // lifecycle. The API re-checks; this keeps the bundle and the tab off their screen.
  const isCheques = pathname.startsWith("/sales/cheques") || pathname.startsWith("/api/cheques");
  if (isCheques && !OWNER_ROLES.includes(claims.role) && claims.role !== "group_manager") {
    return deny("/sales");
  }

  // The batch board + its write APIs are a warehouse/owner tool. A salesperson files a
  // quality complaint (/sales/complaints stays open to them) but does not run the batch
  // status machine or record stock movements. The routes re-check.
  const isBatchAdmin =
    pathname.startsWith("/sales/batches") ||
    pathname.startsWith("/api/sales/batches") ||
    pathname.startsWith("/api/sales/stock/movements") ||
    // Phase 3: the delivery retry/complete routes are a desk job. The order-transition route
    // is open to salesperson+/driver -- it gates itself by the transition's own roles.
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
  if (isBatchAdmin && !OWNER_ROLES.includes(claims.role) && claims.role !== "group_manager") {
    return deny("/sales");
  }

  // A driver has a short list, not a menu. Sending them anywhere outside it back to their
  // own screen keeps the whole customer/coverage surface off a device that spends the day
  // in a vehicle, and means a mistyped URL is not the thing standing between a driver and
  // the debt ledger. The lead run joins that list because it is the same work seen from
  // the other end: the stops they drive, and what happened at each one.
  // The sync endpoints are the exception: the driver app IS an offline client, so it
  // must be able to push its outbox and pull its run. The routes scope by session.
  // Phase 7: the driver's briefing + their own task actions live off /driver.
  const isSync = pathname.startsWith("/api/sync");
  const isCrm = pathname === "/crm" || pathname.startsWith("/crm/") || pathname.startsWith("/api/crm");
  const isDriverVisits = pathname.startsWith("/api/crm/driver-visits");
  const isVan = isVanRole(claims.role);
  if (isCrm && !isDriverVisits && isVan) return deny("/driver");
  if (isDriverVisits && !isVan) return deny("/sales");

  const isDriverBriefing =
    // Signing out, and the session/prefs reads the shell makes: «خروج» on /driver posts to
    // /api/logout, and a 403 here left a van role unable to end its session.
    pathname === "/api/logout" ||
    pathname === "/api/me" ||
    pathname === "/api/prefs" ||
    pathname.startsWith("/api/crm/driver-visits") ||
    pathname === "/start" ||
    pathname === "/api/today" ||
    pathname.startsWith("/api/tasks") ||
    // Phase 8: the objection library is useful at the door.
    pathname.startsWith("/sales/academy") ||
    pathname.startsWith("/api/sales/academy") ||
    // Notifications Phase 2: a driver receives delivery.failed and task.assigned, so they
    // own the same opt-in matrix, quiet hours and device linking as everyone else. Every
    // one of these routes already scopes to the caller's own session.
    pathname.startsWith("/settings") ||
    pathname.startsWith("/api/notifications") ||
    pathname.startsWith("/api/push/subscribe") ||
    // The lead run a driver works, and the visit recorded at the door.
    // /api/leads/locations/[id]/visit has admitted a driver in requireRole since it was
    // written, but it lives under /api/leads rather than /api/crm/driver-visits -- so the
    // gate below answered every visit a driver tried to record, and the route never ran.
    // The allowlist is what lets the request arrive.
    //
    // `/leads` was on this list and is not any more: the page is the office's pin pool
    // now, and the driver's own work is on /driver, which they are already allowed. With
    // this line gone, the `isVan` gate below catches a van role asking for the pool and
    // sends them to their own day. There is deliberately no second /leads check further
    // down -- the two-tier gate already says it, and a third copy is how a gate drifts.
    pathname.startsWith("/api/leads/locations") ||
    pathname.startsWith("/api/lead-runs");
  if (isVan && !isDriver && !isSync && !isDriverBriefing) return deny("/driver");

  /* /leads is the office's pin pool, and the pool is a manager's tool. The allowlist
     above describes who a VAN role may reach -- it says nothing about a rep who should
     not. `isManager` is `!isVanRole`, so a phone_sales rep satisfies every manager
     comparison in the app and reached the pool and the «سپردن مسیر» hand-off, on a URL
     the nav hid but the gate never checked.

     appNav.ts already draws the line: /leads is `ready: isRepLead(r)`. This makes the
     gate match it, so the nav is a gate rather than a suggestion.

     /crm rather than /sales, because that is where a rep's leads actually live:
     crm/page.tsx redirects a van role and otherwise opens on today's follow-ups, and
     /api/crm/businesses admits CRM_ROLES -- which includes phone_sales.

     Placed AFTER the isVan gate on purpose. A van role must be sent to /driver (their
     own day, which now holds both kinds of work) rather than /crm -- which would bounce
     them straight back, because the isCrm gate above 403s them first. */
  const isPinPool = pathname === "/leads" || pathname.startsWith("/leads/");
  /* `OWNER_ROLES`, not the literal "owner". This gate read
     `claims.role !== "owner" && claims.role !== "group_manager" && ...` and was correct
     for every role except one: platform_owner is a documented strict superset of owner
     (lib/roles.ts:68), so the platform's own god key was bounced from /leads to /crm by a
     condition that looked identical to the three around it.

     The point of the constant is that a role added to it in ONE place reaches every gate
     that admits owners. A hand-written list has to be found and edited by hand, and the
     one copy nobody remembers is the one that quietly excludes somebody.

     The accounting gate further down, added with the ledger, uses the constant; this one
     predates it by a long way and was never revisited. That is how the same trap got
     avoided in new code and left standing in old. */
  if (
    isPinPool &&
    !OWNER_ROLES.includes(claims.role) &&
    claims.role !== "group_manager" &&
    claims.role !== "rep_manager"
  ) {
    return deny("/crm");
  }

  /* Pages whose data routes answer the managers only. The route planner and the places list read
     /api/locations, /api/facilities, /api/customers and /api/activity, which are MANAGE_ROLES; a
     salesperson or rep manager who opened them got a page of 403s. appNav.ts hides the same
     tabs, so the nav is again a gate rather than a suggestion. (/map and /gallery stay open to
     them: their data routes now admit read access, scoped to the caller's group.) */
  const isManagerOnlyPage = ["/planner", "/facilities"].some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  if (isManagerOnlyPage && !MANAGE_ROLES.includes(claims.role)) return deny("/sales");

  /* Receipts and complaints: the APIs admit the managers and phone_sales, not rep_manager. */
  if (
    claims.role === "rep_manager" &&
    (pathname.startsWith("/sales/payments") || pathname.startsWith("/sales/complaints"))
  ) {
    return deny("/sales");
  }

  /* The accounting reports are org-wide money: the whole ledger, every supplier, every
     margin. Gate at the edge AND re-check inside each page, the same two-tier shape as
     isCheques above — this keeps the bundle and the tab off a rep's screen; the page's own
     check is the one that is authoritative.

     OWNER_ROLES, never a literal: `platform_owner` is a documented strict superset of
     owner, so a hand-written `claims.role !== "owner"` would lock the platform's own god
     key out of the books while reading exactly like the surrounding code.

     A group_manager may READ the journal and expenses — they can enter expenses, so hiding
     those from them would be hiding their own work — but not the trial balance, the balance
     sheet, the income statement, or what the org owes. */
  const isAccounting =
    pathname === "/accounting" || pathname.startsWith("/accounting/");
  if (isAccounting && !OWNER_ROLES.includes(claims.role) && claims.role !== "group_manager") {
    return deny("/sales");
  }

  // Period close and manual journals change the books, so they stay owner-only while a
  // manager keeps read access to the reports above.
  const isAccountingWrite =
    pathname.startsWith("/api/accounting/periods") ||
    pathname.startsWith("/api/accounting/journals");
  if (isAccountingWrite && !OWNER_ROLES.includes(claims.role)) {
    return deny("/sales");
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
