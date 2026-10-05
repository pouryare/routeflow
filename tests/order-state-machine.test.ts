import { describe, it, expect } from "vitest";
import {
  ORDER_TRANSITIONS,
  orderTransition,
  legalOrderActions,
  canAdvanceOrder,
  ORDER_STATUS_LABEL,
  ORDER_STATUS_TONE,
  TERMINAL_ORDER_STATUSES,
  isTerminalOrderStatus,
  ORDER_STATUSES,
  type OrderStatus,
} from "@/lib/orderStateMachine";

describe("ORDER_TRANSITIONS", () => {
  it("submits a draft into review", () => {
    expect(orderTransition("DRAFT", "submit")?.to).toBe("PENDING_REVIEW");
  });

  it("has no direct DRAFT -> deliver edge", () => {
    expect(orderTransition("DRAFT", "deliver")).toBeUndefined();
  });

  it("gives a driver exactly the four door outcomes from OUT_FOR_DELIVERY", () => {
    /* FOUR, not three: returnOrder joins deliver / deliverPartial / failDelivery.
     *
     * It was previously a manager-only action reachable only from DELIVERED or
     * PARTIALLY_DELIVERED -- states the driver never reaches. A driver who brings back goods
     * the customer also refused had no move at all: no edge, no status, and the order stuck
     * OUT_FOR_DELIVERY with goods physically on the van and nobody able to record it.
     *
     * "Exactly" is the part that matters. The list is closed on purpose, so an edge added
     * without a decision shows up here rather than being discovered in the field. */
    expect(legalOrderActions("OUT_FOR_DELIVERY", "delivery_driver").sort()).toEqual(
      ["deliver", "deliverPartial", "failDelivery", "returnOrder"].sort()
    );
  });

  it("returns the goods the customer took back, consuming the reservation", () => {
    /* Consuming reservations is deliberate and counterintuitive: the goods were NOT handed
     * over, but they DID move -- off the van, and back onto it. Reservations are consumed by
     * movement, not by receipt. Omitting it would leave stock reserved against goods now
     * sitting in a warehouse, which cannot be sold from this order. */
    const t = orderTransition("OUT_FOR_DELIVERY", "returnOrder");
    expect(t?.to).toBe("RETURNED");
    expect(t?.effects).toContain("consumeReservations");
    expect(t?.effects).toContain("stampReturned");
  });

  it("does not let a phone seller return goods from the road", () => {
    expect(canAdvanceOrder("OUT_FOR_DELIVERY", "returnOrder", "phone_sales")).toBe(false);
    expect(canAdvanceOrder("OUT_FOR_DELIVERY", "returnOrder", "delivery_driver")).toBe(true);
  });

  it("lets only a manager or owner approve a credit hold", () => {
    expect(canAdvanceOrder("PENDING_CREDIT", "approveCredit", "phone_sales")).toBe(false);
    expect(canAdvanceOrder("PENDING_CREDIT", "approveCredit", "group_manager")).toBe(true);
    expect(canAdvanceOrder("PENDING_CREDIT", "approveCredit", "owner")).toBe(true);
  });

  it("only lets the system flag credit", () => {
    expect(canAdvanceOrder("PENDING_REVIEW", "flagCredit", "group_manager")).toBe(false);
    expect(canAdvanceOrder("PENDING_REVIEW", "flagCredit", "system")).toBe(true);
  });

  it("carries reserveStock on both routes into CONFIRMED", () => {
    expect(orderTransition("PENDING_REVIEW", "passReview")?.effects).toContain("reserveStock");
    expect(orderTransition("PENDING_CREDIT", "approveCredit")?.effects).toContain("reserveStock");
  });

  it("releases reservations on every cancel edge and on a failed delivery", () => {
    const cancels = ORDER_TRANSITIONS.filter((t) => t.action === "cancel");
    expect(cancels.length).toBeGreaterThan(0);
    for (const t of cancels) expect(t.effects).toContain("releaseReservations");
    expect(orderTransition("OUT_FOR_DELIVERY", "failDelivery")?.effects).toContain(
      "releaseReservations"
    );
  });

  it("spawns a backorder only when a partial delivery settles", () => {
    expect(orderTransition("PARTIALLY_DELIVERED", "settle")?.effects).toContain("spawnBackorder");
    expect(orderTransition("DELIVERED", "settle")?.effects ?? []).not.toContain("spawnBackorder");
  });

  it("retries a failed delivery back to PLANNED", () => {
    expect(orderTransition("DELIVERY_FAILED", "retryDelivery")?.to).toBe("PLANNED");
  });

  it("has a label and a tone for all 14 statuses", () => {
    expect(ORDER_STATUSES).toHaveLength(14);
    for (const s of ORDER_STATUSES) {
      expect(ORDER_STATUS_LABEL[s]).toBeTruthy();
      expect(ORDER_STATUS_TONE[s]).toBeTruthy();
    }
  });

  it("treats CLOSED, CANCELLED and RETURNED as terminal and nothing else", () => {
    expect([...TERMINAL_ORDER_STATUSES].sort()).toEqual(["CANCELLED", "CLOSED", "RETURNED"]);
    for (const s of ORDER_STATUSES) {
      const hasOut = ORDER_TRANSITIONS.some((t) => t.from === s);
      expect(isTerminalOrderStatus(s)).toBe(!hasOut);
    }
  });

  it("only names known statuses as from/to", () => {
    const known = new Set<OrderStatus>(ORDER_STATUSES);
    for (const t of ORDER_TRANSITIONS) {
      expect(known.has(t.from), `from ${t.from}`).toBe(true);
      expect(known.has(t.to), `to ${t.to}`).toBe(true);
    }
  });

  it("reaches every non-terminal state from DRAFT", () => {
    const seen = new Set<OrderStatus>(["DRAFT"]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const t of ORDER_TRANSITIONS) {
        if (seen.has(t.from) && !seen.has(t.to)) {
          seen.add(t.to);
          grew = true;
        }
      }
    }
    for (const s of ORDER_STATUSES) expect(seen.has(s), `unreachable: ${s}`).toBe(true);
  });
});
