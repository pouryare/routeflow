import { describe, it, expect } from "vitest";
import { accessReview, type AccessUser } from "@/lib/accessReview";

const u = (id: number, role: AccessUser["role"], last: string | null, code = false): AccessUser =>
  ({ id, display_name: `u${id}`, role, last_sign_in: last, has_authenticator: code });

describe("owner access review (FB34)", () => {
  it("counts per role and finds never-signed-in, managers without a code, and idle people", () => {
    const now = "2026-11-05T00:00:00.000Z";
    const r = accessReview([
      u(1, "owner", "2026-11-04T00:00:00.000Z", true),
      u(2, "group_manager", "2026-11-01T00:00:00.000Z"),
      u(3, "phone_sales", null),
      u(4, "phone_sales", "2026-09-01T00:00:00.000Z"),
    ], now);
    expect(r.byRole[0]).toEqual({ role: "phone_sales", n: 2 });
    expect(r.neverSignedIn.map((x) => x.id)).toEqual([3]);
    expect(r.managersWithoutCode.map((x) => x.id)).toEqual([2]);
    expect(r.idle30.map((x) => x.id)).toEqual([4]);
  });
});
