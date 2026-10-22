import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";

const page = readFileSync("app/(shell)/sales/dashboard/page.tsx", "utf8");

/** The dashboard's stat tiles and charts all come from one salesDashboard() read. The three
 *  sections below it each do their own heavy reads (commission statements, stock, the action
 *  centre and customer health); run inline they hold the whole page back, because React cannot
 *  flush anything until the component that awaits them returns. Each lives in its own
 *  component behind a Suspense boundary so the top of the page paints first. */
describe("the dashboard streams its slow sections", () => {
  const sections = ["DeepAnalysisSection", "MoneySection", "StockSection"];

  it("renders each slow section inside a Suspense boundary", () => {
    expect(page).toMatch(/import\s*{[^}]*\bSuspense\b[^}]*}\s*from\s*["']react["']/);
    for (const name of sections) {
      const at = page.indexOf(`<${name}`);
      expect(at, `${name} is rendered by the page`).toBeGreaterThan(-1);
      // The nearest <Suspense before it must still be open: no </Suspense> in between.
      const open = page.lastIndexOf("<Suspense", at);
      expect(open, `${name} has a Suspense boundary above it`).toBeGreaterThan(-1);
      expect(page.slice(open, at), name).not.toContain("</Suspense>");
    }
  });

  it("keeps the section components as server components in their own files", () => {
    for (const name of sections) {
      const file = `components/dashboard/${name}.tsx`;
      expect(existsSync(file), file).toBe(true);
      const src = readFileSync(file, "utf8");
      expect(src, file).not.toMatch(/^\s*["']use client["']/m);
      expect(src, file).toMatch(/export default (async )?function/);
    }
  });

  it("no longer runs the slow reads inline in the page", () => {
    for (const call of ["allStatements(", "allDriverStatements(", "allManagerStatements(", "stockPosition(", "fillRateByDriver(", "moneyFor(", "stockFor(", "kpiBoard(", "actionCenterFor(", "customersHealthOverview("]) {
      expect(page, call).not.toContain(call);
    }
  });

  it("still gates the cost-bearing sections by role, in the read and not just the markup", () => {
    // The commission gate moved with the read: moneyFor() skips the driver and manager ledgers
    // for a seller, so that is where the role check must live.
    const money = readFileSync("lib/repo/dashboardView.ts", "utf8");
    const stock = readFileSync("components/dashboard/StockSection.tsx", "utf8");
    expect(money).toMatch(/phone_sales/);
    expect(page + stock).toMatch(/phone_sales/);
  });

  it("keeps the heavy reads inside the streamed sections, behind the session-scoped view functions", () => {
    expect(readFileSync("components/dashboard/MoneySection.tsx", "utf8")).toContain("moneyFor(session)");
    expect(readFileSync("components/dashboard/StockSection.tsx", "utf8")).toContain("stockFor(session)");
  });

  it("no dashboard file opens the database: they call lib/repo/dashboardView and friends with the session", () => {
    const files = ["app/(shell)/sales/dashboard/page.tsx", ...["DeepAnalysisSection", "MoneySection", "StockSection"].map((n) => `components/dashboard/${n}.tsx`)];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/from\s+["']@\/lib\/db["']/);
      expect(src, f).not.toMatch(/\bgetDb\(/);
    }
  });
});
