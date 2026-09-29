import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/** A migration may not DELETE from a table a live foreign key points at, unguarded.
 *
 *  `ON DELETE CASCADE` plus a hand-written `DELETE` is a combination that destroys data
 *  quietly, and the database calls the result correct. `lead_run_stops.location_id` is
 *  `REFERENCES saved_locations(id) ON DELETE CASCADE` (lib/db.ts:1335), and
 *  `foldLeadPinsIntoCustomers` issues `DELETE FROM saved_locations WHERE id = ?` — so
 *  promoting a pin that sat on a lead run took the run's stop with it. A driver's
 *  assigned work, a promise the office made that morning, gone with no error and no entry
 *  in any log.
 *
 *  The rule: every `DELETE FROM <table>` in lib/db.ts must either target a table no
 *  foreign key points at, or sit in a function that also contains a `NOT EXISTS` naming
 *  the FK's table. The second half is the one that matters — it is the fold's own fix,
 *  and it makes the DELETE conditional rather than merely present.
 */
const SRC = readFileSync("lib/db.ts", "utf8");

/** Strips comments, so a file's own explanation of the rule is not read as breaking it.
 *  The fold's comment NAMES the cascade it guards against; without this strip the
 *  explanation would trip the rule it is explaining. */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*\/\//.test(l))
    .join("\n");
}

/** For each table a DELETE can target, the tables whose FK cascades from it.
 *
 *  Read from the schema rather than hard-coded, so the list cannot drift from reality.
 *  The schema spells a column as `location_id INTEGER NOT NULL REFERENCES saved_locations(id)
 *  ON DELETE CASCADE`, inside a `CREATE TABLE ... ( lead_run_stops ( ... ) )` block, and the
 *  declaring table's name sits on the opening line rather than beside the column — so the
 *  referrer is tracked by position inside the file, not by a `table.column` prefix.
 *
 *  An earlier version of this pattern tried to read `table.column REFERENCES ...` and
 *  matched nothing at all, which made the "found the FKs" assertion fail while the real
 *  checks passed silently. A parser that matches nothing is worse than no parser: it looks
 *  like a clean run.
 */
function cascadePairs(): { target: string; referrer: string }[] {
  const src = code(SRC);
  const out: { target: string; referrer: string }[] = [];
  // The table whose CREATE block we are inside, from its opening line.
  let current = "";
  for (const line of src.split("\n")) {
    const open = line.match(/CREATE TABLE(?: IF NOT EXISTS)?\s+([a-z_]+)\s*\(/i);
    if (open) current = open[1];
    const m = line.match(/REFERENCES\s+([a-z_]+)\s*\(\s*id\s*\)\s*ON DELETE CASCADE/i);
    if (m && current) out.push({ referrer: current, target: m[1] });
  }
  return out;
}

function targets(): Set<string> {
  return new Set(cascadePairs().map((p) => p.target));
}

/** Splits lib/db.ts into top-level function bodies, so a guard is looked for in the
 *  function that contains the DELETE rather than anywhere in a 3000-line file. */
function functions(): { name: string; body: string }[] {
  const out: { name: string; body: string }[] = [];
  const src = code(SRC);
  const marks: { name: string; at: number }[] = [];
  for (const m of src.matchAll(/export function ([a-zA-Z0-9_]+)\s*\(/g)) marks.push({ name: m[1], at: m.index! });
  for (let i = 0; i < marks.length; i++) {
    out.push({ name: marks[i].name, body: src.slice(marks[i].at, marks[i + 1]?.at ?? src.length) });
  }
  return out;
}

describe("no unguarded DELETE under a live foreign key", () => {
  it("found the cascade FKs at all (guards the walker itself)", () => {
    expect(targets().has("saved_locations")).toBe(true);
    expect(cascadePairs().some((p) => p.referrer === "lead_run_stops")).toBe(true);
  });

  it("no function deletes from a cascade target without a NOT EXISTS naming the referrer", () => {
    const pairs = cascadePairs();
    const offenders: string[] = [];

    for (const fn of functions()) {
      for (const m of fn.body.matchAll(/DELETE\s+FROM\s+([a-z_]+)/gi)) {
        const table = m[1];
        const referrers = pairs.filter((p) => p.target === table).map((p) => p.referrer);
        if (referrers.length === 0) continue; // nothing points at it — the delete is local
        /* The guard has to consult the REFERRER -- the table holding the FK -- because
           that is what makes the DELETE conditional. A NOT EXISTS naming the target would
           prove nothing: the fold's own subquery mentions `st.location_id`, not
           `saved_locations`, and a rule that demanded the target's name would fail the
           very fix this rule exists to require. */
        const guarded = referrers.some((r) =>
          new RegExp(`NOT\\s+EXISTS[\\s\\S]{0,300}?${r}\\b`, "i").test(fn.body),
        );
        if (!guarded) offenders.push(`${fn.name}: DELETE FROM ${table} (referrer: ${referrers.join(", ")})`);
      }
    }

    expect(
      offenders,
      `a DELETE from a table a live FK cascades from, with no NOT EXISTS naming the referrer:\n${offenders.join("\n")}\n` +
        `That is how a migration destroys a row another table depends on, and calls it correct.`,
    ).toEqual([]);
  });

  it("the fold's own guard is in the same function as its delete", () => {
    /* The general rule above is per-function. If someone later moves the NOT EXISTS into a
     * caller, the fold's DELETE becomes unguarded again and this names it directly. */
    const fold = functions().find((f) => f.name === "foldLeadPinsIntoCustomers");
    expect(fold, "the fold function must still exist").toBeTruthy();
    expect(fold!.body).toMatch(/NOT\s+EXISTS[\s\S]{0,300}?lead_run_stops\b/i);
    expect(fold!.body).toMatch(/DELETE\s+FROM\s+saved_locations/i);
  });

  it("the guard is not vacuous — it can still fail", () => {
    expect(targets().size, "no cascade targets found — has the schema been restructured?")
      .toBeGreaterThan(0);
    /* The pattern must still match the shape it was written for. */
    expect(`db.prepare("DELETE FROM saved_locations WHERE id = ?")`)
      .toMatch(/DELETE\s+FROM\s+saved_locations/i);
    expect(new RegExp(`NOT\\s+EXISTS[\\s\\S]{0,300}?lead_run_stops\\b`, "i").test("")).toBe(false);
  });
});
