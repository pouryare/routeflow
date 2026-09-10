import { describe, it, expect } from "vitest";
import { impersonationRefusal, type ImpersonationParty } from "@/lib/impersonation";

const owner: ImpersonationParty = { id: 1, role: "owner", organization_id: 1, active: 1 };
const seller: ImpersonationParty = { id: 2, role: "salesperson", organization_id: 1, active: 1 };

describe("impersonationRefusal", () => {
  it("lets an active owner act as an active member of their own organisation", () => {
    expect(impersonationRefusal(owner, seller)).toBeNull();
    expect(impersonationRefusal(owner, { ...seller, role: "group_manager" })).toBeNull();
    expect(impersonationRefusal(owner, { ...seller, role: "driver" })).toBeNull();
  });

  it("refuses anyone who is not an active owner", () => {
    expect(impersonationRefusal({ ...owner, role: "group_manager" }, seller)).not.toBeNull();
    expect(impersonationRefusal({ ...owner, role: "platform_owner" }, seller)).not.toBeNull();
    expect(impersonationRefusal({ ...owner, active: 0 }, seller)).not.toBeNull();
  });

  it("never crosses a tenant, and says so the same way it says 'no such user'", () => {
    const other = { ...seller, organization_id: 2 };
    expect(impersonationRefusal(owner, other)).toBe(impersonationRefusal(owner, null));
  });

  it("refuses yourself, another owner, a platform owner and a deactivated account", () => {
    expect(impersonationRefusal(owner, owner)).not.toBeNull();
    expect(impersonationRefusal(owner, { ...seller, role: "owner" })).not.toBeNull();
    expect(impersonationRefusal(owner, { ...seller, role: "platform_owner" })).not.toBeNull();
    expect(impersonationRefusal(owner, { ...seller, active: 0 })).not.toBeNull();
  });

  it("answers in Persian", () => {
    expect(impersonationRefusal(owner, owner)).toMatch(/[؀-ۿ]/);
  });
});
