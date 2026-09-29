import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/** The vehicle screens are where the geolocation watch matters most, and they are also
 *  where it was missing.
 *
 *  MyPositionProvider was mounted only in app/(shell)/layout.tsx. /driver lives in
 *  app/(bare), which mounted nothing -- so useMyPosition() on /driver returned the
 *  context's DEFAULT value, { position: null, status: "idle", retry: () => {} }.
 *
 *  Nothing threw. useContext on an unprovided context returns the default, so a missing
 *  provider is indistinguishable from real data: VerifyVisits recorded every visit with
 *  pos = null, and a NextStopBanner shows no distance. A page that renders perfectly and
 *  lies. This file is a source-text assertion, in the style of tests/shellGroups.test.ts,
 *  because the failure mode has no exception to catch. */
describe("the bare group has a position", () => {
  const src = readFileSync("app/(bare)/layout.tsx", "utf8");

  it("mounts MyPositionProvider", () => {
    expect(src, "app/(bare)/layout.tsx must mount MyPositionProvider").toContain("MyPositionProvider");
  });

  it("wraps children in it rather than importing it and doing nothing", () => {
    // The import alone would satisfy the test above while the page still got nothing --
    // an unused import is exactly what a half-finished edit looks like.
    expect(src).toMatch(/<MyPositionProvider>[\s\S]*\{children\}[\s\S]*<\/MyPositionProvider>/);
  });

  it("still stays synchronous -- the provider is a client component, not an await", () => {
    // tests/shellGroups.test.ts:43-49 already asserts the layout is not async and does not
    // import next/headers. Repeated here so this file fails on its own terms if it is the
    // only one run.
    expect(src).not.toMatch(/export default async function/);
    expect(src).not.toMatch(/^\s*import\s.*\bfrom\s+["']next\/headers["']/m);
  });
});
