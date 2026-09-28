import { describe, it, expect } from "vitest";
import { impersonationRefusal } from "@/lib/impersonation";

/* Spec §4.6-4.7. The founder is a platform_owner, not an owner, so today's
 * `role === "owner"` check refuses him outright; and the same-org rule refuses every
 * cross-tenant switch, which is the whole point of the tool.
 *
 * UNTOUCHABLE is REMOVED — but that is only safe while there is exactly one
 * platform_owner, and tests/platform-owner-uniqueness.test.ts is what holds that. The two
 * tests are a package: relaxing one and keeping the other is the failure this file's comment
 * exists to prevent. */

const founder = { id: 1, role: "platform_owner", organization_id: 1, active: 1 };
const owner = { id: 2, role: "owner", organization_id: 1, active: 1 };
const driver = { id: 5, role: "delivery_driver", organization_id: 1, active: 1, group_id: 1 };
const otherTenantOwner = { id: 9, role: "owner", organization_id: 2, active: 1 };

describe("impersonationRefusal", () => {
  it("lets the founder switch into his own driver", () => {
    expect(impersonationRefusal(founder, driver)).toBeNull();
  });

  it("lets the founder switch across tenants", () => {
    expect(impersonationRefusal(founder, otherTenantOwner)).toBeNull();
  });

  it("lets the founder act as a tenant's OWNER, which UNTOUCHABLE used to forbid", () => {
    // This is the one that is only safe because there is exactly one platform_owner. A
    // second one would make this "two platform owners may act as each other".
    expect(impersonationRefusal(founder, { ...owner, id: 3 })).toBeNull();
  });

  it("still refuses a plain owner crossing tenants", () => {
    expect(impersonationRefusal(owner, { ...driver, organization_id: 2 })).not.toBeNull();
  });

  it("still refuses switching into yourself", () => {
    expect(impersonationRefusal(founder, { ...founder, id: 1 })).not.toBeNull();
  });

  it("still refuses a deactivated target", () => {
    expect(impersonationRefusal(founder, { ...driver, active: 0 })).not.toBeNull();
  });

  it("still refuses a deactivated actor", () => {
    expect(impersonationRefusal({ ...founder, active: 0 }, driver)).not.toBeNull();
  });

  it("still refuses a manager who is neither owner nor platform_owner", () => {
    expect(impersonationRefusal({ ...owner, role: "group_manager" }, driver)).not.toBeNull();
    expect(impersonationRefusal({ ...owner, role: "phone_sales" }, driver)).not.toBeNull();
  });

  it("still refuses a missing target", () => {
    expect(impersonationRefusal(founder, null)).not.toBeNull();
  });

  it("an owner can still act as their own people, same as before", () => {
    expect(impersonationRefusal(owner, driver)).toBeNull();
  });
});
