import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { ROLES, SELL_ROLES, canSell } from "@/lib/roles";
import { quickActionsFor } from "@/lib/mobileNav";

/** «ثبت سفارش تازه» is offered only to a role whose order the API will accept. A rep manager
 *  reads the orders list but cannot sell; before this, five buttons offered them a form whose
 *  save was refused at the last tap. */
describe("who is offered a new order", () => {
  it("everyone but the rep manager and the shareholder sells", () => {
    expect(ROLES.filter((r) => !canSell(r))).toEqual(["rep_manager", "shareholder"]);
  });

  it("the order API admits exactly SELL_ROLES", () => {
    const src = fs.readFileSync("app/api/sales/orders/route.ts", "utf8");
    expect(src).toMatch(/const CAN_SELL = SELL_ROLES;/);
    expect(SELL_ROLES).not.toContain("rep_manager");
  });

  it("the quick action follows the same rule", () => {
    for (const role of ROLES) {
      expect(quickActionsFor({ role }).some((a) => a.id === "order"), role).toBe(
        canSell(role) && !["field_rep", "delivery_driver"].includes(role),
      );
    }
  });

  it.each([
    "app/(shell)/sales/orders/page.tsx",
    "components/meridian/CustomerSheet.tsx",
    "components/crm/BusinessProfile.tsx",
    "app/(shell)/crm/[id]/page.tsx",
    "components/PurchaseHistory.tsx",
    "components/pocket/Pocket.tsx",
  ])("%s asks before offering it", (file) => {
    const src = fs.readFileSync(file, "utf8");
    expect(src).toMatch(/canSell\(|mayOrder &&|canOrder &&/);
  });

  it("the form itself explains, instead of failing on save", () => {
    const src = fs.readFileSync("app/(shell)/sales/orders/new/page.tsx", "utf8");
    expect(src).toMatch(/if \(!canSell\(session\.role\)\)/);
    expect(src).toContain("این نقش سفارش ثبت نمی‌کند");
  });

  it("the pocket offers the planner only to roles that can open it", () => {
    expect(fs.readFileSync("components/pocket/Pocket.tsx", "utf8")).toMatch(/\{canPlan && <Link className="btn ghost" href="\/planner">/);
  });
});
