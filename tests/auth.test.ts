import { describe, it, expect, beforeAll } from "vitest";
import crypto from "node:crypto";

beforeAll(() => {
  process.env.SESSION_SECRET = "test-secret-do-not-use-in-prod";
});

const { createSessionToken, parseSessionToken, verifySessionToken, hashPassword, verifyPassword, COOKIE_NAME } =
  await import("@/lib/auth");

describe("session tokens", () => {
  const base = { uid: 7, role: "group_manager" as const, gid: 3, oid: 1, tv: 0, name: "سارا" };

  it("round-trips every claim", () => {
    const token = createSessionToken(base);
    const claims = parseSessionToken(token);
    expect(claims?.uid).toBe(7);
    expect(claims?.role).toBe("group_manager");
    expect(claims?.gid).toBe(3);
    expect(claims?.oid).toBe(1);
    expect(claims?.tv).toBe(0);
    expect(claims?.name).toBe("سارا");
  });

  it("carries a null group for an owner", () => {
    const token = createSessionToken({ ...base, role: "owner", gid: null });
    expect(parseSessionToken(token)?.gid).toBeNull();
  });

  it("verifies a freshly created token", () => {
    expect(verifySessionToken(createSessionToken(base))).toBe(true);
  });

  it("rejects a tampered payload", () => {
    const token = createSessionToken(base);
    const dot = token.lastIndexOf(".");
    expect(verifySessionToken(`${token.slice(0, dot)}x${token.slice(dot)}`)).toBe(false);
  });

  it("rejects a tampered signature", () => {
    const token = createSessionToken(base);
    const tampered = token.slice(0, -1) + (token.at(-1) === "0" ? "1" : "0");
    expect(verifySessionToken(tampered)).toBe(false);
  });

  it("cannot be escalated by editing the role claim", () => {
    const token = createSessionToken(base);
    const [payload, mac] = token.split(".");
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    claims.role = "owner";
    const forged = `${Buffer.from(JSON.stringify(claims)).toString("base64url")}.${mac}`;
    expect(verifySessionToken(forged)).toBe(false);
    expect(parseSessionToken(forged)).toBeNull();
  });

  it("rejects garbage input", () => {
    expect(verifySessionToken("not-a-real-token")).toBe(false);
    expect(verifySessionToken(undefined)).toBe(false);
    expect(verifySessionToken(null)).toBe(false);
    expect(verifySessionToken("")).toBe(false);
  });

  it("rejects an expired token", () => {
    const claims = { uid: 1, role: "owner", gid: null, tv: 0, name: "x", exp: Math.floor(Date.now() / 1000) - 10 };
    const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
    const mac = crypto.createHmac("sha256", process.env.SESSION_SECRET!).update(payload).digest("hex");
    expect(verifySessionToken(`${payload}.${mac}`)).toBe(false);
  });

  it("uses the v2 cookie name", () => {
    expect(COOKIE_NAME).toBe("coverage_session_v2");
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

describe("weakSecretReason", () => {
  it("accepts a long secret and names the problem with a missing or short one", async () => {
    const { weakSecretReason, MIN_SECRET_LENGTH } = await import("@/lib/auth");
    expect(MIN_SECRET_LENGTH).toBe(32);
    expect(weakSecretReason("x".repeat(32))).toBeNull();
    expect(weakSecretReason(undefined)).toMatch(/not set/);
    expect(weakSecretReason("")).toMatch(/not set/);
    expect(weakSecretReason("x".repeat(31))).toMatch(/31 characters.*at least 32/);
  });
});
