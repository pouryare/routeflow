import { describe, it, expect } from "vitest";
process.env.ROUTEFLOW_DB_PATH = `${process.env.TMPDIR ?? "/tmp"}/rf-vehicles-${Date.now()}.db`;
process.env.SESSION_SECRET = "test-secret";

const { createVehicle } = await import("@/lib/repo/routing");

describe("createVehicle input checks", () => {
  it("refuses a negative or absurd number, a long name and a driver from nowhere", async () => {
    await expect(createVehicle(1, { name: "v", max_weight_kg: -5 })).rejects.toThrow();
    await expect(createVehicle(1, { name: "v", max_stops: 1e15 })).rejects.toThrow();
    await expect(createVehicle(1, { name: "x".repeat(101) })).rejects.toThrow();
    await expect(createVehicle(1, { name: "v", driver_default_id: 999999 })).rejects.toThrow();
  });
});
