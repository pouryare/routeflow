import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME, verifySessionToken } from "./lib/auth";

// /sw.js, the manifest, and the offline fallback stay unauthenticated on purpose:
// a service worker script must return the same bytes regardless of session state, or
// the browser's SW update check can be fed the login page's HTML instead of the actual
// script. None of these carry any customer/business data, so exempting them is safe.
const PUBLIC_PATHS = ["/login", "/api/login", "/sw.js", "/manifest.webmanifest", "/offline", "/icon.svg"];

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname === p) || pathname.startsWith("/_next")) {
    return NextResponse.next();
  }

  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (verifySessionToken(token)) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api")) {
    return NextResponse.json({ ok: false, error: "احراز هویت نشده" }, { status: 401 });
  }

  const loginUrl = new URL("/login", req.url);
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
