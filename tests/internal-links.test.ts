import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { customerHref } from "@/lib/deepLink";

/** Every in-app link and redirect lands on a page that exists.
 *
 *  Two dead ends were found by reading the nav, not by any test: login sent a
 *  platform_owner to /platform, which was never built, and six «open this customer»
 *  links in the action center, the briefing and the churn list pointed at
 *  /sales/customers/<id>, which was never built either. Both 404ed in production.
 *
 *  So the rule is on the whole class: collect every literal path handed to `href`,
 *  `redirect()`, `deny()` or `router.push()` across app/, components/ and lib/, and match
 *  it against the route tree. A `${…}` segment matches a dynamic `[param]` directory.
 */
const ROOT = join(__dirname, "..");

type Route = string[]; // segments; "*" for a dynamic directory

function routes(dir: string, base: Route = []): Route[] {
  const out: Route[] = [];
  if (existsSync(join(dir, "page.tsx")) || existsSync(join(dir, "route.ts"))) out.push(base);
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    if (e.name.startsWith("(")) out.push(...routes(join(dir, e.name), base));
    else out.push(...routes(join(dir, e.name), [...base, e.name.startsWith("[") ? "*" : e.name]));
  }
  return out;
}

function sourceFiles(rel: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(join(ROOT, rel), { withFileTypes: true })) {
    const child = `${rel}/${e.name}`;
    if (e.isDirectory()) out.push(...sourceFiles(child));
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(child);
  }
  return out;
}

/** `href="/x"`, `href: "/x"`, `href={\`/x/${id}\`}`, `redirect("/x")`, `deny("/x")`,
 *  `router.push("/x")`. Only paths that start with "/" — a computed href is not a literal. */
const LINK = /(?:\bhref\s*[:=]\s*\{?\s*|\b(?:redirect|deny|push|replace)\(\s*)(["'`])(\/[^"'`]*)\1/g;

function targets(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(LINK)) out.push(m[2]);
  return out;
}

/** "/sales/orders/${o.id}?tab=x#y" → ["sales","orders","${}"].
 *  A `${…}` that IS a segment stands in for a dynamic [param]; one glued onto the end of
 *  a segment is a query string built at runtime — `/map${buildMapLink(…)}` is /map. */
function segments(path: string): string[] {
  return path
    .split(/[?#]/)[0]
    .split("/")
    .filter(Boolean)
    .map((s) => (s.startsWith("${") ? "${}" : s.split("${")[0]));
}

const TREE = routes(join(ROOT, "app"));
const PUBLIC = new Set(readdirSync(join(ROOT, "public")));

function resolves(path: string): boolean {
  const segs = segments(path);
  if (segs.length === 1 && PUBLIC.has(segs[0])) return true;
  if (segs[0] === "_next") return true;
  return TREE.some(
    (r) => r.length === segs.length && r.every((s, i) => s === "*" || s === segs[i] || segs[i] === "${}"),
  );
}

describe("internal links", () => {
  it("finds the route tree and the links at all (guards the walkers)", () => {
    expect(TREE.length).toBeGreaterThan(40);
    const all = ["app", "components", "lib"].flatMap(sourceFiles).flatMap((f) => targets(readFileSync(join(ROOT, f), "utf8")));
    expect(all.length).toBeGreaterThan(50);
    expect(all).toContain("/login");
  });

  it("every literal href, redirect and push lands on a real page", () => {
    const dead: string[] = [];
    for (const f of ["app", "components", "lib"].flatMap(sourceFiles)) {
      for (const t of targets(readFileSync(join(ROOT, f), "utf8"))) {
        if (!resolves(t)) dead.push(`${f}: ${t}`);
      }
    }
    expect(dead, `links to pages that do not exist:\n${dead.join("\n")}`).toEqual([]);
  });

  it("the matcher itself rejects a path with no page", () => {
    expect(resolves("/platform")).toBe(false);
    expect(resolves("/sales/customers/${c.id}")).toBe(false);
    expect(resolves("/sales/orders/${o.id}")).toBe(true);
  });
});

describe("customerHref", () => {
  it("opens the customer's file on the map, the one page that shows it", () => {
    expect(customerHref(42)).toBe("/map?c=42");
    expect(resolves(customerHref(42))).toBe(true);
  });
});
