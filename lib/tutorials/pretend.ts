/** Pretend saves while a tutorial runs on demo data (plan section 11).
 *
 *  Every write the page makes during a demo tutorial is answered here, in the browser, and never
 *  leaves the phone: a practice payment is not recorded and a practice SMS is not sent. Reads of a
 *  demo record (an id that starts with `demo-`) are answered too, because the server has no such
 *  row. Everything else (reading the real lists, the person's own settings) goes through.
 *
 *  The server holds a second lock: proxy.ts refuses any write whose address names a `demo-` id. */

const DEMO_PREFIX = "demo-";

/** On while a tutorial runs with pretend saves. Read by the offline outbox (lib/offline/net.ts), which
 *  would otherwise store a practice payment on the phone before any request is made. */
let pretending = false;
export const setPretending = (on: boolean) => {
  pretending = on;
};
export const isPretending = () => pretending;


/** Addresses a tutorial may still reach for real: its own progress and the person's settings. */
const PASS = [/^\/api\/tutorials(\/|$)/, /^\/api\/prefs$/];

export function pretendFor(method: string, url: string): "pass" | "fake" {
  let path: string;
  try {
    path = new URL(url, "http://x").pathname;
  } catch {
    return "pass";
  }
  if (!path.startsWith("/api/")) return "pass";
  if (PASS.some((re) => re.test(path))) return "pass";
  const m = method.toUpperCase();
  if (m === "GET" || m === "HEAD") return namesDemo(path) ? "fake" : "pass";
  return "fake";
}

/** The answer a pretend save gets: the shape most routes return, with a demo id, so a form shows
 *  «ذخیره شد» and closes the way it does for real. */
export function pretendBody(n: number): Record<string, unknown> {
  const id = `${DEMO_PREFIX}${n}`;
  return { ok: true, demo: true, id, client_uuid: id, server_time: new Date().toISOString() };
}

/** Demo records carry `demo-…` ids, or negative numbers where the screen's type wants a number
 *  (a demo delivery stop is -1). Real ids are never negative. */
const namesDemo = (path: string) => path.includes(`/${DEMO_PREFIX}`) || /\/-\d+(\/|$)/.test(path);

/** proxy.ts: a write that names a demo record never reaches a route. */
export const namesDemoRecord = (pathname: string) => pathname.startsWith("/api/") && namesDemo(pathname);
