import { readFileSync } from "node:fs";
import vm from "node:vm";
import { expect, it, vi } from "vitest";

// Execute the real worker with browser API doubles, including its fetch routing.
function worker(cached?: Response, network = new Response("new module", { headers: { "Cache-Control": "no-store" } })) {
  const handlers: Record<string, (event: unknown) => void> = {};
  const cache = { match: vi.fn(async () => cached), put: vi.fn(async () => {}), delete: vi.fn(async () => true) };
  const fetch = vi.fn(async () => network);
  vm.runInNewContext(readFileSync(new URL("../public/sw.js", import.meta.url), "utf8"), {
    self: { addEventListener: (name: string, handler: (event: unknown) => void) => { handlers[name] = handler; } },
    caches: { open: async () => cache }, fetch, URL, Response,
  });
  async function request() {
    let response: Promise<Response> | undefined;
    handlers.fetch({ request: new Request("http://localhost:4000/_next/static/chunks/profile.js"), respondWith: (r: Promise<Response>) => { response = r; } });
    return await response!;
  }
  return { cache, fetch, request };
}

it("evicts stale development chunks and fetches their current module factories", async () => {
  const w = worker(new Response("old module", { headers: { "Cache-Control": "no-store, must-revalidate" } }));
  expect(await (await w.request()).text()).toBe("new module");
  expect(w.cache.delete).toHaveBeenCalledOnce();
  expect(w.fetch).toHaveBeenCalledOnce();
  expect(w.cache.put).not.toHaveBeenCalled();
});
it("does not cache a fresh development chunk", async () => {
  const w = worker();
  await w.request();
  expect(w.cache.put).not.toHaveBeenCalled();
});
it("keeps immutable production chunks available offline", async () => {
  const w = worker(new Response("production module", { headers: { "Cache-Control": "public, max-age=31536000, immutable" } }));
  w.fetch.mockRejectedValue(new Error("offline"));
  expect(await (await w.request()).text()).toBe("production module");
  expect(w.fetch).not.toHaveBeenCalled();
});
it("stores newly fetched immutable production chunks", async () => {
  const w = worker(undefined, new Response("production module", { headers: { "Cache-Control": "public, max-age=31536000, immutable" } }));
  await w.request();
  expect(w.cache.put).toHaveBeenCalledOnce();
});
it("never falls back to an obsolete dev chunk when offline", async () => {
  const w = worker(new Response("old module"));
  w.fetch.mockRejectedValue(new Error("offline"));
  expect((await w.request()).type).toBe("error");
});
