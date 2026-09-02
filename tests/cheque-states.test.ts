import { describe, it, expect } from "vitest";
import {
  CHEQUE_TRANSITIONS,
  canAdvanceCheque,
  CHEQUE_STATUS_LABEL,
  type ChequeStatus,
} from "@/lib/chequeStates";

describe("CHEQUE_TRANSITIONS", () => {
  it("allows in_hand -> deposited but not in_hand -> cleared", () => {
    expect(canAdvanceCheque("in_hand", "deposited")).toBe(true);
    expect(canAdvanceCheque("in_hand", "cleared")).toBe(false);
  });

  it("only lets a deposited cheque clear or bounce", () => {
    expect(CHEQUE_TRANSITIONS.deposited).toEqual(["cleared", "bounced"]);
  });

  it("only lets bounced go to replaced", () => {
    expect(CHEQUE_TRANSITIONS.bounced).toEqual(["replaced"]);
  });

  it("treats cleared / replaced / cancelled as terminal", () => {
    for (const t of ["cleared", "replaced", "cancelled"] as ChequeStatus[]) {
      expect(CHEQUE_TRANSITIONS[t]).toEqual([]);
      expect(canAdvanceCheque(t, "in_hand")).toBe(false);
    }
  });

  it("has a Persian label for every status", () => {
    for (const s of Object.keys(CHEQUE_TRANSITIONS) as ChequeStatus[]) {
      expect(CHEQUE_STATUS_LABEL[s]).toBeTruthy();
    }
  });
});
