import { describe, expect, test } from "vitest";
import {
  stageOf,
  moveRefusal,
  allowedTargets,
  isPreConfirm,
  isFulfilled,
  STAGES,
} from "@/components/sales/orderStage";

describe("stageOf", () => {
  test("splits a priced order by whether it is on a van", () => {
    expect(stageOf("CONFIRMED", false)).toBe("confirmed");
    expect(stageOf("CONFIRMED", true)).toBe("on_route");
    expect(stageOf("PLANNED", false)).toBe("confirmed");
    expect(stageOf("OUT_FOR_DELIVERY", false)).toBe("on_route");
  });

  test("every pre-confirm state sits in the draft lane", () => {
    for (const s of ["DRAFT", "PENDING_REVIEW", "PENDING_CREDIT", "ON_HOLD"]) {
      expect(stageOf(s, true)).toBe("draft");
    }
  });

  test("delivered, partially delivered and closed all read as delivered", () => {
    for (const s of ["DELIVERED", "PARTIALLY_DELIVERED", "CLOSED", "RETURNED"]) {
      expect(stageOf(s, false)).toBe("delivered");
    }
  });

  test("cancelled and a bare failed attempt stay off the board", () => {
    expect(stageOf("CANCELLED", false)).toBeNull();
    expect(stageOf("DELIVERY_FAILED", false)).toBeNull();
  });

  test("every stage it can return has a lane to land in", () => {
    const lanes = new Set(STAGES.map((s) => s.key));
    for (const [status, onRun] of [
      ["DRAFT", false],
      ["CONFIRMED", false],
      ["CONFIRMED", true],
      ["DELIVERED", false],
    ] as const) {
      const stage = stageOf(status, onRun);
      expect(stage).not.toBeNull();
      expect(lanes.has(stage!)).toBe(true);
    }
  });
});

describe("moveRefusal", () => {
  test("the one sales-side write is allowed", () => {
    expect(moveRefusal("draft", "confirmed")).toBeNull();
  });

  test("a drop back onto its own lane is a no-op, not a refusal", () => {
    expect(moveRefusal("confirmed", "confirmed")).toBeNull();
  });

  test("every other move is refused, and says why", () => {
    const moves: [string, string][] = [];
    for (const from of STAGES) {
      for (const to of STAGES) {
        if (from.key === to.key) continue;
        if (from.key === "draft" && to.key === "confirmed") continue;
        moves.push([from.key, to.key]);
      }
    }
    for (const [from, to] of moves) {
      const why = moveRefusal(from as never, to as never);
      expect(why, `${from} → ${to}`).toBeTruthy();
      expect(why!.length).toBeGreaterThan(8);
    }
  });
});

describe("allowedTargets", () => {
  test("a draft may only be confirmed", () => {
    expect(allowedTargets("draft")).toEqual(["confirmed"]);
  });

  test("nothing else has anywhere to go from this board", () => {
    expect(allowedTargets("confirmed")).toEqual([]);
    expect(allowedTargets("on_route")).toEqual([]);
    expect(allowedTargets("delivered")).toEqual([]);
  });
});

describe("status helpers", () => {
  test("isPreConfirm", () => {
    expect(isPreConfirm("PENDING_CREDIT")).toBe(true);
    expect(isPreConfirm("CONFIRMED")).toBe(false);
  });
  test("isFulfilled", () => {
    expect(isFulfilled("CLOSED")).toBe(true);
    expect(isFulfilled("DRAFT")).toBe(false);
  });
});
