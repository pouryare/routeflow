import type { ReactNode } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import { faJalaliLong } from "@/lib/jalali";
import SkinToggle from "@/components/kargah/SkinToggle";
import TabPill from "@/components/kargah/TabPill";
import RevealRoute from "@/components/kargah/RevealRoute";

export const dynamic = "force-dynamic";

/** Administration, inside the same shell as everything else.
 *
 *  These two pages used to live outside the design system entirely — their own <main>,
 *  their own monospace "Admin" kicker, and no way to reach them except by typing the URL.
 *  They are part of the app, so they wear its chrome and sit in its navigation.
 *
 *  proxy.ts already refuses a non-owner before this renders; the redirect is the belt to
 *  its braces, because a coarse gate on a cookie is not an authorisation decision.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const jar = await cookies();
  const session = getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (session.role !== "owner") redirect("/sales");

  const tabs = [
    { href: "/admin/users", label: "کاربران", ready: true },
    { href: "/admin/groups", label: "گروه‌ها و محدوده‌ها", ready: true },
  ];

  return (
    <div className="kargah min-h-screen">
      <div className="app">
        <div className="top">
          <div className="brandwrap">
            <div className="mark">م</div>
            <div>
              <h1>مدیریت</h1>
              <div className="sub">{faJalaliLong(new Date().toISOString())}</div>
            </div>
          </div>
          <div className="topright">
            <Link className="chip" href="/sales">↗ فروش</Link>
            <Link className="chip" href="/map">↗ نقشه</Link>
            <SkinToggle />
          </div>
        </div>

        <TabPill tabs={tabs} />
        <RevealRoute />
        {children}
      </div>
    </div>
  );
}
