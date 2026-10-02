import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import fs from "node:fs";
import { canReadAccounting } from "@/lib/accountingGate";

/**
 * The accounting section's wiring. These are checks on SOURCE TEXT rather than on rendered
 * output, and that is deliberate: the failures they guard against are all "someone wrote a
 * literal instead of the constant", and a rendered page cannot show you the source of a
 * gate. A gate that compiles, renders, and admits the wrong role still looks perfect.
 */
const appNav = readFileSync("lib/appNav.ts", "utf8");
const proxy = readFileSync("proxy.ts", "utf8");
const pageMeta = readFileSync("lib/pageMeta.ts", "utf8");
const roles = readFileSync("lib/roles.ts", "utf8");

const ROUTES = [
  "/accounting/trial-balance",
  "/accounting/journal",
  "/accounting/balance-sheet",
  "/accounting/income-statement",
  "/accounting/payables",
  "/accounting/expenses",
  "/accounting/suppliers",
];

const page = (name: string) => readFileSync(`app/(shell)/accounting/${name}/page.tsx`, "utf8");

describe("the accounting shell", () => {
  it("adds an «accounts» nav group rather than 8 tabs in «فروش و دریافت»", () => {
    expect(appNav).toContain('id: "accounts"');
    expect(appNav).toContain("حسابداری");
    // The union must admit it too, or the group label will not typecheck.
    expect(appNav).toMatch(/\|\s*"accounts"/);
  });

  it("registers every accounting route in exactly one group", () => {
    for (const r of ROUTES) {
      const hits = appNav.split(`href: "${r}"`).length - 1;
      expect(hits, `${r} appears ${hits} times`).toBe(1);
    }
  });

  it("gates with the OWNER_ROLES constant, never a hand-written literal", () => {
    expect(proxy).toContain("/accounting");
    expect(proxy).toMatch(/OWNER_ROLES/);

    /* Scoped to the ACCOUNTING block, not the whole file. A blanket
       `/role !== "owner"/` check flags proxy.ts:227 -- the pre-existing `isPinPool` gate,
       written in 07b3f45, which does use the literal and so does lock platform_owner out
       of the pin pool. That is a real pre-existing bug, but it is not this task's, and
       "fix" it here would be an unreviewed behaviour change smuggled in behind a test.
       It is recorded in .cline/journal.md instead. */
    const block = proxy.slice(proxy.indexOf("isAccounting"), proxy.indexOf("isAccountingWrite"));
    expect(block).not.toMatch(/role\s*!==\s*["']owner["']/);
    expect(block).toMatch(/OWNER_ROLES/);

    // And the derivation itself must be from the constant, not its own list again.
    expect(roles).toMatch(/isOwner\s*=\s*\(r:\s*Role\)\s*=>\s*OWNER_ROLES\.includes/);
  });

  it("gives every accounting route a pageMeta entry", () => {
    for (const r of ROUTES) expect(pageMeta).toContain(`"${r}"`);
  });

  it("every accounting page calls the shared gate instead of re-deriving the role check", () => {
    /* Eight pages each writing their own `session.role === "owner"` is eight chances to
       write one of them slightly differently, and one of them slightly wrong. They all call
       requireAccounting(). */
    const pages = [
      "trial-balance",
      "journal",
      "balance-sheet",
      "income-statement",
      "payables",
      "expenses",
      "suppliers",
    ];
    for (const p of pages) {
      const file = `app/(shell)/accounting/${p}/page.tsx`;
      expect(fs.existsSync(file), `${file} is missing`).toBe(true);
      const src = page(p);
      expect(src, `${p} must call requireAccounting`).toContain("requireAccounting");
      // And no page may quietly grow its own role comparison alongside it.
      expect(src, `${p} re-derives the role check`).not.toMatch(/role\s*===\s*["']owner["']/);
    }
  });

  it("a manager may read the journal and expenses, and nothing else", () => {
    // They enter expenses, so the expense report is their own work. Everything else is the
    // whole organisation's money.
    expect(canReadAccounting("group_manager", "/accounting/journal")).toBe(true);
    expect(canReadAccounting("group_manager", "/accounting/expenses")).toBe(true);
    expect(canReadAccounting("group_manager", "/accounting/trial-balance")).toBe(false);
    expect(canReadAccounting("group_manager", "/accounting/balance-sheet")).toBe(false);
    expect(canReadAccounting("group_manager", "/accounting/income-statement")).toBe(false);
    expect(canReadAccounting("group_manager", "/accounting/payables")).toBe(false);
    expect(canReadAccounting("group_manager", "/accounting/suppliers")).toBe(false);
  });

  it("platform_owner is admitted, because OWNER_ROLES includes it", () => {
    // The bug lib/roles.ts:68 documents: `role === "owner"` is right for everything except
    // this one. Every single route must pass for the platform's own god key.
    for (const r of ROUTES) {
      expect(canReadAccounting("platform_owner", r), `platform_owner denied ${r}`).toBe(true);
    }
  });

  it("denies a rep and a van role everything", () => {
    for (const r of ROUTES) {
      expect(canReadAccounting("phone_sales", r)).toBe(false);
      // The real Role union spells these field_rep / delivery_driver (lib/roles.ts:13-20).
      // I first wrote "driver" and "sales_rep" from memory; tsc named the actual members.
      expect(canReadAccounting("field_rep", r)).toBe(false);
      expect(canReadAccounting("delivery_driver", r)).toBe(false);
      expect(canReadAccounting("rep_manager", r)).toBe(false);
    }
  });

  /* ── The honesty requirements, asserted on the SCREENS ──
     The repo tests prove the DATA carries the right flags. These prove the pages actually
     SHOW them, which is a separate failure mode: a report can compute `costComplete`
     perfectly while the screen quietly omits the banner. Mutations M38–M42 deleted each of
     these affordances and every test still passed, because nothing looked at the markup.
     These are source-text assertions, like the nav checks above and for the same reason:
     the thing being guarded is a string that must be present in the file. */

  it("the income statement SHOWS the cost-incomplete banner when cost is unknown", () => {
    const src = page("income-statement");
    expect(src).toMatch(/!is\.costComplete\s*\?\s*<CostIncompleteNote\s*\/\>/);
    // And not hardcoded on, which would cry wolf on a clean ledger.
    expect(src).not.toMatch(/\{true\s*\?\s*<CostIncompleteNote/);
  });

  it("the journal strikes a reversed row through and links to the reversing journal", () => {
    const src = page("journal");
    // Matched against the EXPRESSION, not the bare word: `line-through` also appears in
    // the page's own comment explaining the rule, so M39 (deleting the className, leaving
    // the comment) passed a test that only grepped for the string.
    expect(src).toMatch(/className=\{struck\s*\?\s*"line-through"/);
    // The strike must be CONDITIONAL on being reversed -- an unconditional line-through
    // would deface every journal in the book.
    expect(src).not.toMatch(/className="[^"]*line-through/);

    // The link, and the visible text that tells you WHAT it links to. Finding a line with
    // both `href=` and `reversedByJournalId` is not enough: M40 removed the label text
    // and left the href, which still passed -- the number a reader sees had gone.
    const linkLine = src
      .split("\n")
      .find((l) => l.includes("href=") && l.includes("reversedByJournalId"));
    expect(linkLine, "no link to the reversing journal").toBeTruthy();
    expect(linkLine).toContain("/accounting/journal");
    expect(src).toMatch(/سند معکوس #\{r\.reversedByJournalId\}/);
  });

  it("the journal keeps a CLOSED period readable, and says it is closed", () => {
    const src = page("journal");
    expect(src).toMatch(/status\s*===\s*["']closed["']/);
    // The trap: filtering the list by status would make closing hide history. The page
    // must filter on period only, never on status.
    expect(src).not.toMatch(/\.filter\([^)]*status\s*===\s*["']closed["']/);
  });

  it("the balance sheet renders the difference rather than asserting it is zero", () => {
    const src = page("balance-sheet");
    expect(src).toContain("<UnbalancedBanner difference={bs.difference}");
    // A literal 0 would make the banner permanently silent -- the M41 shape.
    expect(src).not.toMatch(/UnbalancedBanner[^}]*difference=\{0\}/);
  });
});