import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ROLES } from "@/lib/roles";
import { appTabs } from "@/lib/appNav";
import { accountLinks } from "@/lib/accountLinks";
import { driverLinks } from "@/lib/driverLinks";
import { quickActionsFor } from "@/lib/mobileNav";

/** Every page must be reachable: a nav destination for some role, linked from code that
 *  renders (a list, a sheet, a menu), or listed below with the reason it needs no link.
 *
 *  Written after the 2026-10-23 audit found /sales/admin/holidays, a working owner screen
 *  with a title and an overview, that nothing in the app linked to. Tests, typecheck and
 *  lint were all green; the only way to find it was to try to click your way there. */
const NO_LINK_NEEDED: Record<string, string> = {
  "/": "The front door: sends each role to its home (app/page.tsx).",
  "/login": "Where proxy.ts sends anyone without a session.",
  "/password": "Where proxy.ts sends a session whose password an owner chose (F35).",
  "/offline": "Served by the service worker when there is no connection (public/sw.js).",
};

const ROOT = process.cwd();

function* walk(dir: string): Generator<string> {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

/** app/(shell)/sales/orders/[id]/page.tsx → /sales/orders/[id] */
const routeOf = (file: string) =>
  "/" +
  path
    .relative(path.join(ROOT, "app"), path.dirname(file))
    .split(path.sep)
    .filter((seg) => seg && !/^\(.*\)$/.test(seg))
    .join("/");

const pages = [...walk(path.join(ROOT, "app"))].filter((f) => path.basename(f) === "page.tsx");
const routes = pages.map(routeOf).map((r) => (r === "/" ? "/" : r.replace(/\/$/, "")));

const navHrefs = new Set<string>();
for (const role of ROLES) {
  for (const t of appTabs({ role })) if (t.ready) navHrefs.add(t.href);
  for (const l of accountLinks({ role })) navHrefs.add(l.href);
  for (const l of driverLinks({ role })) navHrefs.add(l.href);
  for (const a of quickActionsFor({ role })) if (a.href) navHrefs.add(a.href.split("?")[0]);
}

/** Files that name every route without linking to any: the page titles, and the nav model
 *  (whose links are counted above, per role, only when `ready`). */
const NOT_LINKS = new Set(["lib/pageMeta.ts", "lib/appNav.ts"]);

/** Source that can render a link: everything under components/, app/ and lib/, minus tests. */
const sources = [...walk(path.join(ROOT, "components")), ...walk(path.join(ROOT, "app")), ...walk(path.join(ROOT, "lib"))]
  .filter((f) => /\.(tsx?|mjs)$/.test(f) && !NOT_LINKS.has(path.relative(ROOT, f)))
  .map((f) => ({ file: path.relative(ROOT, f), text: fs.readFileSync(f, "utf8") }));

/** A literal that names the route: "/x/y", `/x/y?..`, `/x/${id}` for a [segment]. */
function linkedFrom(route: string): string[] {
  const body = route
    .split("/")
    .map((seg) => (/^\[.*\]$/.test(seg) ? "\\$\\{[^}]+\\}" : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    .join("/");
  const re = new RegExp(`["'\`]${body}(?:["'\`?#/]|\\$\\{)`);
  return sources
    .filter((s) => re.test(s.text))
    // A page linking to itself (a pager, its own tabs) does not make it reachable; nor does
    // its own folder (loading.tsx, layout.tsx).
    .filter((s) => !(s.file.startsWith("app/") && routeOf(path.join(ROOT, s.file)) === route))
    .map((s) => s.file);
}

describe("every page is reachable", () => {
  it("finds the pages at all (guards the walker)", () => {
    expect(routes.length).toBeGreaterThan(40);
    expect(routes).toContain("/sales/orders/[id]");
    expect(routes).toContain("/sales/admin/holidays");
  });

  it("each page is in the nav, linked from somewhere, or listed with a reason", () => {
    const orphans = routes.filter((r) => !navHrefs.has(r) && !NO_LINK_NEEDED[r] && linkedFrom(r).length === 0);
    expect(orphans, `no way to reach:\n${orphans.join("\n")}`).toEqual([]);
  });

  it("every exemption names a page that exists, and gives a reason", () => {
    for (const [r, why] of Object.entries(NO_LINK_NEEDED)) {
      expect(routes, r).toContain(r);
      expect(why.length, r).toBeGreaterThan(20);
    }
  });
});
