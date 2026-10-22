import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";

/* The server fetches, and drives a headless browser to, links staff paste. Everything here is
 * about what that server may reach: only the map services, never an internal address, at every
 * redirect hop (architecture audit, step 1.B). */

const { isPrivateOrLocalHost, isAllowedHop, browserRequestAllowed } = await import("@/lib/geoLinks");

describe("isPrivateOrLocalHost", () => {
  it.each([
    "127.0.0.1", "127.8.8.8", "localhost", "LOCALHOST.", "foo.localhost", "0.0.0.0", "0.1.2.3",
    "10.1.2.3", "172.16.0.1", "172.31.9.9", "192.168.0.1", "169.254.169.254",
    "100.64.0.1", "100.127.255.254", "198.18.0.1",
    "::1", "::", "[::1]", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:a00:1", "::ffff:c0a8:101", "::ffff:a9fe:a9fe",
    "0:0:0:0:0:ffff:7f00:1", "fc00::1", "fd12:3456::1", "fe80::1",
    "intranet", "db", "printer.local", "metadata.internal", "nas.lan", "x.home.arpa",
  ])("flags %s", (h) => expect(isPrivateOrLocalHost(h), h).toBe(true));

  it.each([
    "8.8.8.8", "172.15.0.1", "172.32.0.1", "100.63.0.1", "100.128.0.1", "198.20.0.1",
    "maps.google.com", "www.google.com", "goo.gl", "maps.app.goo.gl", "neshan.org",
    "::ffff:808:808", "2001:4860:4860::8888",
  ])("does not flag %s", (h) => expect(isPrivateOrLocalHost(h), h).toBe(false));

  it("sees through the numeric spellings once URL has normalised them", () => {
    for (const spelled of ["http://2130706433/", "http://0x7f.1/", "http://017700000001/", "http://127.1/"]) {
      expect(isPrivateOrLocalHost(new URL(spelled).hostname), spelled).toBe(true);
    }
    expect(isPrivateOrLocalHost(new URL("http://[::ffff:127.0.0.1]/").hostname)).toBe(true);
  });
});

describe("isAllowedHop (every redirect hop must be an allowed map service)", () => {
  it.each([
    "https://www.google.com/maps/place/x", "https://maps.app.goo.gl/abc", "https://goo.gl/maps/x",
    "https://nshn.ir/x", "https://neshan.org/maps", "https://balad.ir/p", "https://waze.com/ul",
  ])("allows %s", (u) => expect(isAllowedHop(new URL(u)), u).toBe(true));

  it.each([
    "http://127.0.0.1/", "http://169.254.169.254/latest/meta-data/", "http://[::ffff:7f00:1]/",
    "https://evil.example.com/", "https://google.com.evil.example.com/", "https://evilgoogle.com/",
    "https://example.com/?next=https://google.com", "ftp://www.google.com/", "file:///etc/passwd",
    "javascript:alert(1)", "https://user@evil.example.com/",
  ])("refuses %s", (u) => expect(isAllowedHop(new URL(u)), u).toBe(false));
});

describe("browserRequestAllowed", () => {
  it("lets a navigation stay on the allow-list and nowhere else", () => {
    expect(browserRequestAllowed("https://www.google.com/maps/place/x", true)).toBe(true);
    expect(browserRequestAllowed("https://evil.example.com/", true)).toBe(false);
    expect(browserRequestAllowed("http://127.0.0.1:3003/api/me", true)).toBe(false);
    expect(browserRequestAllowed("file:///etc/passwd", true)).toBe(false);
    expect(browserRequestAllowed("data:text/html,<script>1</script>", true)).toBe(false);
    expect(browserRequestAllowed("about:blank", true)).toBe(true);
    expect(browserRequestAllowed("not a url", true)).toBe(false);
  });

  it("lets sub-resources come from other public hosts, but never from inside", () => {
    expect(browserRequestAllowed("https://www.gstatic.com/maps/x.js", false)).toBe(true);
    expect(browserRequestAllowed("https://fonts.googleapis.com/css", false)).toBe(true);
    expect(browserRequestAllowed("data:image/png;base64,AAAA", false)).toBe(true);
    expect(browserRequestAllowed("http://127.0.0.1:3003/api/me", false)).toBe(false);
    expect(browserRequestAllowed("http://169.254.169.254/latest/meta-data/", false)).toBe(false);
    expect(browserRequestAllowed("http://[::ffff:7f00:1]/", false)).toBe(false);
    expect(browserRequestAllowed("http://intranet/", false)).toBe(false);
    expect(browserRequestAllowed("file:///etc/passwd", false)).toBe(false);
  });
});

