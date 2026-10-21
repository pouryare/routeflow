import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/* A Response body can be read once. A module-level `const X = NextResponse.json(...)` is handed
   to every request, so from the second one on the client got an empty 404. */
describe("route files do not share a response object between requests", () => {
  it.each([
    "app/api/sales/orders/[id]/route.ts",
    "app/api/sales/runs/[id]/route.ts",
    "app/api/sales/runs/[id]/stops/route.ts",
  ])("%s", (file) => {
    expect(readFileSync(file, "utf8")).not.toMatch(/^(export )?const \w+ = NextResponse\./m);
  });
});
