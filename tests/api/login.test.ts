import { describe, it, expect } from "vitest";

process.env.SESSION_SECRET = "test-secret";
process.env.APP_PASSWORD = "hunter2";

const { POST } = await import("@/app/api/login/route");
const { NextRequest } = await import("next/server");

function loginReq(password: string, ip: string) {
  return new NextRequest("http://localhost/api/login", {
    method: "POST",
    body: JSON.stringify({ password }),
    headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
  });
}

describe("POST /api/login", () => {
  it("accepts the correct password and sets a session cookie", async () => {
    const res = await POST(loginReq("hunter2", "9.9.9.1"));
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(res.headers.get("set-cookie")).toContain("coverage_session=");
  });

  it("rejects a wrong password", async () => {
    const res = await POST(loginReq("wrong", "9.9.9.2"));
    expect(res.status).toBe(401);
  });

  it("rate-limits repeated failed attempts from the same IP", async () => {
    const ip = "9.9.9.3";
    for (let i = 0; i < 5; i++) {
      await POST(loginReq("wrong", ip));
    }
    const res = await POST(loginReq("wrong", ip));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });

  it("does not rate-limit a different IP", async () => {
    const res = await POST(loginReq("wrong", "9.9.9.4"));
    expect(res.status).toBe(401);
  });

  it("a successful login resets the attempt counter for that IP", async () => {
    const ip = "9.9.9.5";
    for (let i = 0; i < 4; i++) {
      await POST(loginReq("wrong", ip));
    }
    const ok = await POST(loginReq("hunter2", ip));
    expect(ok.status).toBe(200);
    // would have been the 6th attempt (blocked) had the counter not reset
    const after = await POST(loginReq("wrong", ip));
    expect(after.status).toBe(401);
  });
});