describe("installRequestGuard (fake route)", () => {
  type FakeRoute = ReturnType<typeof fake>;

  async function guard(): Promise<(route: FakeRoute) => Promise<void>> {
    const { installRequestGuard } = await import("@/lib/playwrightExtract");
    let handler!: (route: unknown) => Promise<void>;
    await installRequestGuard({ route: async (_p: unknown, h: unknown) => void (handler = h as typeof handler) } as never);
    return (route) => handler(route);
  }
  const fake = (url: string, nav: boolean, upstream: { status: number; location?: string } = { status: 200 }) => {
    const route = {
      request: () => ({ url: () => url, isNavigationRequest: () => nav }),
      abort: vi.fn(async () => {}),
      continue: vi.fn(async () => {}),
      fetch: vi.fn(async () => ({ status: () => upstream.status, headers: () => (upstream.location ? { location: upstream.location } : {}) })),
      fulfill: vi.fn(async () => {}),
    };
    return route;
  };

  it("passes an allowed navigation through (fetched without following redirects) and aborts a blocked one", async () => {
    const h = await guard();
    const ok = fake("https://www.google.com/maps/x", true);
    await h(ok);
    expect(ok.fetch).toHaveBeenCalledWith({ maxRedirects: 0 });
    expect(ok.fulfill).toHaveBeenCalledTimes(1);
    expect(ok.abort).not.toHaveBeenCalled();

    for (const [url, nav] of [["https://evil.example.com/", true], ["http://127.0.0.1/", false], ["http://127.0.0.1/", true]] as const) {
      const r = fake(url, nav);
      await h(r);
      expect(r.abort, url).toHaveBeenCalledTimes(1);
      expect(r.fetch).not.toHaveBeenCalled();
    }
  });

  it("continues an allowed sub-resource untouched", async () => {
    const r = fake("https://www.gstatic.com/x.js", false);
    await (await guard())(r);
    expect(r.continue).toHaveBeenCalledTimes(1);
    expect(r.fetch).not.toHaveBeenCalled();
  });

  it("vets the target of a 3xx: allowed becomes a navigating stub, anything else is aborted", async () => {
    const h = await guard();
    const good = fake("https://maps.app.goo.gl/abc", true, { status: 302, location: "https://www.google.com/maps/place/x" });
    await h(good);
    expect(good.abort).not.toHaveBeenCalled();
    const body = (good.fulfill.mock.calls[0] as unknown as [{ body: string }])[0].body;
    expect(body).toContain("location.replace(\"https://www.google.com/maps/place/x\")");

    for (const location of ["http://127.0.0.1:3003/api/me", "http://[::ffff:7f00:1]/", "https://evil.example.com/", "file:///etc/passwd", "http://169.254.169.254/"]) {
      const bad = fake("https://maps.app.goo.gl/abc", true, { status: 301, location });
      await h(bad);
      expect(bad.abort, location).toHaveBeenCalledTimes(1);
      expect(bad.fulfill, location).not.toHaveBeenCalled();
    }
  });

  it("keeps a hostile Location from breaking out of the stub script", async () => {
    const h = await guard();
    const r = fake("https://maps.app.goo.gl/abc", true, { status: 302, location: "https://www.google.com/</script><script>alert(1)//" });
    await h(r);
    const body = (r.fulfill.mock.calls[0] as unknown as [{ body: string }])[0].body;
    expect(body.match(/<\/script>/g)).toHaveLength(1);
  });
});

/* A real Chromium against real servers, to prove the MECHANISM: that every hop of a genuine HTTP
 * redirect chain goes through the guard. (The policy itself, which hosts count as allowed, is the
 * pure functions tested above; here "allowed" is 127.0.0.1 and "internal" is localhost, because
 * both resolve with no DNS.) Skipped where no browser is installed: CI installs none, this
 * container has one at /opt/pw-browsers/chromium. */
const CHROMIUM = "/opt/pw-browsers/chromium";
describe.skipIf(!fs.existsSync(CHROMIUM))("the guard in a real browser", () => {
  const paths: string[] = [];
  let server: http.Server;
  let port = 0;
  let browser: import("playwright").Browser;
  const policy = (rawUrl: string) => new URL(rawUrl).hostname === "127.0.0.1" || rawUrl.startsWith("about:");

  afterAll(async () => {
    await browser?.close();
    await new Promise((r) => server?.close(r));
  });

  async function setup() {
    if (browser) return;
    const go = (r: http.ServerResponse, to: string) => { r.writeHead(302, { location: to }); r.end(); };
    server = http.createServer((q, r) => {
      if (q.url === "/favicon.ico") { r.writeHead(404); return r.end(); }
      paths.push(q.url ?? "");
      if (q.url === "/chain") go(r, `http://127.0.0.1:${port}/chain2`);
      else if (q.url === "/chain2") go(r, `http://127.0.0.1:${port}/landing`);
      else if (q.url === "/start") go(r, `http://localhost:${port}/secret`); // allowed host -> internal host
      else r.end("<!doctype html><title>page</title>ok");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
    const { chromium } = await import("playwright");
    browser = await chromium.launch({ headless: true, executablePath: CHROMIUM, args: ["--no-sandbox"] });
  }

  it("follows a redirect to an internal host only when unguarded, and vets every hop of a chain", async () => {
    await setup();
    const { installRequestGuard } = await import("@/lib/playwrightExtract");

    // Control: without the guard the allowed host's redirect lands on the internal one.
    paths.length = 0;
    const bare = await (await browser.newContext()).newPage();
    await bare.goto(`http://127.0.0.1:${port}/start`);
    expect(paths).toEqual(["/start", "/secret"]);

    // Guarded: the first hop is allowed, the redirect target never receives a request.
    paths.length = 0;
    const ctx = await browser.newContext();
    await installRequestGuard(ctx, policy);
    const page = await ctx.newPage();
    await expect(page.goto(`http://127.0.0.1:${port}/start`)).rejects.toThrow(/BLOCKED_BY_CLIENT/);
    expect(paths).toEqual(["/start"]);

    // A chain of allowed hops is followed to the end.
    paths.length = 0;
    const chain = await ctx.newPage();
    await chain.goto(`http://127.0.0.1:${port}/chain`);
    await chain.waitForURL(/\/landing$/, { timeout: 10_000 });
    expect(paths).toEqual(["/chain", "/chain2", "/landing"]);

    // Straight to the internal host: nothing is sent.
    paths.length = 0;
    await expect(chain.goto(`http://localhost:${port}/secret`)).rejects.toThrow();
    expect(paths).toEqual([]);
  }, 60_000);
});
