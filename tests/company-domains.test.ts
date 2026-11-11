import { describe, it, expect } from "vitest";

process.env.ROUTEFLOW_DB_PATH = "/tmp/rf-company-domains.db"; // each test file gets its own database from this name
process.env.SESSION_SECRET = "test-secret";
import { normalizeHostname } from "@/lib/companyHost";
import { mayUseAddress, type HostKind } from "@/lib/repo/companyDomains";

describe("normalizeHostname", () => {
  it("reduces what is typed to a bare lowercase host", () => {
    expect(normalizeHostname(" HTTPS://App.Tamino.ir:443/login?x=1 ")).toBe("app.tamino.ir");
    expect(normalizeHostname("app.tamino.ir.")).toBe("app.tamino.ir");
  });
  it("refuses what is not an address", () => {
    for (const bad of ["", "localhost", "a b.ir", "-x.ir", "x..ir", null, 5]) expect(normalizeHostname(bad)).toBeNull();
  });
});

describe("mayUseAddress", () => {
  const tamino: HostKind = { kind: "company", organizationId: 2, name: "Tamino", logo: null };
  const main: HostKind = { kind: "main" };
  const owner = { role: "platform_owner", organization_id: 1 };
  const taminoUser = { role: "owner", organization_id: 2 };
  const otherUser = { role: "owner", organization_id: 3 };

  it("lets a company's own people in on its address, and nobody else's", () => {
    expect(mayUseAddress(tamino, taminoUser, false)).toBe(true);
    expect(mayUseAddress(tamino, otherUser, false)).toBe(false);
  });
  it("lets a platform owner in anywhere", () => {
    expect(mayUseAddress(tamino, owner, true)).toBe(true);
    expect(mayUseAddress(main, owner, true)).toBe(true);
    expect(mayUseAddress({ kind: "unknown" }, owner, true)).toBe(true);
  });
  it("closes the main address to companies only when asked, and unknown addresses always", () => {
    expect(mayUseAddress(main, taminoUser, false)).toBe(true);
    expect(mayUseAddress(main, taminoUser, true)).toBe(false);
    expect(mayUseAddress({ kind: "unknown" }, taminoUser, false)).toBe(false);
  });
});

describe("sign-in on a company's address", async () => {
  const { getDb } = await import("@/lib/db");
  const { hashPassword } = await import("@/lib/auth");
  const { POST } = await import("@/app/api/login/route");
  const { resolveHost, setPlatformSetting } = await import("@/lib/repo/companyDomains");
  const { withDbScope } = await import("@/lib/database/scope");
  const { NextRequest } = await import("next/server");

  async function seed() {
    const db = getDb();
    const org = Number(
      (await db.prepare("INSERT INTO organizations (name, slug, created_at) VALUES ('Tamino', 'tamino-cd', '2026-01-01')").run()).lastInsertRowid
    );
    await db.prepare("INSERT INTO company_domains (organization_id, hostname, status, created_at) VALUES (?, 'app.tamino-cd.ir', 'active', '2026-01-01')").run(org);
    await db.prepare("INSERT INTO company_domains (organization_id, hostname, status, created_at) VALUES (?, 'wait.tamino-cd.ir', 'waiting_dns', '2026-01-01')").run(org);
    const mk = async (name: string, orgId: number, role = "owner") =>
      db.prepare(
        "INSERT INTO users (username, password_hash, display_name, role, organization_id, active, created_at) VALUES (?, ?, ?, ?, ?, 1, '2026-01-01')"
      ).run(name, hashPassword("right-pass"), name, role, orgId);
    await mk("cd-tamino", org);
    await mk("cd-other", 1);
    await mk("cd-main", 1, "platform_owner");
    return org;
  }

  const login = (username: string, host: string, ip: string) =>
    withDbScope("system", () =>
      POST(
        new NextRequest("http://localhost/api/login", {
          method: "POST",
          body: JSON.stringify({ username, password: "right-pass" }),
          headers: { "Content-Type": "application/json", "x-forwarded-for": ip, host },
        })
      )
    );

  it("only an active address names its company", async () => {
    const org = await withDbScope("system", seed);
    const active = await withDbScope("system", () => resolveHost("app.tamino-cd.ir"));
    expect(active).toMatchObject({ kind: "company", organizationId: org, name: "Tamino" });
    expect((await withDbScope("system", () => resolveHost("wait.tamino-cd.ir"))).kind).toBe("main");
  });

  it("lets the company's people in on its address and turns others away with the usual message", async () => {
    expect((await login("cd-tamino", "app.tamino-cd.ir", "10.1.0.1")).status).toBe(200);
    const refused = await login("cd-other", "app.tamino-cd.ir", "10.1.0.2");
    expect(refused.status).toBe(401);
    expect((await refused.json()).error).toContain("اشتباه");
  });

  it("closes the main address to a company's people once the switch is on", async () => {
    expect((await login("cd-tamino", "main.example.ir", "10.1.0.3")).status).toBe(200);
    await withDbScope("system", () => setPlatformSetting("main_address_owner_only", "1"));
    expect((await login("cd-tamino", "main.example.ir", "10.1.0.4")).status).toBe(401);
    expect((await login("cd-main", "main.example.ir", "10.1.0.5")).status).toBe(200);
  });
});
