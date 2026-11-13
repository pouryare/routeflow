/** The sentence for a save the screen did not announce itself: «ذخیره شد» after an edit, «حذف شد» after a
 *  delete, «انجام شد» after anything else. components/ToastProvider.tsx shows it for every change a person
 *  makes through /api, unless a toast of the screen's own words arrives first, so no button saves in silence.
 *
 *  Returns null for requests that are not a person's action: the sync engine, the live stream, sign-in and
 *  sign-out, tutorial progress, marking notifications read, search, activity pings and UI preferences. */
const QUIET_PREFIXES = ["/api/sync", "/api/live", "/api/login", "/api/logout", "/api/me/sign-out", "/api/me/step", "/api/me/role", "/api/tutorials", "/api/search", "/api/activity", "/api/prefs", "/api/push", "/api/admin/acting-org", "/api/admin/data/preview", "/api/sales/pings"];

export function feedbackFor(method: string, pathname: string): string | null {
  const m = method.toUpperCase();
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") return null;
  if (!pathname.startsWith("/api/")) return null;
  if (pathname === "/api/notifications" || QUIET_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return null;
  return m === "DELETE" ? "حذف شد" : m === "PATCH" || m === "PUT" ? "ذخیره شد" : "انجام شد";
}
