import { describe, expect, it } from "vitest";
import { canViewUserAvatar } from "@/lib/avatarAccess";

describe("canViewUserAvatar", () => {
  it("allows viewing within the same organization, any non-platform role", () => {
    expect(canViewUserAvatar({ role: "salesperson", organizationId: 1 }, 1)).toBe(true);
    expect(canViewUserAvatar({ role: "owner", organizationId: 1 }, 1)).toBe(true);
  });

  it("denies viewing across organizations for an ordinary role", () => {
    expect(canViewUserAvatar({ role: "owner", organizationId: 1 }, 2)).toBe(false);
    expect(canViewUserAvatar({ role: "driver", organizationId: 1 }, 2)).toBe(false);
  });

  it("a platform_owner may view any organization's avatar", () => {
    expect(canViewUserAvatar({ role: "platform_owner", organizationId: 1 }, 2)).toBe(true);
    expect(canViewUserAvatar({ role: "platform_owner", organizationId: 1 }, 999)).toBe(true);
  });
});
