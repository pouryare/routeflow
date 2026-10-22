import { describe, it, expect, afterAll } from "vitest";
import { readFileSync } from "node:fs";

/* The acting-company controls (spec: the founder's single account sees every company, and can act
 * as the owner of one). The banner must make the state impossible to forget; the picker must be
 * chips, shown only to the account that may use it. */

const read = (p: string) => readFileSync(p, "utf8");
const cleanup: string[] = [];
afterAll(async () => {
  const fs = await import("node:fs");
  for (const p of cleanup) for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${p}${suffix}`, { force: true });
});

const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("ActingCompanyBanner", () => {
  const src = read("components/meridian/ActingCompanyBanner.tsx");

  it("names the company and says changes land there", () => {
    // Not rendered: it uses the app router, which a node-only test cannot mount.
    expect(src).toContain("{name}");
    expect(src).toContain("در همین سازمان ثبت می‌شود");
    expect(src).toContain('role="status"');
  });

  it("keeps the way back to all companies, and cannot be dismissed", () => {
    expect(src).toContain("همهٔ سازمان‌ها");
    expect(src).toContain("organization_id: null");
    expect(code(src)).not.toMatch(/dismiss|onClose/);
  });
});

describe("ActingCompany (the picker)", () => {
  const src = read("components/meridian/ActingCompany.tsx");

  it("is chips, never a dropdown", () => {
    expect(code(src)).not.toContain("<select");
    expect(src).toContain("ChipGroup");
  });

  it("offers 'all' first, and posts the chosen company (null for all)", () => {
    expect(src).toContain('{ id: "", label: "همهٔ سازمان‌ها" }');
    expect(src).toContain("/api/admin/acting-org");
    expect(src).toMatch(/organization_id: id/);
  });
});

describe("wiring", () => {
  it("AppHeader shows the banner only while a company is being acted in, with the company's name", () => {
    const header = read("components/meridian/AppHeader.tsx");
    expect(header).toMatch(/session\.actingOrg \?[\s\S]{0,160}ActingCompanyBanner[\s\S]{0,120}organizationName\(session\.actingOrg\)/);
  });

  it("the switch page mounts the picker for a platform_owner outside Login-As only", () => {
    const page = read("app/(shell)/switch/page.tsx");
    expect(page).toMatch(/session\.role === "platform_owner" && session\.actorId === undefined \? <ActingCompany \/>/);
  });

  it("organizationName returns the name, or null for an unknown company", async () => {
    // Needs a database; use a private one.
    const os = await import("node:os");
    const path = await import("node:path");
    const dbPath = path.join(os.tmpdir(), `rf-org-name-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    process.env.ROUTEFLOW_DB_PATH = dbPath;
    cleanup.push(dbPath);
    process.env.SESSION_SECRET = "test-secret-".padEnd(40, "x");
    const { organizationName } = await import("@/lib/repo/organizations");
    expect(organizationName(1)).toBeTruthy();
    expect(organizationName(987654)).toBeNull();
  });
});
