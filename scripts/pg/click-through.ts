/* Opens every screen a role can reach in a real browser at phone width and reports what broke.
 *
 *   node --experimental-strip-types --no-warnings --import ./scripts/_ts-register.mjs \
 *     scripts/pg/click-through.ts [--base=http://localhost:3101] [--shots=<dir>] [--max=<n>]
 *     [--roles=owner,phone_sales] [--paths=/crm/23,/sales/today]   (a short list instead of the whole walk)
 *
 * Meant for a server running on the demo database (npm run seed:demo, then `next start`), once per
 * engine, to answer "does the app work on Postgres" with more than the unit tests can. It signs in
 * through the real login route as each demo login, walks that role's navigation (lib/appNav.ts) plus
 * a few detail pages, and fails on: a server error, a redirect away from the page, an uncaught page
 * error, a console error, a failed request, Next's error screen, or sideways scrolling.
 *
 * From each screen it follows the links it finds (two screens of each kind, so two customers, two
 * orders), up to --max=<n> screens per role. It only reads. Do not point it at a real database: the demo logins do not exist there, and it
 * refuses a base address that is not on this machine. */
import fs from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright";
import { appTabs } from "@/lib/appNav";
import type { Role } from "@/lib/roles";

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const BASE = (arg("base") ?? "http://localhost:3101").replace(/\/$/, "");
const SHOTS = arg("shots") ?? null;
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) {
  console.error(`Refusing ${BASE}: this only talks to a server on this machine.`);
  process.exit(2);
}

const ONLY_ROLES = arg("roles")?.split(",") ?? null;
const ONLY_PATHS = arg("paths")?.split(",") ?? null;
const PASSWORD = process.env.DEMO_PASSWORD;
if (!PASSWORD) {
  console.error("Set DEMO_PASSWORD to the password the demo database was seeded with.");
  process.exit(2);
}
const LOGINS: { username: string; role: Role }[] = [
  { username: "demo.platform", role: "platform_owner" },
  { username: "demo.owner", role: "owner" },
  { username: "demo.gm", role: "group_manager" },
  { username: "demo.rep_lead", role: "rep_manager" },
  { username: "demo.sales", role: "phone_sales" },
  { username: "demo.field", role: "field_rep" },
  { username: "demo.driver", role: "delivery_driver" },
];

/* A page that is not a tab but that every role opens. */
const EXTRA = ["/settings/security"];

/* Console noise that is the environment, not the app: map tiles and fonts come from hosts this
   machine cannot reach. */
const IGNORED = /tile\.openstreetmap|fonts\.(googleapis|gstatic)|ERR_(NAME_NOT_RESOLVED|INTERNET_DISCONNECTED|CONNECTION_REFUSED|TUNNEL)|favicon/i;

type Problem = { role: string; url: string; what: string };
const problems: Problem[] = [];
let visited = 0;

