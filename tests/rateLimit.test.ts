import { describe, it, expect } from "vitest";
import { rateLimit, rateLimitReset } from "@/lib/rateLimit";

describe("rateLimit", () => {
  it("allows up to the configured max attempts, then blocks", () => {
    const key = `test-${Math.random()}`;
    for (let i = 0; i < 3; i++) {
      expect(rateLimit(key, 3, 60_000).allowed).toBe(true);
    }
    const fourth = rateLimit(key, 3, 60_000);
    expect(fourth.allowed).toBe(false);
    expect(fourth.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("tracks separate keys independently", () => {
    const a = `a-${Math.random()}`;
    const b = `b-${Math.random()}`;
    rateLimit(a, 1, 60_000);
    expect(rateLimit(a, 1, 60_000).allowed).toBe(false);
    expect(rateLimit(b, 1, 60_000).allowed).toBe(true);
  });

  it("resets a key on demand (e.g. after a successful login)", () => {
    const key = `reset-${Math.random()}`;
    rateLimit(key, 1, 60_000);
    expect(rateLimit(key, 1, 60_000).allowed).toBe(false);
    rateLimitReset(key);
    expect(rateLimit(key, 1, 60_000).allowed).toBe(true);
  });

  it("allows again once the window has fully elapsed", async () => {
    const key = `window-${Math.random()}`;
    expect(rateLimit(key, 1, 20).allowed).toBe(true);
    expect(rateLimit(key, 1, 20).allowed).toBe(false);
    await new Promise((r) => setTimeout(r, 30));
    expect(rateLimit(key, 1, 20).allowed).toBe(true);
  });
});

describe("clientKey", () => {
  const key = async (h: Record<string, string>) => {
    const { clientKey } = await import("@/lib/rateLimit");
    return clientKey({ headers: new Headers(h) });
  };
  it("uses the address the trusted proxy appended, not the first client-supplied value", async () => {
    expect(await key({ "x-forwarded-for": "6.6.6.6, 1.2.3.4" })).toBe("1.2.3.4");
    expect(await key({ "x-forwarded-for": "1.2.3.4" })).toBe("1.2.3.4");
  });
  it("falls back to x-real-ip, then to a shared key", async () => {
    expect(await key({ "x-real-ip": "9.9.9.9" })).toBe("9.9.9.9");
    expect(await key({})).toBe("unknown");
  });
});
