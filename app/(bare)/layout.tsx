import type { ReactNode } from "react";
import NotificationBell from "@/components/NotificationBell";

/** The bare group: /driver, /login, /offline, /today.
 *
 *  These wear the design system's PALETTE — the same cold tokens, type, radii and
 *  shadows as everywhere else, so they read as the same product — and nothing else. No
 *  header, no travelling pill, no page-overview card, no entrance choreography. The
 *  contexts are a phone held in a moving vehicle and a login card on a cold start;
 *  chrome is precisely the thing they must not have. See the design spec, decision #11:
 *  "match the theme, not fully".
 *
 *  Synchronous, and it must stay that way. Nothing here reads cookies() — proxy.ts owns
 *  the gate for every one of these paths — so a navigation into this group never blocks
 *  on the layout. tests/shellGroups.test.ts guards it.
 */
export default function BareLayout({ children }: { children: ReactNode }) {
  return (
    <div className="meridian">
      {children}
      {/* The one exception to "no chrome", and it is functional rather than decorative.
          The bell used to be mounted in the root layout, so every route had it; moving it
          into the shell header would have silently taken it away from the driver, who
          receives delivery.failed and task.assigned and owns the same opt-in matrix as
          everyone else (see proxy.ts, which lets a driver reach /settings and
          /api/notifications). It keeps its original floating placement here, and renders
          nothing at all when the poll says the viewer is not authenticated — so /login
          and /offline are unaffected. */}
      <NotificationBell />
    </div>
  );
}