async function visit(page: Page, role: string, href: string): Promise<string[]> {
  const issues: string[] = [];
  let links: string[] = [];
  const onConsole = (m: { type(): string; text(): string }) => {
    /* A bare "Failed to load resource" names no address; failed requests are reported below with
       theirs, and server errors by the response handler. */
    if (m.type() === "error" && !/^Failed to load resource/.test(m.text()) && !IGNORED.test(m.text())) issues.push(`console: ${m.text().slice(0, 200)}`);
  };
  const onPageError = (e: Error) => issues.push(`page error: ${e.message.slice(0, 200)}`);
  const onResponse = (r: { status(): number; url(): string }) => {
    if (r.status() >= 500) issues.push(`HTTP ${r.status()} ${r.url().replace(BASE, "")}`);
  };
  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  const onRequestFailed = (r: { url(): string; failure(): { errorText: string } | null }) => {
    const url = r.url();
    if (url.startsWith(BASE) && !IGNORED.test(url) && r.failure()?.errorText !== "net::ERR_ABORTED") issues.push(`request failed ${url.replace(BASE, "")}: ${r.failure()?.errorText ?? ""}`);
  };
  page.on("response", onResponse);
  page.on("requestfailed", onRequestFailed);
  try {
    const res = await page.goto(`${BASE}${href}`, { waitUntil: "networkidle", timeout: 60_000 });
    const status = res?.status() ?? 0;
    const landed = new URL(page.url()).pathname;
    if (status >= 400) issues.push(`HTTP ${status}`);
    if (landed !== href && !landed.startsWith(href.split("?")[0])) issues.push(`redirected to ${landed}`);
    const broken = await page.evaluate(() => {
      const text = document.body?.innerText ?? "";
      return {
        errorScreen: !!document.querySelector("#__next_error__") || /Application error|This page couldn.t load|Internal Server Error/i.test(text),
        sideways: document.documentElement.scrollWidth > window.innerWidth + 1,
      };
    });
    links = await page.evaluate(() =>
      [...document.querySelectorAll("a[href]")].map((a) => (a as HTMLAnchorElement).href)
    );
    if (broken.errorScreen) issues.push("error screen");
    if (broken.sideways) issues.push("scrolls sideways");
    if (SHOTS) {
      fs.mkdirSync(path.join(SHOTS, role), { recursive: true });
      await page.screenshot({ path: path.join(SHOTS, role, `${href.replace(/\W+/g, "_") || "root"}.png`) });
    }
  } catch (e) {
    issues.push(`could not load: ${(e as Error).message.split("\n")[0]}`);
  } finally {
    page.off("console", onConsole);
    page.off("pageerror", onPageError);
    page.off("response", onResponse);
    page.off("requestfailed", onRequestFailed);
  }
  visited++;
  for (const what of issues) problems.push({ role, url: href, what });
  return links;
}

/** "/sales/customers/812" and "/sales/customers/9" are the same screen; one or two of each is enough. */
const shape = (href: string) => href.replace(/\d+/g, ":id");
const PER_SHAPE = 2;
const MAX_PER_ROLE = Number(arg("max") ?? 120);
/* Links that do something rather than show something. */
const SKIP = /^\/(api|logout|_next)\b|\.(png|jpg|jpeg|svg|pdf|csv|xlsx|ics)(\?|$)/;

function followable(link: string): string | null {
  let u: URL;
  try {
    u = new URL(link);
  } catch {
    return null;
  }
  if (u.origin !== BASE) return null;
  const href = `${u.pathname}${u.search}`;
  return SKIP.test(u.pathname) ? null : href;
}

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
try {
  for (const login of LOGINS.filter((l) => !ONLY_ROLES || ONLY_ROLES.includes(l.role))) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "fa-IR" });
    const res = await context.request.post(`${BASE}/api/login`, { data: { username: login.username, password: PASSWORD } });
    if (!res.ok()) {
      problems.push({ role: login.role, url: "/api/login", what: `sign-in failed: HTTP ${res.status()}` });
      await context.close();
      continue;
    }
    const page = await context.newPage();
    const queue = ONLY_PATHS ?? [...new Set([...appTabs({ role: login.role }).filter((t) => t.ready).map((t) => t.href), ...EXTRA])];
    const seen = new Set<string>();
    const perShape = new Map<string, number>();
    let opened = 0;
    while (queue.length > 0 && opened < MAX_PER_ROLE) {
      const href = queue.shift()!;
      const key = shape(href);
      if (seen.has(href) || (perShape.get(key) ?? 0) >= PER_SHAPE) continue;
      seen.add(href);
      perShape.set(key, (perShape.get(key) ?? 0) + 1);
      opened++;
      for (const link of await visit(page, login.role, href)) {
        if (ONLY_PATHS) break;
        const next = followable(link);
        if (next && !seen.has(next)) queue.push(next);
      }
    }
    await context.close();
  }
} finally {
  await browser.close();
}

console.log(`\n${visited} screens opened across ${LOGINS.length} roles.`);
if (problems.length === 0) {
  console.log("Nothing broke.");
} else {
  console.log(`${problems.length} problem(s):`);
  for (const p of problems) console.log(`  [${p.role}] ${p.url}  ${p.what}`);
  process.exitCode = 1;
}
