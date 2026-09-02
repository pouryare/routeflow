import { describe, it, expect } from "vitest";
import {
  BATCH_TRANSITIONS,
  canTransitionBatch,
  BATCH_STATUS_LABEL,
  type BatchStatus,
} from "@/lib/batchStates";

describe("BATCH_TRANSITIONS", () => {
  it("lets active be quarantined or recalled", () => {
    expect(canTransitionBatch("active", "quarantined")).toBe(true);
    expect(canTransitionBatch("active", "recalled")).toBe(true);
  });

  it("only lets recalled move to depleted", () => {
    expect(BATCH_TRANSITIONS.recalled).toEqual(["depleted"]);
    expect(canTransitionBatch("recalled", "active")).toBe(false);
  });

  it("lets a depleted batch revive to active", () => {
    expect(canTransitionBatch("depleted", "active")).toBe(true);
  });

  it("has a Persian label for every status", () => {
    for (const s of Object.keys(BATCH_TRANSITIONS) as BatchStatus[]) {
      expect(BATCH_STATUS_LABEL[s]).toBeTruthy();
    }
  });
});
