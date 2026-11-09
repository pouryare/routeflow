import { describe, it, expect, vi, beforeEach } from "vitest";

/** lib/prefsOnce.ts: one GET /api/prefs per page load, shared by its readers. */
describe("prefsOnce", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("sends one request for two readers", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, effects: "auto" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { prefsOnce } = await import("@/lib/prefsOnce");
    const [a, b] = await Promise.all([prefsOnce(), prefsOnce()]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a.data).toEqual({ ok: true, effects: "auto" });
    expect(b.status).toBe(200);
  });

  it("asks again after a failed request", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { prefsOnce } = await import("@/lib/prefsOnce");
    await expect(prefsOnce()).rejects.toThrow("offline");
    await expect(prefsOnce()).resolves.toMatchObject({ status: 200 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
