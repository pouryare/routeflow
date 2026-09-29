import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/** A data-dependent migration may not be guarded by a one-shot marker.
 *
 *  A marker in `app_meta` is the right tool for a migration whose predicate is about the
 *  SCHEMA — "have I added this column yet?" — and the wrong tool for one whose predicate
 *  is about ROWS. `foldLeadPinsIntoCustomers` folds "a pin that is in a lead list";
 *  guarded on `app_meta.lead_pin_foldin_done`, any qualifying row that arrived after the
 *  marker was written was never promoted, on any future boot, however long it waited.
 *  Which page showed a given lead became a function of WHEN it was added.
 *
 *  The test cannot tell a schema predicate from a row predicate by reading a marker, so
 *  it applies the rule it CAN check: a migration called during boot may not read a marker
 *  to decide whether to run. Every marker read must be one the exempt list names.
 */
const SRC = readFileSync("lib/db.ts", "utf8");

/** Boot-time markers that are legitimate, and why. Each of these changes the SCHEMA, so
 *  "have I done it yet" really is a question about time.
 *  Named individually, because a pattern no file is exempt from is a pattern nothing
 *  passes — and a test that quietly exempts everything is a test that guards nothing. */
const MARKER_OK: [string, string][] = [
  ["board_pocket_reminders_folded", "folds reminders into a board; it reads the ones it creates, so a second pass is a no-op and the marker is belt-and-braces"],
  /* The three below are LEGACY BACKFILLS, and the distinction is the whole point of
     this file. They convert an old representation of a row into the new one, and the old
     representation does not survive the conversion — `paid_toman` is dropped, the
     pre-ledger stock balance is superseded, the order gains a synthetic `create` event.
     A row that arrives LATER is already in the new shape and needs no backfill, so "have
     I done it yet" is genuinely a question about time.

     The fold is not that. Its predicate is "is this pin in a lead list" — a fact about an
     ongoing RELATIONSHIP, and new pins are added to lists every day. Guarded on a marker,
     every one of those would wait forever. That is why it is not on this list, and why
     the list reads as a set of reasoned exemptions rather than a suppression file. */
  ["legacy_payment_backfill_done", "legacy paid_toman -> payment rows; the column is dropped after, so a later row is already in the new shape"],
  ["stock_ledger_backfill_done", "legacy purchased-minus-delivered -> stock_movements; the old balance stops being authoritative after"],
  ["order_events_backfill_done", "gives each legacy order a synthetic create event so the timeline is never blank; a new order gets a real one"],
];

/** Strips comments, so a file's own explanation of a rule is not read as breaking it.
 *  Every fix in this repo names the stale predicate in its comment. */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*\/\//.test(l))
    .join("\n");
}

describe("no one-shot marker guards a data-dependent migration", () => {
  it("finds lib/db.ts at all (guards the test itself)", () => {
    expect(SRC).toContain("foldLeadPinsIntoCustomers");
  });

  it("the pin fold is not behind a marker, at the call site", () => {
    const from = SRC.indexOf("export function getDb");
    const call = code(SRC.slice(from, SRC.indexOf("backfillLegacyPayments", from)));
    expect(call, "the boot call must be unconditional").not.toMatch(/lead_pin_foldin_done/);
  });

  it("the pin fold does not read app_meta at all", () => {
    const body = SRC.slice(SRC.indexOf("export function foldLeadPinsIntoCustomers"));
    expect(body.slice(0, 3000), "the fold function itself must not read app_meta")
      .not.toMatch(/app_meta/);
  });

  it("every marker read in lib/db.ts is one the exempt list names", () => {
    const reads = [...code(SRC).matchAll(/FROM\s+app_meta\s+WHERE\s+key\s*=\s*'([a-z_]+)'/g)]
      .map((m) => m[1]);
    expect(reads.length, "no marker reads found — has the file been restructured?").toBeGreaterThan(0);

    const known = new Set(MARKER_OK.map(([k]) => k));
    const unexplained = [...new Set(reads)].filter((k) => !known.has(k));
    expect(
      unexplained,
      `a marker read with no stated reason:\n${unexplained.join("\n")}\n` +
        `Either the migration is row-dependent and the marker must go, or add it to ` +
        `MARKER_OK in this file with a sentence saying why a marker is the honest answer.`,
    ).toEqual([]);
  });

  it("the exempt list is not a list of things nobody reads", () => {
    /* An exemption nobody checks is a hole waiting for a file to fall into. Every key in
     * MARKER_OK must still appear in the source, or the entry has gone stale and should
     * be deleted rather than trusted. */
    for (const [key, why] of MARKER_OK) {
      expect(SRC, `${key} (${why.slice(0, 30)}…) is no longer read from app_meta`).toContain(key);
    }
  });
});
