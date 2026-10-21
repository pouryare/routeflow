import { describe, it, expect } from "vitest";
import { stopAtDoor } from "@/lib/arrival";

const here = { lat: 35.7, lng: 51.4 };
const stop = (id: number, lat: number | null, lng: number | null, status = "pending") => ({ id, status, lat, lng });

describe("arrival at a stop", () => {
  it("offers the nearest pending stop within 150 m", () => {
    const stops = [stop(1, 35.7005, 51.4), stop(2, 35.7001, 51.4), stop(3, 35.8, 51.4)];
    expect(stopAtDoor(stops, here, new Set())?.id).toBe(2);
  });
  it("never offers a stop that is already delivered or refused", () => {
    expect(stopAtDoor([stop(1, 35.7001, 51.4, "delivered"), stop(2, 35.7001, 51.4, "refused")], here, new Set())).toBeNull();
  });
  it("ignores stops without coordinates and stops that were waved away", () => {
    expect(stopAtDoor([stop(1, null, null)], here, new Set())).toBeNull();
    expect(stopAtDoor([stop(1, 35.7001, 51.4)], here, new Set([1]))).toBeNull();
  });
  it("offers nothing without a position or when too far", () => {
    expect(stopAtDoor([stop(1, 35.7001, 51.4)], null, new Set())).toBeNull();
    expect(stopAtDoor([stop(1, 35.71, 51.4)], here, new Set())).toBeNull();
  });
});
