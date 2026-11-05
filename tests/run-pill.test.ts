import { describe, it, expect } from "vitest";
import { runPillOf } from "@/lib/runPill";

const stop = (id: number, status: string) => ({ id, status, customer_name: `m${id}` });

describe("live run pill", () => {
  it("names the first pending stop, its place and how many are done", () => {
    const m = runPillOf([stop(1, "delivered"), stop(2, "refused"), stop(3, "pending"), stop(4, "pending")]);
    expect(m).toEqual({ index: 3, total: 4, doneCount: 2, nextId: 3, name: "m3" });
  });
  it("a deferred stop that sits earlier is still the next one while pending", () => {
    expect(runPillOf([stop(1, "pending"), stop(2, "delivered")])?.nextId).toBe(1);
  });
  it("is absent when nothing is pending", () => {
    expect(runPillOf([stop(1, "delivered")])).toBeNull();
    expect(runPillOf([])).toBeNull();
  });
});
