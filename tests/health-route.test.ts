import { describe, it, expect } from "vitest";
import { GET } from "@/app/api/health/route";
import pkg from "@/package.json";

describe("/api/health", () => {
  it("answers ok with the running version when the database answers", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      version: pkg.version,
      // This server's live streams (issue #58): none open in a test.
      live: { listening: false, streams: 0, people: 0, delivered: 0, dropped: 0 },
    });
  });
});
