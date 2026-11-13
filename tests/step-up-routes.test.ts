import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/** UIB-A2: the sensitive actions that have a route ask for the code there. A route that drops its
 *  guard fails here before it ships. (Own-mobile change has no route yet; it gets its line when it does.) */
const GUARDED: [string, string][] = [
  ["app/api/admin/users/route.ts", "create_manager"],
  ["app/api/sales/orders/[id]/transition/route.ts", "order_change_delivered"],
  ["app/api/admin/groups/[id]/route.ts", "hard_delete"],
  ["app/api/districts/[id]/route.ts", "hard_delete"],
  ["app/api/admin/data/export/route.ts", "export_customers"],
  ["app/api/admin/data/import/route.ts", "import_overwrite"],
];

describe("code guard on sensitive routes", () => {
  it.each(GUARDED)("%s asks before %s", (file, action) => {
    const src = readFileSync(path.join(__dirname, "..", file), "utf8");
    expect(src).toMatch(new RegExp(`guardStepUp\\(req, guard\\.session, "${action}"\\)`));
  });
});
