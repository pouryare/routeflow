import { describe, it, expect } from "vitest";
import { snapshotDeletes, snapshotTableFor } from "@/lib/offline/snapshotDeletes";

describe("snapshotTableFor", () => {
  it("accepts the table name and the older singular spelling", () => {
    expect(snapshotTableFor("delivery_stops")).toBe("delivery_stops");
    expect(snapshotTableFor("order_line")).toBe("order_lines");
  });

  it("ignores a type the device never holds", () => {
    expect(snapshotTableFor("tasks")).toBeNull();
  });
});

describe("snapshotDeletes", () => {
  it("turns tombstones into snapshot keys, once each", () => {
    const keys = snapshotDeletes(
      [
        { entity_type: "orders", entity_id: 4 },
        { entity_type: "orders", entity_id: 4 },
        { entity_type: "order_line", entity_id: 9 },
        { entity_type: "notes", entity_id: 1 },
      ],
      []
    );
    expect(keys).toEqual([
      ["orders", 4],
      ["order_lines", 9],
    ]);
  });

  it("keeps a row the same pull sends again (a reused id)", () => {
    const keys = snapshotDeletes(
      [{ entity_type: "customers", entity_id: 7 }],
      [{ table: "customers", row: { id: 7 } }]
    );
    expect(keys).toEqual([]);
  });
});
