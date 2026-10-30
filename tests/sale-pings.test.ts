import { describe, expect, it } from "vitest";
import { PING_MAX, pingsAfter, type PingOrder } from "@/lib/salePings";

const o = (id: number): PingOrder => ({ id, order_no: String(1000 + id), customer_name: "مشتری", total_toman: id * 1000 });
const newestFirst = (...ids: number[]) => ids.map(o);

describe("pingsAfter", () => {
  it("only reports where the list stands on the first check", () => {
    expect(pingsAfter(newestFirst(9, 8, 7), null)).toEqual({ latest: 9, fresh: [], more: 0 });
  });

  it("returns the orders above the last seen id", () => {
    const r = pingsAfter(newestFirst(9, 8, 7), 7);
    expect(r.fresh.map((x) => x.id)).toEqual([9, 8]);
    expect(r.latest).toBe(9);
  });

  it("returns nothing and keeps the id when nothing is new", () => {
    expect(pingsAfter(newestFirst(9, 8), 9)).toEqual({ latest: 9, fresh: [], more: 0 });
  });

  it("caps the pings and counts the rest", () => {
    const r = pingsAfter(newestFirst(20, 19, 18, 17, 16), 14);
    expect(r.fresh).toHaveLength(PING_MAX);
    expect(r.more).toBe(2);
  });

  it("copes with an empty list", () => {
    expect(pingsAfter([], null)).toEqual({ latest: 0, fresh: [], more: 0 });
  });
});
