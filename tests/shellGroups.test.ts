import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";

/** The route-group split is a structural invariant, not a preference. A page in the
 *  wrong group either loses the shell it needs or gains chrome it must not have — a
 *  driver reading a briefing in a moving vehicle is the case that matters. Route groups
 *  do not change URLs, so nothing here asserts about paths; the build output does.
 */
describe("route groups", () => {
  const bare = ["driver", "login", "offline", "start", "password"];

  it("every bare route lives under app/(bare)", () => {
    for (const r of bare) {
      expect(existsSync(`app/(bare)/${r}`), `app/(bare)/${r} should exist`).toBe(true);
      expect(existsSync(`app/${r}`), `app/${r} should have moved`).toBe(false);
    }
  });

  it("the bare group has a layout that applies the palette and nothing else", () => {
    expect(existsSync("app/(bare)/layout.tsx")).toBe(true);
    const src = readFileSync("app/(bare)/layout.tsx", "utf8");
    expect(src, "must carry the design-system scope").toContain("meridian");
    expect(src, "must NOT mount the shell").not.toContain("AppShell");
  });

  const shell = ["sales", "map", "facilities", "gallery", "planner", "report", "leads", "settings"];

  it("every themed route lives under app/(shell)", () => {
    for (const r of shell) {
      expect(existsSync(`app/(shell)/${r}`), `app/(shell)/${r} should exist`).toBe(true);
      expect(existsSync(`app/${r}`), `app/${r} should have moved`).toBe(false);
    }
  });

  it("the redirect-only root page stays outside both groups", () => {
    // app/page.tsx renders no UI — it reads the session and redirects — so it needs no
    // shell, and putting it in a group would make the group own the home route.
    expect(existsSync("app/page.tsx")).toBe(true);
    expect(existsSync("app/(shell)/page.tsx")).toBe(false);
    expect(existsSync("app/(bare)/page.tsx")).toBe(false);
  });

  it("the bare layout is synchronous — nothing there may block a navigation", () => {
    const src = readFileSync("app/(bare)/layout.tsx", "utf8");
    expect(src).not.toMatch(/export default async function/);
    // The import, not the word: the file's own comment explains why it does not read
    // cookies, and a bare substring match would fail on the explanation.
    expect(src).not.toMatch(/^\s*import\s.*\bfrom\s+["']next\/headers["']/m);
  });
});
