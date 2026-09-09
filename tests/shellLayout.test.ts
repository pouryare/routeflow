import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";

/** Why this file exists.
 *
 *  From node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/layout.md,
 *  "Interaction with loading.js":
 *
 *    "Because loading.js sits below layout.js in the component hierarchy, it cannot show
 *     a fallback for uncached or runtime data access in the layout itself, such as
 *     calling cookies(), headers(), or making uncached fetches. Without Cache
 *     Components: The navigation will block until the layout finishes rendering, and the
 *     loading.js fallback will not be shown."
 *
 *  Cache Components is not enabled here (next.config.ts declares no cacheComponents), so
 *  an `await cookies()` in the shell layout blocks EVERY navigation on itself and
 *  silently turns every loading.tsx into dead code. That was the original
 *  page-transition freeze. It fails with no error and no warning — only a slow app — so
 *  it needs a test rather than a comment.
 */
describe("the shell layout is non-blocking", () => {
  const src = readFileSync("app/(shell)/layout.tsx", "utf8");

  it("is not an async component", () => {
    expect(src).not.toMatch(/export default async function/);
  });

  it("does not import next/headers", () => {
    expect(src).not.toMatch(/^\s*import\s.*\bfrom\s+["']next\/headers["']/m);
  });

  it("applies the meridian scope and mounts the shell", () => {
    expect(src).toContain("meridian");
    expect(src).toContain("AppShell");
  });
});

describe("the shell's session read is suspended", () => {
  const src = readFileSync("components/meridian/AppShell.tsx", "utf8");

  it("wraps the header in a Suspense boundary with a skeleton fallback", () => {
    expect(src).toContain("Suspense");
    expect(src).toContain("HeaderSkeleton");
  });

  it("the header is the async piece, not the shell", () => {
    const header = readFileSync("components/meridian/AppHeader.tsx", "utf8");
    expect(header).toMatch(/export default async function/);
    expect(header).toMatch(/from\s+["']next\/headers["']/);
    // The redirects moved to proxy.ts; a redirect inside a Suspense boundary fires
    // after streaming has begun, when the status code can no longer be set. Assert on
    // the import rather than the word — the file's comment explains the absence.
    expect(header).not.toMatch(/^\s*import\s*{[^}]*\bredirect\b/m);
  });

  it("the header skeleton reads no session of its own", () => {
    const sk = readFileSync("components/meridian/HeaderSkeleton.tsx", "utf8");
    expect(sk).not.toMatch(/from\s+["']next\/headers["']/);
    expect(sk).not.toMatch(/export default async function/);
  });
});

describe("the notification bell lives in the header", () => {
  it("the root layout no longer mounts it", () => {
    // It used to float at the bottom of every page from app/layout.tsx. The brief asked
    // for it beside the profile; the shell header is where that is.
    expect(readFileSync("app/layout.tsx", "utf8")).not.toContain("NotificationBell");
  });

  it("the shell header does", () => {
    expect(readFileSync("components/meridian/AppHeader.tsx", "utf8")).toContain("NotificationBell");
  });
});

describe("the map canvas keeps its dark identity", () => {
  it("globals.css pins the ground under data-surface=map", () => {
    expect(readFileSync("app/globals.css", "utf8")).toContain('[data-surface="map"]');
  });

  it("only the real canvas is marked — /facilities and /gallery are record pages", () => {
    // MASTER.md's Product-shape table groups them with the map, but neither renders a
    // map canvas: one is a form list, the other a photo grid. Darkening them under a
    // light skin would be a bug dressed as consistency.
    expect(readFileSync("app/(shell)/map/layout.tsx", "utf8")).toContain('data-surface="map"');
    for (const r of ["facilities", "gallery"]) {
      const p = `app/(shell)/${r}/layout.tsx`;
      if (existsSync(p)) expect(readFileSync(p, "utf8")).not.toContain('data-surface="map"');
    }
  });

  it("CoverageMap no longer roots a second meridian scope inside the shell's", () => {
    // A nested .meridian would redefine --bg back to the light value and defeat the
    // override above it. It is only ever rendered from app/(shell)/map/page.tsx.
    const src = readFileSync("components/CoverageMap.tsx", "utf8");
    expect(src).not.toMatch(/className="meridian /);
  });
});
