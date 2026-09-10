import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** No English enum reaches a Persian sentence.
 *
 *  These columns hold machine identifiers — «critical», «credit», «prospect», «good» —
 *  and every one of them looks perfectly reasonable at the call site, because the code
 *  around it is English too. The user found three of them; two more were sitting on
 *  /sales/reps and /sales/reps/[id] where «prospect» and «good» were printed straight
 *  into Persian sentences, and briefing.ts had a third nobody had reported.
 *
 *  So the rule is on the FIELD NAME rather than on the value: these names are known to
 *  hold an English enum, and interpolating one bare into JSX is always the bug. Each has
 *  a Persian map, named below, and the second test proves the map still covers the whole
 *  union — a map that has fallen behind its enum sends the raw value through the `??`
 *  fallback and reintroduces exactly this defect.
 */
const ROOT = join(__dirname, "..");

const ENUM_FIELDS: Record<string, string> = {
  stage: "REP_STAGE_LABEL in lib/repStages.ts",
  band: "REP_HEALTH_BAND_FA in lib/repo/repHealth.ts",
  severity: "SEVERITY_FA in lib/repo/actionCenter.ts",
  category: "ALERT_CATEGORY_FA in lib/repo/actionCenter.ts",
};

/** Bare interpolations that are the field itself, e.g. `{r.stage}` or `{health.band}`.
 *
 *  An expression that indexes a map — `{REP_STAGE_LABEL[r.stage]}` — has other characters
 *  before the identifier and so does not match.
 *
 *  The leading `(?<!=)` excludes an attribute value. `value={form.category}` on a <select>
 *  is the enum being used AS an identifier, which is the correct use of it — the wrong one
 *  is putting it where a reader will read it. Without this the rule would push a call site
 *  towards translating a form value, which would then post Persian to the API.
 */
const BARE = (field: string) => new RegExp(String.raw`(?<!=)\{\s*\w+(?:\?)?\.${field}\s*\}`, "g");

function tsxFiles(): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const e of readdirSync(join(ROOT, rel), { withFileTypes: true })) {
      const child = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(child);
      else if (e.name.endsWith(".tsx")) out.push(child);
    }
  };
  walk("app");
  walk("components");
  return out.sort();
}

/** Route handlers (the route.ts files under app/) too: the Excel export wrote its own
 *  lowercase status map into every spreadsheet, and a .tsx-only scan could not see it. */
function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const e of readdirSync(join(ROOT, rel), { withFileTypes: true })) {
      const child = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(child);
      else if (/\.tsx?$/.test(e.name)) out.push(child);
    }
  };
  walk("app");
  walk("components");
  return out.sort();
}

describe("English enums never reach Persian copy", () => {
  it("no .tsx interpolates a known enum field bare", () => {
    const offenders: string[] = [];
    for (const f of tsxFiles()) {
      const src = readFileSync(join(ROOT, f), "utf8");
      for (const [field, map] of Object.entries(ENUM_FIELDS)) {
        for (const hit of src.match(BARE(field)) ?? []) {
          offenders.push(`${f}  ${hit}  → use ${map}`);
        }
      }
    }
    expect(offenders, `these print an English identifier to a Persian reader:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("no label lookup falls back to the raw identifier", () => {
    /* `{MAP[x.status] ?? x.status}` looks defensive and is the defect itself: the moment
       the map misses, a Persian reader gets «DELIVERED». The journey page's map was keyed
       `draft`/`delivered` against uppercase statuses, so it missed every time and printed
       English on every order. Fall back to Persian («نامشخص») instead. */
    const FALLBACK = /\?\?\s*[\w.?]+\.(status|payment_status|stage|kind|role|band|severity|category|state|type|lifecycle|action|key)\s*[}),]/g;
    const offenders: string[] = [];
    for (const f of sourceFiles()) {
      const src = readFileSync(join(ROOT, f), "utf8");
      for (const m of src.matchAll(FALLBACK)) {
        offenders.push(`${f}:${src.slice(0, m.index).split("\n").length}  ${m[0]}`);
      }
    }
    expect(offenders, `these print the raw identifier when their map misses:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("no component keeps its own order-status map", () => {
    /* Order statuses are UPPERCASE (lib/orderStateMachine.ts). Two components had their
       own lowercase maps (`draft`, `delivered`) that never matched a real value. There is
       one map, ORDER_STATUS_LABEL, and it is tested against the union. */
    const LOCAL = /\{\s*draft:\s*"[^"]*",\s*confirmed:/;
    const offenders = sourceFiles().filter((f) => LOCAL.test(readFileSync(join(ROOT, f), "utf8")));
    expect(offenders, `use ORDER_STATUS_LABEL from lib/orderStateMachine.ts:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("every task kind the codebase creates has a label", () => {
    const labels = readFileSync(join(ROOT, "lib", "tasks", "labels.ts"), "utf8");
    const known = new Set([...labels.matchAll(/^  (\w+): "/gm)].map((m) => m[1]));
    const created = new Set<string>();
    const scan = (rel: string) => {
      for (const e of readdirSync(join(ROOT, rel), { withFileTypes: true })) {
        const child = `${rel}/${e.name}`;
        if (e.isDirectory()) scan(child);
        else if (/\.tsx?$/.test(e.name)) {
          /* Where task rows are made: the task, board and pocket code in full, and elsewhere
             only a rule's action (the lines naming a `role_hint`), since `kind` also names
             facility and seasonal-factor types that are not tasks. */
          const whole = /^lib\/(tasks\/|repo\/(tasks|board|pocket)\.ts$)/.test(child);
          const src = readFileSync(join(ROOT, child), "utf8")
            .split("\n")
            .filter((line) => whole || line.includes("role_hint"))
            .join("\n");
          for (const m of src.matchAll(/\bkind\s*:\s*"([a-z_]+)"/g)) created.add(m[1]);
        }
      }
    };
    scan("lib");
    const missing = [...created].filter((k) => !known.has(k));
    expect(created.size).toBeGreaterThan(2);
    expect(missing, `task kinds with no Persian label: ${missing.join(", ")} (seen: ${[...created].join(", ")})`).toEqual([]);
  });

  it("every label map still covers its whole union", () => {
    /* A map that has fallen behind the enum it labels is worse than no map: the `??`
       fallback quietly sends the raw English value through, on the one new value nobody
       has seen yet. */
    const unionOf = (src: string, type: string) => {
      const m = src.match(new RegExp(String.raw`(?:type|band):?\s*${type}\s*=\s*([^;]+);`));
      return m ? [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]) : [];
    };
    const stages = readFileSync(join(ROOT, "lib", "repStages.ts"), "utf8");
    const stageUnion = unionOf(stages, "RepStage");
    expect(stageUnion.length).toBeGreaterThan(3);
    for (const s of stageUnion) expect(stages, `REP_STAGE_LABEL is missing ${s}`).toContain(`${s}: "`);

    const health = readFileSync(join(ROOT, "lib", "repo", "repHealth.ts"), "utf8");
    for (const b of ["good", "watch", "risk"]) {
      expect(health.match(new RegExp(`${b}: "`)), `REP_HEALTH_BAND_FA is missing ${b}`).toBeTruthy();
    }

    const ac = readFileSync(join(ROOT, "lib", "repo", "actionCenter.ts"), "utf8");
    for (const s of ["critical", "warning", "opportunity"]) {
      expect(ac.match(new RegExp(`${s}: "`)), `SEVERITY_FA is missing ${s}`).toBeTruthy();
    }
  });
});
