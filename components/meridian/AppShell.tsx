import { Suspense, type ReactNode } from "react";
import AppHeader from "@/components/meridian/AppHeader";
import HeaderSkeleton from "@/components/meridian/HeaderSkeleton";
import PullToRefresh from "@/components/meridian/PullToRefresh";
import RevealRoute from "@/components/meridian/RevealRoute";
import RouteFade from "@/components/meridian/RouteFade";
import SquircleFallback from "@/components/meridian/SquircleFallback";
import SyncIsland from "@/components/meridian/SyncIsland";
import WidgetBoundary from "@/components/WidgetBoundary";

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
 * SyncIsland sits behind a boundary of its own for the same reason, and it is a component
 * rather than an `if` because deciding whether to mount the sync client needs the session —
 * which means cookies(), which this file must never await. It renders null for the vendor,
 * who has no offline client, so the browser never asks a question the routes would refuse.
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

      <PullToRefresh />
      <RevealRoute />
      <RouteFade>{children}</RouteFade>

      {/* Nothing at all for a role with no sync client — see SyncIsland. */}
      <WidgetBoundary label="همگام‌سازی" compact>
        <Suspense fallback={null}>
          <SyncIsland />
        </Suspense>
      </WidgetBoundary>

      {/* Renders null and costs nothing wherever the browser draws the corner itself. */}
      <SquircleFallback />
    </div>
  );
}
