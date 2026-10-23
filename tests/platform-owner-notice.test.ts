import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/* Spec §4.3 / P9: /driver and /start give a platform_owner a NOTICE, not a redirect.
 *
 * A redirect answers "you may not" without saying what to do instead, and for the founder
 * the answer is always one action away. The proxy exemption is the load-bearing half: without
 * it the request is bounced before the page loads and the notice never renders — which is
 * exactly the kind of half-implemented feature that looks done. */

const read = (p: string) => readFileSync(p, "utf8");

describe("the non-driver notice", () => {
  it("/driver offers it to a platform_owner and still bounces everyone else", () => {
    const src = read("app/(bare)/driver/page.tsx");
    expect(src).toMatch(/session\.role === "platform_owner"\) return <NotAVanNotice \/>/);
    // The redirect survives, and is NOT the platform_owner branch.
    expect(src).toMatch(/redirect\("\/map"\)/);
  });

  it("/start offers it too, and the multi-role picker case is left alone", () => {
    const src = read("app/(bare)/start/page.tsx");
    expect(src).toMatch(/session\.role === "platform_owner"\) return <NotAVanNotice \/>/);
    expect(src).toMatch(/session\.roles\.length < 2/);
  });

  it("the proxy lets a platform_owner through, or the notice never renders", () => {
    const src = read("proxy.ts");
    expect(src).toMatch(
      /isDriver && !isVanRole\(claims\.role\) && claims\.role !== "platform_owner"\)/
    );
  });

  it("the notice is scoped to platform_owner, never opened up to every manager", () => {
    /* The MANAGE_ROLES lesson, applied on purpose: widening this to owners and group
       managers would be the same mistake in a different place. */
    for (const f of ["app/(bare)/driver/page.tsx", "app/(bare)/start/page.tsx", "proxy.ts"]) {
      const src = read(f);
      expect(src, f).not.toMatch(/NotAVanNotice[\s\S]{0,200}group_manager/);
    }
  });

  it("the notice offers a way forward, not just a refusal", () => {
    const src = read("components/meridian/NotAVanNotice.tsx");
    expect(src).toContain('href="/switch"');
    expect(src).toContain('href="/sales"');
  });
});
