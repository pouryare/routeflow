import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import { ROLE_LABEL } from "@/lib/roles";
import { faJalaliLong } from "@/lib/jalali";
import ProfileMenu from "@/components/kargah/ProfileMenu";
import TabPill from "@/components/kargah/TabPill";
import Navbar from "@/components/kargah/Navbar";
import Rail from "@/components/kargah/Rail";
import Chrome from "@/components/kargah/Chrome";
import RevealRoute from "@/components/kargah/RevealRoute";
import RouteFade from "@/components/kargah/RouteFade";
import SyncStatus from "@/components/SyncStatus";
import { salesTabs } from "@/lib/salesNav";

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


  return (
    /* `kargah` is the scope the whole design system hangs off. Every token the artifact
       names is defined on this class -- see app/globals.css, "کارگاه". */
    <div className="kargah min-h-screen">
      <Rail />
      <div className="app app--railed">
        <Chrome>
        <Navbar
          tabs={tabs}
          brand={
            <>
              <div className="mark" aria-hidden="true">
                <svg viewBox="0 0 44 24" width="26" height="14" fill="none" stroke="currentColor" strokeWidth="3.6" strokeLinecap="round">
                  <path d="M22 12c-3.2-4.6-6-6.2-9.4-6.2C8.4 5.8 5 8.6 5 12s3.4 6.2 7.6 6.2c3.4 0 6.2-1.6 9.4-6.2Zm0 0c3.2-4.6 6-6.2 9.4-6.2C35.6 5.8 39 8.6 39 12s-3.4 6.2-7.6 6.2c-3.4 0-6.2-1.6-9.4-6.2Z" />
                </svg>
              </div>
              <div>
                <h1>RouteFlow</h1>
                <div className="sub">{faJalaliLong(new Date().toISOString())}</div>
              </div>
            </>
          }
          profile={
            <ProfileMenu
              userId={session.user.id}
              name={session.user.display_name}
              roleLabel={ROLE_LABEL[session.role]}
            />
          }
        />

        <TabPill tabs={tabs} />
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
