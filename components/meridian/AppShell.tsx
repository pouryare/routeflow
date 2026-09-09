import { Suspense, type ReactNode } from "react";
import AppHeader from "@/components/meridian/AppHeader";
import HeaderSkeleton from "@/components/meridian/HeaderSkeleton";
import RevealRoute from "@/components/meridian/RevealRoute";
import RouteFade from "@/components/meridian/RouteFade";
import SyncStatus from "@/components/SyncStatus";

/** Everything every themed route wears: the header, the entrance choreography, and the
 *  sync indicator.
 *
 *  The Suspense boundary is the point of this component. AppHeader is async — it reads
 *  the session to know whose name to show and which tabs the role can reach — and a
 *  layout that awaits runtime data blocks every navigation on itself, which also makes
 *  loading.tsx dead code. Suspending the header here means the shell paints instantly
 *  with HeaderSkeleton, the header fills in behind it, and each route's own loading.tsx
 *  runs underneath. See tests/shellLayout.test.ts for the citation from Next's docs.
 *
 *  RevealRoute and RouteFade are unchanged: RouteFade fades the whole view in on
 *  navigation (a key={pathname} remount plus a CSS keyframe) and RevealRoute layers the
 *  per-card stagger on top. Both are pure CSS and deliberately stay that way.
 */
export default function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app">
      <Suspense fallback={<HeaderSkeleton />}>
        <AppHeader />
      </Suspense>

      <RevealRoute />
      <RouteFade>{children}</RouteFade>

      <SyncStatus />
    </div>
  );
}
