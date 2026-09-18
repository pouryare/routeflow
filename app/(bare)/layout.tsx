import type { ReactNode } from "react";


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
    </div>
  );
}
