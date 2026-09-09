import { cookies } from "next/headers";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import { ROLE_LABEL } from "@/lib/roles";
import { faJalaliLong } from "@/lib/jalali";
import ProfileMenu from "@/components/meridian/ProfileMenu";
import NotificationBell from "@/components/NotificationBell";
import TabPill from "@/components/meridian/TabPill";
import Chrome from "@/components/meridian/Chrome";
import HeaderSkeleton from "@/components/meridian/HeaderSkeleton";
import { APP_GROUPS, appTabs } from "@/lib/appNav";

/** The shell's top chrome: brand mark, title with the date beneath, the viewer's avatar
 *  menu, and the travelling nav pill.
 *
 *  **This is the only async part of the shell, and it is deliberately isolated here.**
 *  It reads the session — which tabs a role may reach, whose name sits in the corner —
 *  and a layout that awaits runtime data blocks every navigation on itself, silently
 *  disabling loading.tsx (see tests/shellLayout.test.ts for the citation). Keeping the
 *  await in a component that AppShell wraps in its own <Suspense> is what makes route
 *  transitions instant: the shell paints immediately with HeaderSkeleton and this swaps
 *  in behind it.
 *
 *  No redirect() here. proxy.ts owns the gate for every path in the shell group — it
 *  refuses an unauthenticated request (clearing the dead cookie on the way out) and
 *  refuses a driver on any non-driver path. A redirect from inside a Suspense boundary
 *  would also fire after streaming has begun, when the status code can no longer be set.
 */
export default async function AppHeader() {
  const jar = await cookies();
  const session = getSessionFromCookies(jar.get(COOKIE_NAME)?.value);

  /* Unreachable in practice — proxy.ts has already sent a session-less request to
     /login. Render the skeleton rather than throwing inside a Suspense boundary: the
     request is on its way out regardless, and a crash here would replace a redirect
     with an error page. */
  if (!session) return <HeaderSkeleton />;

  const tabs = appTabs(session);

  return (
    <Chrome>
      <div className="top">
        <div className="brandwrap">
          <div className="mark" aria-hidden="true">
            <svg viewBox="0 0 44 24" width="26" height="14" fill="none" stroke="currentColor" strokeWidth="3.6" strokeLinecap="round">
              <path d="M22 12c-3.2-4.6-6-6.2-9.4-6.2C8.4 5.8 5 8.6 5 12s3.4 6.2 7.6 6.2c3.4 0 6.2-1.6 9.4-6.2Zm0 0c3.2-4.6 6-6.2 9.4-6.2C35.6 5.8 39 8.6 39 12s-3.4 6.2-7.6 6.2c-3.4 0-6.2-1.6-9.4-6.2Z" />
            </svg>
          </div>
          <div>
            <h1>RouteFlow</h1>
            <div className="sub">{faJalaliLong(new Date().toISOString())}</div>
          </div>
        </div>
        <div className="topright">
          <NotificationBell placement="header" />
          <ProfileMenu
            userId={session.user.id}
            name={session.user.display_name}
            roleLabel={ROLE_LABEL[session.role]}
          />
        </div>
      </div>

      <TabPill tabs={tabs} groups={APP_GROUPS} />
    </Chrome>
  );
}
