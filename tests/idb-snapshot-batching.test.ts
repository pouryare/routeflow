import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

describe("IdbOutboxStore snapshot writes", () => {
  const src = readFileSync("lib/offline/idbStore.ts", "utf8");
  const body = (name: string) => new RegExp(`async ${name}\\([\\s\\S]*?\\n  }\\n`).exec(src)?.[0] ?? "";

  it("saves rows in grouped transactions, not one transaction per row", () => {
    for (const fn of ["writeSnapshot", "deleteSnapshot"]) {
      const b = body(fn);
      expect(b, fn).toContain("txBatch(");
      expect(b, fn).toContain("WRITE_GROUP");
      expect(b, fn).not.toMatch(/await tx\(db, SNAPSHOT, "readwrite"/);
    }
  });

  it("gives the screen a turn between groups", () => {
    expect(body("writeSnapshot")).toContain("breathe()");
  });
});
