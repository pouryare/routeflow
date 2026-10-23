import type { ReactNode } from "react";
import { MyPositionProvider } from "@/components/MyPositionProvider";


/** The bare group: /driver, /login, /offline, /start.
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
 *  on the layout. tests/shellGroups.test.ts guards it. A client component satisfies that
 *  without qualification: it awaits nothing and makes no server call.
 *
 *  MyPositionProvider is here for the same reason it is in the shell, and more strongly:
 *  (bare) is where the vehicle screens live, which is exactly where one shared
 *  geolocation watch matters. It was mounted only in the shell, so /driver -- a page in
 *  THIS group -- had no position at all. useMyPosition() returned the context default, so
 *  nothing threw: VerifyVisits recorded every visit with pos = null and a next-stop
 *  banner showed no distance. A map with no blue dot, and every signal saying all was
 *  well. tests/bare-layout-has-position.test.ts holds the mount in place. */
export default function BareLayout({ children }: { children: ReactNode }) {
  return (
    <div className="meridian">
      <MyPositionProvider>{children}</MyPositionProvider>
    </div>
  );
}
