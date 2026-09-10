import { describe, it, expect } from "vitest";
import { eventsByStep, stepOfStatus, type OrderEventRow } from "@/lib/orderEvents";
import { ORDER_STATUSES } from "@/lib/orderStateMachine";

const ev = (id: number, to: string, from: string | null = null): OrderEventRow => ({
  id, from_status: from, to_status: to, action: "x", actor_name: null, note: null, at: "2026-09-01T10:00:00.000Z",
});

describe("stepOfStatus", () => {
  it("every order status lands under one of the four milestones", () => {
    for (const s of ORDER_STATUSES) expect(["placed", "confirmed", "loaded", "settled"]).toContain(stepOfStatus(s));
  });

  it("gates before confirmation belong to placing the order", () => {
    for (const s of ["DRAFT", "PENDING_REVIEW", "PENDING_CREDIT", "ON_HOLD"]) expect(stepOfStatus(s)).toBe("placed");
  });

  it("a failed delivery is part of delivery, not of planning", () => {
    expect(stepOfStatus("DELIVERY_FAILED")).toBe("settled");
    expect(stepOfStatus("READY")).toBe("loaded");
  });
});

describe("eventsByStep", () => {
  it("keeps the log's order inside each milestone", () => {
    const g = eventsByStep([ev(1, "DRAFT"), ev(2, "PENDING_REVIEW", "DRAFT"), ev(3, "CONFIRMED", "PENDING_REVIEW")]);
    expect(g.placed.map((e) => e.id)).toEqual([1, 2]);
    expect(g.confirmed.map((e) => e.id)).toEqual([3]);
    expect(g.loaded).toEqual([]);
  });
});
