import { describe, expect, test } from "vitest";
import { stageOf, moveRefusal, allowedTargets, STAGES } from "@/components/sales/orderStage";

describe("stageOf", () => {
  test("splits confirmed by whether the order is on a van", () => {
    expect(stageOf("confirmed", false)).toBe("confirmed");
    expect(stageOf("confirmed", true)).toBe("on_route");
  });

  test("a draft is a draft whatever the van says", () => {
    expect(stageOf("draft", true)).toBe("draft");
  });

  test("cancelled orders stay off the board", () => {
    expect(stageOf("cancelled", false)).toBeNull();
  });

  test("every stage it can return has a lane to land in", () => {
    const lanes = new Set(STAGES.map((s) => s.key));
    for (const [status, onRun] of [
      ["draft", false],
      ["confirmed", false],
      ["confirmed", true],
      ["delivered", false],
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
    const moves: [ReturnType<typeof stageOf>, ReturnType<typeof stageOf>][] = [];
    for (const from of STAGES) {
      for (const to of STAGES) {
        if (from.key === to.key) continue;
        if (from.key === "draft" && to.key === "confirmed") continue;
        moves.push([from.key, to.key]);
      }
    }
    expect(moves.length).toBeGreaterThan(0);
    for (const [from, to] of moves) {
      const why = moveRefusal(from!, to!);
      expect(why, `${from} → ${to}`).toBeTruthy();
      expect(why!.length).toBeGreaterThan(8);
    }
  });

  test("confirming is never offered as a way back to a draft", () => {
    expect(moveRefusal("confirmed", "draft")).toBeTruthy();
    expect(moveRefusal("delivered", "draft")).toBeTruthy();
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
