import { describe, it, expect } from "vitest";
import { chequeAgenda } from "@/lib/chequeAgenda";

describe("T8 cheque agenda", () => {
  it("groups the cheques in hand by due day with a sum, soonest first, and leaves the others out", () => {
    const a = chequeAgenda([
      { id: 1, amount_toman: 100, due_date: "2026-01-10", status: "in_hand" },
      { id: 2, amount_toman: 50, due_date: "2026-01-10", status: "in_hand" },
      { id: 3, amount_toman: 30, due_date: "2026-01-08", status: "in_hand" },
      { id: 4, amount_toman: 99, due_date: "2026-01-09", status: "deposited" },
    ]);
    expect(a.map((d) => [d.date, d.totalToman, d.items.length])).toEqual([["2026-01-08", 30, 1], ["2026-01-10", 150, 2]]);
  });
});
