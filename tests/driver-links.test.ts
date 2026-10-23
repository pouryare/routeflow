import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { driverLinks } from "@/lib/driverLinks";
import DriverLinks from "@/components/driver/DriverLinks";
import type { Role } from "@/lib/roles";

process.env.SESSION_SECRET = "test-secret";
const { proxy } = await import("@/proxy");
const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");
const { NextRequest } = await import("next/server");

const VANS: Role[] = ["delivery_driver", "field_rep"];

/** /driver has no bar and no header menu; this row is the only way to the academy and settings. */
describe("links out of /driver", () => {
  it.each(VANS)("%s: the academy and both settings pages, never /driver itself", (role) => {
    const hrefs = driverLinks({ role }).map((l) => l.href);
    expect(hrefs).toEqual(["/sales/academy", "/settings/notifications", "/settings/security"]);
  });

  it.each(VANS)("%s: every link gets past the gate", (role) => {
    const token = createSessionToken({ uid: 1, role, gid: 2, oid: 1, tv: 0, name: "t" });
    for (const l of driverLinks({ role })) {
      const res = proxy(new NextRequest(`http://localhost${l.href}`, { headers: { cookie: `${COOKIE_NAME}=${token}` } }));
      expect(res.headers.get("location"), l.href).toBeNull();
    }
  });

  it("renders each as a word with its icon, as a full-size target", () => {
    const h = renderToStaticMarkup(createElement(DriverLinks, { links: driverLinks({ role: "delivery_driver" }) }));
    for (const w of ["آموزش", "تنظیمات اعلان‌ها", "امنیت و ورود"]) expect(h).toContain(w);
    expect((h.match(/<svg/g) ?? []).length).toBe(3);
    expect(h).toContain("min-h-11");
  });
});
