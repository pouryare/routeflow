import { describe, it, expect } from "vitest";
import { chequeBulk, toggleId } from "@/lib/selection";

describe("selection mode", () => {
  it("toggle adds then removes without mutating", () => {
    const a = new Set([1]);
    expect([...toggleId(a, 2)].sort()).toEqual([1, 2]);
    expect([...a]).toEqual([1]);
    expect([...toggleId(a, 1)]).toEqual([]);
  });
  it("bulk only touches cheques the server would allow, and counts the rest", () => {
    const cheques = [
      { id: 1, status: "in_hand" as const },
      { id: 2, status: "in_hand" as const },
      { id: 3, status: "deposited" as const },
      { id: 4, status: "cleared" as const },
    ];
    expect(chequeBulk(cheques, new Set([1, 2, 3, 4]), "deposited")).toEqual({ ids: [1, 2], skipped: 2 });
    expect(chequeBulk(cheques, new Set([3]), "cleared")).toEqual({ ids: [3], skipped: 0 });
    expect(chequeBulk(cheques, new Set(), "deposited")).toEqual({ ids: [], skipped: 0 });
  });
});
