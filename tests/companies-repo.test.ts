import { describe, it, expect } from "vitest";

process.env.ROUTEFLOW_DB_PATH = "/tmp/rf-companies-repo.db"; // each test file gets its own database from this name
process.env.SESSION_SECRET = "test-secret";

const { createCompany, listCompanies, sniffLogo, updateCompany, addDomain, findDomain, setArvanCname } = await import("@/lib/repo/companies");
const { resolveHost } = await import("@/lib/repo/companyDomains");
const { parseLogo } = await import("@/lib/companyInput");
const { isPrivateAddress, checkDomain } = await import("@/lib/domainCheck");
const { withDbScope } = await import("@/lib/database/scope");
const { isUniqueViolation } = await import("@/lib/database/errors");

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(20)]);
await (await import("@/lib/db")).getDb().prepare("SELECT 1").get(); // opens this file's test database before the first transaction
const owner = (u: string) => ({ username: u, displayName: "مدیر", password: "longpassword" });

describe("companies", () => {
  it("creates a company with its owner, address and logo in one step", async () => {
    const id = await withDbScope("all", () =>
      createCompany({ name: "تامینو", hostname: "app.cr-one.ir", logo: { data: PNG, type: "image/png" }, owner: owner("cr-one") })
    );
    const row = (await withDbScope("all", listCompanies)).find((c) => c.id === id)!;
    expect(row).toMatchObject({ name: "تامینو", users: 1, has_logo: true });
    expect(row.domains).toMatchObject([{ hostname: "app.cr-one.ir", status: "waiting_dns" }]);
  });

  it("is all or nothing: a taken username leaves no company behind", async () => {
    const before = (await withDbScope("all", listCompanies)).length;
    let err: unknown;
    try {
      await withDbScope("all", () => createCompany({ name: "دوم", hostname: null, logo: null, owner: owner("cr-one") }));
    } catch (e) { err = e; }
    expect(isUniqueViolation(err)).toBe(true);
    expect((await withDbScope("all", listCompanies)).length).toBe(before);
  });

  it("an address names the company only once it is active, and not when the company is switched off", async () => {
    const id = await withDbScope("all", () => createCompany({ name: "سوم", hostname: null, logo: null, owner: owner("cr-three") }));
    await withDbScope("all", () => addDomain(id, "app.cr-three.ir"));
    expect((await withDbScope("system", () => resolveHost("app.cr-three.ir"))).kind).toBe("main");
    const { getDb } = await import("@/lib/db");
    await withDbScope("system", () => getDb().prepare("UPDATE company_domains SET status = 'active' WHERE hostname = 'app.cr-three.ir'").run());
    expect((await withDbScope("system", () => resolveHost("app.cr-three.ir"))).kind).toBe("company");
    await withDbScope("all", () => updateCompany(id, { active: false }));
    expect((await withDbScope("system", () => resolveHost("app.cr-three.ir"))).kind).toBe("main");
  });
});

describe("logo and address checks", () => {
  it("accepts only PNG, JPEG or WebP by their bytes, within the size limit", () => {
    expect(sniffLogo(PNG)).toBe("image/png");
    expect(sniffLogo(Buffer.from("<svg onload=alert(1)>"))).toBeNull();
    expect(parseLogo(`data:image/png;base64,${PNG.toString("base64")}`)).toMatchObject({ type: "image/png" });
    expect(parseLogo(`data:image/png;base64,${Buffer.from("<svg/>").toString("base64")}`)).toHaveProperty("error");
    expect(parseLogo(`data:image/png;base64,${Buffer.concat([PNG, Buffer.alloc(160 * 1024)]).toString("base64")}`)).toHaveProperty("error");
    expect(parseLogo(undefined)).toBeNull();
  });
  it("never lets a check reach the private network", () => {
    for (const ip of ["10.0.0.5", "127.0.0.1", "192.168.1.1", "172.20.0.1", "169.254.1.1", "::1"]) expect(isPrivateAddress(ip)).toBe(true);
    expect(isPrivateAddress("8.8.8.8")).toBe(false);
  });
});

describe("Arvan CNAME value", () => {
  it("is kept per address, and an address with none saved asks for it", async () => {
    const id = await withDbScope("all", () => createCompany({ name: "چهارم", hostname: "app.cr-four.invalid", logo: null, owner: owner("cr-four") }));
    const d = (await withDbScope("all", listCompanies)).find((c) => c.id === id)!.domains[0];
    expect(d.arvan_cname).toBeNull();
    await withDbScope("all", () => setArvanCname(d.id, "abc123.cname.arvancdn.ir"));
    expect((await withDbScope("all", () => findDomain(d.id)))?.arvan_cname).toBe("abc123.cname.arvancdn.ir");
    const none = await checkDomain("app.cr-four.invalid", null);
    expect(none.status).toBe("waiting_dns");
    expect(none.error).toContain("آروان");
  });
});
