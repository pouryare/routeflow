import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Every page inside the shell shows its sibling tabs, and no layout blocks navigation.
 *
 *  PageHeader is async — it reads the session to know which siblings a role may actually
 *  reach — so a "use client" page cannot import it. Seven pages quietly fell back to the
 *  tab-less PageHeaderCard and lost their in-page navigation entirely. A whole nav row
 *  missing on a fifth of the app, and 1,930 tests had nothing to say about it.
 *
 *  A page satisfies the first rule by importing PageHeader itself, or by having any
 *  ancestor layout inside app/(shell) that does.
 */
const ROOT = join(__dirname, "..");
const IMPORTS_HEADER = /from\s*["']@\/components\/meridian\/PageHeader["']/;

/** Pages that legitimately have no page-overview card. Named individually, with the
 *  reason, rather than matched by a pattern — an exemption nobody can see is how the
 *  seven missing headers survived in the first place.
 */
const EXEMPT: Record<string, string> = {
  "app/(shell)/sales/analysis/page.tsx":
    "A ten-line redirect to /sales/dashboard. It renders nothing, so there is nothing to head.",
  "app/(shell)/sales/orders/[id]/page.tsx":
    "A detail view of ONE order. The overview card prints the section's title and blurb, " +
    "which would be the wrong copy over a single record. Giving detail routes a header of " +
    "their own — titled by the record — is a design question, not a correctness fix.",
  "app/(shell)/sales/reps/[id]/page.tsx": "Same as orders/[id]: a record, not a section.",
};

/** Strips block and line comments.
 *
 *  Without this, the Suspense rule below matched the phrase "<Suspense> is load-bearing"
 *  in each layout's own doc comment and passed for a file that had no Suspense in its
 *  JSX at all. A test that is satisfied by prose about the rule, rather than by the rule,
 *  is worse than no test: it reports success precisely where it is needed.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*\/\//.test(l))
    .join("\n");
}

/** Walks the filesystem, deliberately NOT `git ls-files`.
 *
 *  git only lists TRACKED files, so a brand-new layout is invisible to this test until it
 *  is staged — which means the Suspense rule below would not be enforced on the very
 *  commit that introduces the file it is meant to police. That is exactly backwards, and
 *  it is how this test first "passed" against a layout that had no Suspense at all.
 *
 *  app/ is small and contains no build output, so a plain recursive walk is both correct
 *  and fast.
 */
function shellFiles(basename: string): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const entry of readdirSync(join(ROOT, rel), { withFileTypes: true })) {
      const child = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(child);
      else if (entry.name === basename) out.push(child);
    }
  };
  walk("app/(shell)");
  return out.sort();
}

/** Walk up from the page to app/(shell), looking for a layout that supplies the header. */
function coveredByAncestorLayout(page: string): boolean {
  let dir = dirname(page);
  while (dir.startsWith("app/(shell)")) {
    const layout = join(ROOT, dir, "layout.tsx");
    if (existsSync(layout) && IMPORTS_HEADER.test(readFileSync(layout, "utf8"))) return true;
    dir = dirname(dir);
  }
  return false;
}

describe("shell pages keep their sibling tabs", () => {
  it("every (shell) page resolves a PageHeader", () => {
    const offenders = shellFiles("page.tsx").filter(
      (p) =>
        !(p in EXEMPT) &&
        !IMPORTS_HEADER.test(readFileSync(join(ROOT, p), "utf8")) &&
        !coveredByAncestorLayout(p),
    );
    expect(
      offenders,
      `add a layout.tsx rendering <PageHeader route="…" /> inside <Suspense>:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("a layout that renders PageHeader wraps it in Suspense", () => {
    /* Next's own layout.js docs: "Because loading.js sits below layout.js in the component
       hierarchy, it cannot show a fallback for uncached or runtime data access in the
       layout itself, such as calling cookies()." PageHeader awaits cookies().

       Without its own boundary, such a layout blocks EVERY navigation into the route and
       loading.tsx silently never renders — a slow app with no error, which is the exact
       failure the app-shell slice was built to remove. So the fix for the missing tabs
       must not be allowed to reintroduce it. */
    const offenders = shellFiles("layout.tsx").filter((l) => {
      const src = stripComments(readFileSync(join(ROOT, l), "utf8"));
      return IMPORTS_HEADER.test(src) && !/<Suspense[\s>]/.test(src);
    });
    expect(offenders, `wrap <PageHeader> in <Suspense>:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("every exemption still names a file that exists", () => {
    /* An exemption for a deleted page is a hole waiting for a new page to fall into. */
    const missing = Object.keys(EXEMPT).filter((p) => !existsSync(join(ROOT, p)));
    expect(missing, `stale exemptions — delete these entries:\n${missing.join("\n")}`).toEqual([]);
  });
});
