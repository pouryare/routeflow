import type { ReactNode } from "react";
import AppShell from "@/components/meridian/AppShell";
import { MyPositionProvider } from "@/components/MyPositionProvider";
import HotkeyProvider from "@/components/HotkeyProvider";
import StepUpProvider from "@/components/StepUpProvider";

/** The shell group: /sales, /map, /facilities, /gallery, /planner, /report, /leads,
 *  /settings. One header, one theme, one entrance, for all of them.
 *
 *  SYNCHRONOUS, deliberately and permanently. It reads no cookies, awaits nothing, and
 *  performs no redirect. Two reasons, and the first is the load-bearing one:
 *
 *  1. A layout that awaits runtime data blocks every navigation on itself and silently
 *     disables loading.tsx — that was the page-transition freeze. The session read lives
 *     in AppHeader behind its own Suspense boundary instead.
 *  2. proxy.ts already gates every path this group serves: an unauthenticated request is
 *     redirected to /login with the dead cookie cleared, and a driver is sent back to
 *     /driver from anywhere else.
 *
 *  tests/shellLayout.test.ts guards both properties, because breaking them produces a
 *  slow app rather than an error.
 *
 *  `meridian` is the scope the whole design system hangs off; every token lives on this
 *  class — see app/globals.css, "مریدین".
 */
export default function ShellLayout({ children }: { children: ReactNode }) {
  return (
    <div className="meridian min-h-screen">
      {/* ONE keydown listener for the whole shell, mounted here and nowhere else. A provider
          per page would put back the duplicate-listener problem the registry exists to
          remove — and this layout renders once for every route in the group. */}
      <HotkeyProvider />
      {/* Asks for an authenticator code when a sensitive action says it needs one, then repeats it. */}
      <StepUpProvider />
      <MyPositionProvider>
        <AppShell>{children}</AppShell>
      </MyPositionProvider>
    </div>
  );
}
