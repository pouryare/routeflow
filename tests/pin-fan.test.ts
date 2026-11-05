import { describe, it, expect } from "vitest";
import { pinActions } from "@/lib/pinFan";

const c = { id: 7, business_name: "کافه", phone: "09120000000", lat: 35.7, lng: 51.4 };

describe("pin fan actions", () => {
  it("offers call, order and navigate when all can work", () => {
    const a = pinActions(c, { canOrder: true, navAppId: "google" });
    expect(a.map((x) => x.id)).toEqual(["call", "order", "navigate"]);
    expect(a[0].href).toBe("tel:09120000000");
    expect(a[1].href).toBe("/sales/orders/new?customer=7");
  });
  it("leaves out what cannot work: no phone, no selling role, no coordinates", () => {
    expect(pinActions({ ...c, phone: null }, { canOrder: true, navAppId: "google" }).map((x) => x.id)).toEqual(["order", "navigate"]);
    expect(pinActions(c, { canOrder: false, navAppId: "google" }).map((x) => x.id)).toEqual(["call", "navigate"]);
    expect(pinActions({ ...c, lat: null }, { canOrder: false, navAppId: "google" }).map((x) => x.id)).toEqual(["call"]);
  });
});
