import { describe, it, expect } from "vitest";
import { impersonationRefusal, type ImpersonationParty } from "@/lib/impersonation";

const owner: ImpersonationParty = { id: 1, role: "owner", organization_id: 1, active: 1 };
const seller: ImpersonationParty = { id: 2, role: "phone_sales", organization_id: 1, active: 1 };

describe("impersonationRefusal", () => {
  it("lets an active owner act as an active member of their own organisation", () => {
    expect(impersonationRefusal(owner, seller)).toBeNull();
    expect(impersonationRefusal(owner, { ...seller, role: "group_manager" })).toBeNull();
    expect(impersonationRefusal(owner, { ...seller, role: "delivery_driver" })).toBeNull();
  });

  it("refuses anyone who is not an active owner or platform_owner", () => {
    expect(impersonationRefusal({ ...owner, role: "group_manager" }, seller)).not.toBeNull();
    expect(impersonationRefusal({ ...owner, role: "phone_sales" }, seller)).not.toBeNull();
    expect(impersonationRefusal({ ...owner, active: 0 }, seller)).not.toBeNull();
  });

  /* A platform_owner is NOT refused any more. That was the point: the founder is the vendor,
   * and diagnosing a customer he does not work for is what the role is for. The refusals that
   * remain are the ones that are about IDENTITY, not about role — you may not be yourself. */
  it("lets a platform_owner act as anyone, in any tenant", () => {
    expect(impersonationRefusal({ ...owner, role: "platform_owner" }, seller)).toBeNull();
    expect(impersonationRefusal({ ...owner, role: "platform_owner" }, { ...seller, organization_id: 2 })).toBeNull();
    /* Including another owner and another platform owner — UNTOUCHABLE is gone, and
       tests/platform-owner-uniqueness.test.ts is what makes that sound. */
    expect(impersonationRefusal({ ...owner, role: "platform_owner" }, { ...seller, role: "owner" })).toBeNull();
  });

  it("never crosses a tenant for an OWNER, and says so the same way it says 'no such user'", () => {
    const other = { ...seller, organization_id: 2 };
    expect(impersonationRefusal(owner, other)).toBe(impersonationRefusal(owner, null));
  });

  it("refuses yourself and a deactivated account, whoever you are", () => {
    expect(impersonationRefusal(owner, owner)).not.toBeNull();
    expect(impersonationRefusal({ ...owner, role: "platform_owner" }, owner)).not.toBeNull();
    expect(impersonationRefusal(owner, { ...seller, active: 0 })).not.toBeNull();
    expect(impersonationRefusal({ ...owner, role: "platform_owner" }, { ...seller, active: 0 })).not.toBeNull();
  });

  it("answers in Persian", () => {
    expect(impersonationRefusal(owner, owner)).toMatch(/[؀-ۿ]/);
  });
});
