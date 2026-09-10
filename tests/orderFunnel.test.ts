import { describe, it, expect } from "vitest";
import { buildFunnel, FUNNEL_STAGES, type FunnelRow } from "@/lib/orderFunnel";

const by = (rows: FunnelRow[]) => Object.fromEntries(buildFunnel(rows).map((s) => [s.key, s]));

describe("buildFunnel", () => {
  it("a delivered order with a single create event has passed every earlier stage", () => {
    /* The production log: 43 of 45 orders carry only `create` → DELIVERED. */
    const f = by([{ status: "DELIVERED", seen: ["DELIVERED"] }]);
    for (const k of ["placed", "confirmed", "planned", "ready", "out", "delivered"]) expect(f[k].reached).toBe(1);
    expect(f.closed.reached).toBe(0);
  });

  it("a live order waits at its furthest stage, and only there", () => {
    const f = by([{ status: "PLANNED", seen: ["DRAFT", "CONFIRMED", "PLANNED"] }]);
    expect(f.planned.waiting).toBe(1);
    expect(buildFunnel([{ status: "PLANNED", seen: [] }]).reduce((n, s) => n + s.waiting, 0)).toBe(1);
  });

  it("a cancelled order exits at the furthest stage it held, not at the start", () => {
    const f = by([{ status: "CANCELLED", seen: ["DRAFT", "CONFIRMED", "CONFIRMED", "CANCELLED"] }]);
    expect(f.confirmed.reached).toBe(1);
    expect(f.planned.reached).toBe(0);
    expect(f.confirmed.exited).toBe(1);
    expect(f.confirmed.waiting).toBe(0);
  });

  it("pre-confirmation gates are all the placed stage", () => {
    const f = by([
      { status: "PENDING_CREDIT", seen: [] },
      { status: "ON_HOLD", seen: [] },
      { status: "PENDING_REVIEW", seen: [] },
    ]);
    expect(f.placed.waiting).toBe(3);
    expect(f.confirmed.reached).toBe(0);
  });

  it("a closed order is done: reached everything, waits nowhere", () => {
    const stages = buildFunnel([{ status: "CLOSED", seen: [] }]);
    expect(stages.every((s) => s.reached === 1)).toBe(true);
    expect(stages.every((s) => s.waiting === 0)).toBe(true);
  });

  it("drop-off is the share lost from the stage before; none for the first or an empty stage", () => {
    const stages = buildFunnel([
      { status: "DELIVERED", seen: [] },
      { status: "CONFIRMED", seen: [] },
      { status: "DRAFT", seen: [] },
      { status: "DRAFT", seen: [] },
    ]);
    expect(stages[0].drop).toBeNull();
    expect(stages[1].drop).toBeCloseTo(0.5); // 4 placed → 2 confirmed
    expect(stages[2].drop).toBeCloseTo(0.5); // 2 → 1
    expect(buildFunnel([])[1].drop).toBeNull();
  });

  it("an unknown status from an old row cannot crash or inflate the funnel", () => {
    const f = by([{ status: "SOMETHING_OLD", seen: ["", "WHATEVER"] }]);
    expect(f.placed.reached).toBe(1);
    expect(f.confirmed.reached).toBe(0);
  });

  it("labels every stage in Persian", () => {
    for (const s of FUNNEL_STAGES) expect(s.label).toMatch(/[؀-ۿ]/);
  });
});
