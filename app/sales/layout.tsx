import type { ReactNode } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import { ROLE_LABEL } from "@/lib/roles";
import { faJalaliLong } from "@/lib/jalali";
import SkinToggle from "@/components/kargah/SkinToggle";
import AccentPicker from "@/components/AccentPicker";
import FontPicker from "@/components/FontPicker";
import TabPill from "@/components/kargah/TabPill";
import Chrome from "@/components/kargah/Chrome";
import RevealRoute from "@/components/kargah/RevealRoute";
import RouteFade from "@/components/kargah/RouteFade";
import SyncStatus from "@/components/SyncStatus";
import { SALES_GROUPS, salesTabs } from "@/lib/salesNav";

export const dynamic = "force-dynamic";

/** The sales section's chrome, laid out exactly as the approved artifact draws it:
 *  gradient mark, title with the date beneath, the map chip, the sun/moon toggle, and
 *  the viewer's initial — then the travelling tab pill.
 *
 *  proxy.ts has already refused a driver by the time this renders -- the redirect below
 *  is the belt to its braces, because a coarse gate on a cookie is not an authorisation
 *  decision and this layout wraps pages that read real figures.
 */
export default async function SalesLayout({ children }: { children: ReactNode }) {
  const jar = await cookies();
  const session = getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (session.role === "driver") redirect("/driver");

  const tabs = salesTabs(session);

  const initial = session.user.display_name.trim()[0] ?? "؟";

  return (
    /* `kargah` is the scope the whole design system hangs off. Every token the artifact
       names is defined on this class -- see app/globals.css, "کارگاه". */
    <div className="kargah min-h-screen">
      <div className="app">
        <Chrome>
        <div className="top">
          <div className="brandwrap">
            <div className="mark">ف</div>
            <div>
              <h1>فروش و سفارش‌ها</h1>
              <div className="sub">{faJalaliLong(new Date().toISOString())}</div>
            </div>
          </div>
          <div className="topright">
            <Link className="chip" href="/map">↗ نقشه</Link>
            <SkinToggle />
            <FontPicker />
            <AccentPicker />
            <div className="me" title={`${session.user.display_name} · ${ROLE_LABEL[session.role]}`}>
              {initial}
            </div>
          </div>
        </div>

        <TabPill tabs={tabs} groups={SALES_GROUPS} />
        </Chrome>

        {/* One entrance for every sales screen — see RevealRoute for why it is not
            wired per page. RouteFade fades the whole view in on navigation (a
            key={pathname} remount + CSS keyframe); the per-card cascade layers on top. */}
        <RevealRoute />
        <RouteFade>{children}</RouteFade>
      </div>
      <SyncStatus />
    </div>
  );
}
