import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/* Guards the shape that keeps the redirect loop-free; the behaviour itself is checked against a
   running build. */
describe("/login redirects a signed-in user, safely", () => {
  const src = readFileSync("app/(bare)/login/layout.tsx", "utf8");
  it("decides on the database-checked session, never on the cookie signature alone", () => {
    expect(src).toContain("getSessionFromCookies(");
    expect(src).not.toContain("parseSessionToken");
  });
  it("sends the person to their role's home", () => {
    expect(src).toMatch(/redirect\(homePathFor\(session\.role\)\)/);
  });
  it("every page that bounces to /login does so on the same session test", () => {
    // If a page redirected a DB-valid session to /login, the two would loop.
    const files = ["app/(shell)/layout.tsx", "app/(bare)/driver/page.tsx", "app/(bare)/today/page.tsx"];
    for (const f of files) {
      const s = readFileSync(f, "utf8");
      for (const m of s.matchAll(/([^\n]*)redirect\("\/login"\)/g)) expect(m[1]).toMatch(/!session|!sess/);
    }
  });
});
