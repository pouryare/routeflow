import { describe, it, expect, beforeAll } from "vitest";
import crypto from "node:crypto";

beforeAll(() => {
  process.env.SESSION_SECRET = "test-secret-do-not-use-in-prod";
  process.env.APP_PASSWORD = "correct-horse-battery-staple";
});

const { createSessionToken, parseSessionToken, verifySessionToken, checkPassword, getActorName, hashPassword, verifyPassword } =
  await import("@/lib/auth");

describe("checkPassword", () => {
  it("accepts the configured password", () => {
    expect(checkPassword("correct-horse-battery-staple")).toBe(true);
  });
  it("rejects a wrong password", () => {
    expect(checkPassword("wrong")).toBe(false);
  });
  it("rejects a wrong password even the same length (timing-safe path)", () => {
    expect(checkPassword("correct-horse-battery-staplX")).toBe(false);
  });
});

describe("session tokens", () => {
  it("round-trips: a freshly created token verifies as valid", () => {
    const token = createSessionToken();
    expect(verifySessionToken(token)).toBe(true);
  });

  it("carries no name when none is given", () => {
    const token = createSessionToken();
    expect(parseSessionToken(token)?.name).toBeNull();
  });

  it("carries the actor name when one is given", () => {
    const token = createSessionToken("Pourya");
    expect(parseSessionToken(token)?.name).toBe("Pourya");
  });

  it("rejects a tampered payload", () => {
    const token = createSessionToken("Pourya");
    const dot = token.lastIndexOf(".");
    const tampered = `${token.slice(0, dot)}x${token.slice(dot)}`;
    expect(verifySessionToken(tampered)).toBe(false);
  });

  it("rejects a tampered signature", () => {
    const token = createSessionToken();
    const tampered = token.slice(0, -1) + (token.at(-1) === "0" ? "1" : "0");
    expect(verifySessionToken(tampered)).toBe(false);
  });

  it("rejects garbage input", () => {
    expect(verifySessionToken("not-a-real-token")).toBe(false);
    expect(verifySessionToken(undefined)).toBe(false);
    expect(verifySessionToken(null)).toBe(false);
    expect(verifySessionToken("")).toBe(false);
  });

  it("rejects an expired token", () => {
    // build a token with an already-past expiry, signed the same way createSessionToken does
    const pastExpiry = Math.floor(Date.now() / 1000) - 10;
    const payload = String(pastExpiry);
    const mac = crypto.createHmac("sha256", process.env.SESSION_SECRET!).update(payload).digest("hex");
    expect(verifySessionToken(`${payload}.${mac}`)).toBe(false);
  });
});

describe("hashPassword / verifyPassword", () => {
  it("verifies the correct password against its own hash", () => {
    const stored = hashPassword("s3cret-pass");
    expect(verifyPassword("s3cret-pass", stored)).toBe(true);
  });
  it("rejects a wrong password", () => {
    const stored = hashPassword("s3cret-pass");
    expect(verifyPassword("wrong-pass", stored)).toBe(false);
  });
  it("produces a different hash each time (random salt)", () => {
    expect(hashPassword("same-input")).not.toBe(hashPassword("same-input"));
  });
  it("rejects malformed stored values instead of throwing", () => {
    expect(verifyPassword("anything", "not-a-valid-hash")).toBe(false);
    expect(verifyPassword("anything", "")).toBe(false);
  });
});

describe("getActorName", () => {
  function fakeRequest(cookieValue: string | undefined) {
    return { cookies: { get: () => (cookieValue === undefined ? undefined : { value: cookieValue }) } };
  }

  it("reads the name back off a valid session cookie", () => {
    const token = createSessionToken("Sara");
    expect(getActorName(fakeRequest(token))).toBe("Sara");
  });
  it("returns null when there's no cookie", () => {
    expect(getActorName(fakeRequest(undefined))).toBeNull();
  });
  it("returns null for an invalid cookie rather than throwing", () => {
    expect(getActorName(fakeRequest("garbage"))).toBeNull();
  });
});
