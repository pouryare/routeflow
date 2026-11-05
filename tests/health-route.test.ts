import { describe, it, expect } from "vitest";
import { GET } from "@/app/api/health/route";
import pkg from "@/package.json";

describe("/api/health", () => {
  it("answers ok with the running version when the database answers", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, version: pkg.version });
  });
});
