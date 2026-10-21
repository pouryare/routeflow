import { describe, it, expect } from "vitest";
import { isAllowedPushRequest, pushActionFor } from "@/lib/pushActions";
import { CHEQUE_TRANSITIONS } from "@/lib/chequeStates";

const due = { type_code: "cheque.due_soon", entity_type: "cheque", entity_id: 12 };

describe("push notification actions", () => {
  it("a cheque in hand offers «deposited», a deposited one offers «cleared», both real transitions", () => {
    const a = pushActionFor(due, "in_hand")!;
    expect(a.request).toEqual({ url: "/api/cheques/12", method: "PATCH", body: { action: "advance", to: "deposited" } });
    expect(CHEQUE_TRANSITIONS.in_hand).toContain("deposited");
    const b = pushActionFor(due, "deposited")!;
    expect(b.request.body).toEqual({ action: "advance", to: "cleared" });
    expect(CHEQUE_TRANSITIONS.deposited).toContain("cleared");
  });
  it("a cheque in any other state, or a different kind of notification, gets no button", () => {
    expect(pushActionFor(due, "cleared")).toBeNull();
    expect(pushActionFor(due, null)).toBeNull();
    expect(pushActionFor({ type_code: "order.confirmed", entity_type: "order", entity_id: 1 }, null)).toBeNull();
    expect(pushActionFor({ ...due, entity_id: null }, "in_hand")).toBeNull();
  });
  it("the service worker only makes relative /api/ requests", () => {
    expect(isAllowedPushRequest("/api/cheques/12")).toBe(true);
    expect(isAllowedPushRequest("https://evil.example/api/x")).toBe(false);
    expect(isAllowedPushRequest("//evil.example/api/x")).toBe(false);
    expect(isAllowedPushRequest("/api/../admin")).toBe(false);
    expect(isAllowedPushRequest("/other")).toBe(false);
  });
});
