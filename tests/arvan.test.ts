import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { arvanAllowUploads, arvanPointAt, arvanSetup, splitHost } from "@/lib/arvan";
import { checkDomain } from "@/lib/domainCheck";

describe("splitHost", () => {
  it("splits the root domain from the address name", () => {
    expect(splitHost("app.taminodis.ir")).toEqual({ root: "taminodis.ir", name: "app" });
    expect(splitHost("taminodis.ir")).toEqual({ root: "taminodis.ir", name: "@" });
    expect(splitHost("app.x.co.ir")).toEqual({ root: "x.co.ir", name: "app" });
    expect(splitHost("a.b.taminodis.ir")).toEqual({ root: "taminodis.ir", name: "a.b" });
  });
});

type Call = { method: string; url: string; body: unknown };

/** A tiny fake Arvan: remembers domains and A records, answers like the API's `{ data }` envelope. */
function fakeArvan(opts: { active?: boolean } = {}) {
  const calls: Call[] = [];
  const domains = new Map<string, { id: string; name: string }[]>();
  const rules: { filter_expr?: string }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });
    const path = new URL(url).pathname.replace("/cdn/4.0", "");
    const reply = (status: number, data?: unknown) => new Response(JSON.stringify({ data }), { status });
    if (method === "POST" && path === "/domains/dns-service") {
      domains.set(body.domain, []);
      return reply(201, {});
    }
    const m = /^\/domains\/([^/]+)(\/.*)?$/.exec(path);
    if (!m || !domains.has(m[1])) return reply(404);
    const recs = domains.get(m[1])!;
    if (!m[2]) return reply(200, { ns_keys: ["a.ns.arvancdn.ir", "b.ns.arvancdn.ir"], status: opts.active ? "active" : "pending" });
    if (m[2] === "/firewall/rules" && method === "GET") return reply(200, rules);
    if (m[2] === "/firewall/rules" && method === "POST") {
      rules.push(body);
      return reply(201, {});
    }
    if (m[2] === "/dns-records" && method === "GET") return reply(200, recs.map((r) => ({ ...r, type: "a" })));
    if (m[2] === "/dns-records" && method === "POST") {
      recs.push({ id: "r1", name: body.name });
      return reply(201, {});
    }
    return reply(200, {});
  });
  return { calls, rules };
}

beforeEach(() => {
  process.env.ARVAN_API_KEY = "test-key";
});
afterEach(() => vi.unstubAllGlobals());

describe("arvanSetup", () => {
  it("adds the domain, points the address at the server, turns HTTPS on and returns the nameservers", async () => {
    const { calls } = fakeArvan();
    const state = await arvanSetup("app.taminodis.ir", "185.1.2.3");
    expect(state).toEqual({ ns: ["a.ns.arvancdn.ir", "b.ns.arvancdn.ir"], active: false });
    const add = calls.find((c) => c.method === "POST" && c.url.endsWith("/domains/dns-service"));
    expect(add?.body).toMatchObject({ domain: "taminodis.ir", domain_type: "full" });
    const rec = calls.find((c) => c.method === "POST" && c.url.endsWith("/dns-records"));
    expect(rec?.body).toMatchObject({ type: "a", name: "app", cloud: true, value: [{ ip: "185.1.2.3" }] });
    expect(calls.some((c) => c.method === "PATCH" && c.url.endsWith("/ssl"))).toBe(true);
  });

  it("changes the existing record when the server moves, instead of adding a second one", async () => {
    const { calls } = fakeArvan();
    await arvanSetup("app.taminodis.ir", "185.1.2.3");
    await arvanPointAt("app.taminodis.ir", "185.9.9.9");
    const put = calls.find((c) => c.method === "PUT");
    expect(put?.url).toContain("/dns-records/r1");
    expect(put?.body).toMatchObject({ value: [{ ip: "185.9.9.9" }] });
    expect(calls.filter((c) => c.method === "POST" && c.url.endsWith("/dns-records"))).toHaveLength(1);
  });

  it("lets photo uploads past Arvan's firewall with a hyphen-free rule, once", async () => {
    const { calls, rules } = fakeArvan();
    await arvanSetup("app.taminodis.ir", "185.1.2.3");
    await arvanAllowUploads("app.taminodis.ir");
    const posts = calls.filter((c) => c.method === "POST" && c.url.endsWith("/firewall/rules"));
    expect(posts).toHaveLength(1);
    expect(rules[0]).toMatchObject({ name: "routeflowphotos", action: "allow", filter_expr: '((http.request.uri.path starts_with "/api/photos"))' });
    expect(String((posts[0].body as { name: string }).name)).toMatch(/^[A-Za-z0-9]+$/);
  });

  it("sends the key as an Apikey header", async () => {
    let auth = "";
    vi.stubGlobal("fetch", async (_u: string, init: RequestInit) => {
      auth = String((init.headers as Record<string, string>).Authorization);
      return new Response(JSON.stringify({ message: "no" }), { status: 401 });
    });
    await expect(arvanPointAt("app.x.ir", "1.2.3.4")).rejects.toThrow("آروان: no");
    expect(auth).toBe("Apikey test-key");
  });
});

describe("checkDomain with Arvan's state", () => {
  it("tells the owner to hand the nameservers to the customer while the domain is not active", async () => {
    const r = await checkDomain("nowhere.invalid", null, { ns: ["a.ns.arvancdn.ir", "b.ns.arvancdn.ir"], active: false });
    expect(r.status).toBe("waiting_dns");
    expect(r.error).toContain("a.ns.arvancdn.ir");
  });
  it("waits for Arvan when the domain is active but the address does not answer yet", async () => {
    const r = await checkDomain("nowhere.invalid", null, { ns: [], active: true });
    expect(r.status).toBe("waiting_arvan");
  });
});
