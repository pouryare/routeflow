import { describe, it, expect } from "vitest";
import { ROLES, OWNER_ROLES, type Role } from "@/lib/roles";

process.env.SESSION_SECRET = "test-secret";

const { proxy } = await import("@/proxy");
const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");
const { accountLinks } = await import("@/lib/accountLinks");
const { NextRequest } = await import("next/server");

function req(pathname: string, role: Role) {
  const token = createSessionToken({ uid: 1, role, gid: role === "owner" ? null : 2, oid: 1, tv: 0, name: "t" });
  return new NextRequest(`http://localhost${pathname}`, { headers: { cookie: `${COOKIE_NAME}=${token}` } });
}

/** The avatar menu and «حساب من» print these; each one must open for the role it is shown to. */
describe("account links", () => {
  for (const role of ROLES) {
    it(`every link shown to ${role} gets past the gate`, () => {
      for (const l of accountLinks({ role })) {
        const res = proxy(req(l.href, role));
        expect(res.headers.get("location"), `${l.href} for ${role}`).toBeNull();
      }
    });
  }

  it("offers «ورود به‌عنوان…» to exactly the roles /switch admits", () => {
    for (const role of ROLES) {
      const shown = accountLinks({ role }).some((l) => l.href === "/switch");
      expect(shown, role).toBe(OWNER_ROLES.includes(role));
    }
  });

  it("does not offer the map to a van role", () => {
    for (const role of ["field_rep", "delivery_driver"] as Role[]) {
      expect(accountLinks({ role }).map((l) => l.href)).not.toContain("/map");
    }
  });

  it("gives every role its own settings", () => {
    for (const role of ROLES) {
      const hrefs = accountLinks({ role }).map((l) => l.href);
      expect(hrefs).toContain("/settings/notifications");
      expect(hrefs).toContain("/settings/security");
    }
  });
});
