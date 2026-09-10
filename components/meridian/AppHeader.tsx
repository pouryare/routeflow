import ImpersonationBanner from "@/components/meridian/ImpersonationBanner";
import { cookies } from "next/headers";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import { ROLE_LABEL } from "@/lib/roles";
import ProfileMenu from "@/components/meridian/ProfileMenu";
import NotificationBell from "@/components/NotificationBell";
import SearchSlot from "@/components/meridian/SearchSlot";
import HoverPill from "@/components/meridian/HoverPill";
import Chrome from "@/components/meridian/Chrome";
import HeaderSkeleton from "@/components/meridian/HeaderSkeleton";
import { APP_GROUPS, appTabs } from "@/lib/appNav";

/** The shell's top chrome, on one row: the travelling nav pill, then search, the bell and
 *  the viewer's avatar menu. No brand block — see tests/app-header.test.ts.
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
      {/* Login-As: an owner seeing the app as this user. Not dismissible, see the banner. */}
      {session.actorId ? <ImpersonationBanner asName={session.user.display_name} /> : null}
      <div className="top">
        <HoverPill tabs={tabs} groups={APP_GROUPS} />
        <div className="topright">
          <SearchSlot tabs={tabs} />
          <NotificationBell placement="header" />
          <ProfileMenu
            userId={session.user.id}
            name={session.user.display_name}
            roleLabel={ROLE_LABEL[session.role]}
          />
        </div>
      </div>
    </Chrome>
  );
}
