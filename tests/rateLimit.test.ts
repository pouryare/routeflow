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
