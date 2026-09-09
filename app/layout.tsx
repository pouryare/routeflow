import type { Metadata, Viewport } from "next";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";
import { ToastProvider } from "@/components/ToastProvider";
import { MyPositionProvider } from "@/components/MyPositionProvider";
import NotificationBell from "@/components/NotificationBell";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import { ACCENT_INIT_SCRIPT } from "@/lib/accent";
import { FONT_INIT_SCRIPT } from "@/lib/font";
import { ALL_FONT_VARS } from "@/app/fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "RouteFlow — پخش و فروش",
  description: "سامانه فروش، پخش و مدیریت مسیر",
};

/** `colorScheme: "light dark"` -- light first, since the 2026-09-08 substrate redesign
 *  made light the default and the identity. It tells the browser to render its own form
 *  controls, scrollbars and autofill against the right ground; without it a light-mode
 *  session gets dark scrollbars and a dark-mode one gets white autofill boxes.
 *
 *  themeColor is the light value only, matching the new default. Its media-query form
 *  follows the OS, which for anyone whose stored preference is "auto" is exactly what
 *  this app now DOES want live -- but /driver still pins regardless (see lib/theme.ts),
 *  so the live value is rewritten by applyResolvedTheme instead, keeping the phone's
 *  status bar in step with the resolved choice rather than the OS alone.
 */
export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: "#ECEDEF",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning because the inline scripts below set data-theme and
    // data-accent on this element before React ever sees it. The mismatch is the entire
    // point of the scripts.
    <html
      lang="fa"
      dir="rtl"
      suppressHydrationWarning
      className={`${ALL_FONT_VARS} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans">
        {/* Blocking and inline, ahead of everything. next/script's beforeInteractive is
            explicitly documented as not blocking hydration, which is a weaker guarantee
            than this needs: the attribute has to exist before the first paint, not before
            hydration, or a light-mode load starts with a black flash. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        {/* Same reasoning, separate key: the accent is what you like, the theme is where
            you are. See lib/accent.ts. */}
        <script dangerouslySetInnerHTML={{ __html: ACCENT_INIT_SCRIPT }} />
        {/* And the letterforms you read best. See lib/font.ts. */}
        <script dangerouslySetInnerHTML={{ __html: FONT_INIT_SCRIPT }} />
        <ServiceWorkerRegister />
        {/* One geolocation watch for the whole app, mounted at the root so every page --
            map, planner, leads -- reads the same live position instead of each opening
            its own watch on the same GPS chip. */}
        <ToastProvider>
          <MyPositionProvider>{children}</MyPositionProvider>
          <NotificationBell />
        </ToastProvider>
      </body>
    </html>
  );
}
