import { describe, it, expect } from "vitest";
import { ACTIONS, actionsFor, matchActions } from "@/lib/actionList";
import { appTabs } from "@/lib/appNav";
import { ROLES } from "@/lib/roles";

describe("T14 one action list", () => {
  it("never offers a role an action whose page is not one of its ready tabs", () => {
    for (const role of ROLES) {
      const ready = new Set(appTabs({ role }).filter((t) => t.ready).map((t) => t.href));
      for (const place of ["ctrlk", "customer-selection"] as const)
        for (const a of actionsFor(role, place)) expect(ready.has(a.tab), `${role} ${a.id}`).toBe(true);
    }
  });
  it("hides cheques from a role without the cheques tab, and the shareholder sees nothing", () => {
    expect(matchActions("owner", "چک").map((a) => a.id)).toContain("go-cheques");
    expect(matchActions("phone_sales", "چک").map((a) => a.id)).not.toContain("go-cheques");
    expect(ROLES.includes("shareholder")).toBe(true);
    expect(actionsFor("shareholder", "ctrlk")).toEqual([]);
  });
  it("matches by label or extra words, needs every word, and ids are unique", () => {
    expect(matchActions("owner", "بنزین").map((a) => a.id)).toContain("log-expense");
    expect(matchActions("owner", "هزینه بنزین").length).toBe(1);
    expect(matchActions("owner", "  ")).toEqual([]);
    expect(new Set(ACTIONS.map((a) => a.id)).size).toBe(ACTIONS.length);
  });
  it("builds the map link from the picked ids", () => {
    const a = ACTIONS.find((x) => x.id === "customers-on-map")!;
    expect(a.href!([3, 5])).toMatch(/^\/map\?/);
  });
});
