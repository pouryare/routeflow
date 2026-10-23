import type { Metadata, Viewport } from "next";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";
import { ToastProvider } from "@/components/ToastProvider";
import HeroUIProvider from "@/components/HeroUIProvider";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import { ACCENT_INIT_SCRIPT } from "@/lib/accent";
import { FONT_INIT_SCRIPT } from "@/lib/font";
import { ALL_FONT_VARS } from "@/app/fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "نقشه پوشش مشتریان",
  description: "نقشه پوشش مناطق و مشتریان",
};

/** `colorScheme: "dark light"` -- dark first, because it is the default and the order is
 *  the preference order. It tells the browser to render its own form controls, scrollbars
 *  and autofill against the right ground; without it a light-mode session gets dark
 *  scrollbars and a dark-mode one gets white autofill boxes.
 *
 *  themeColor is the dark value only. Its media-query form follows the OS, which after
 *  first run is exactly what this app deliberately stops doing -- so the live value is
 *  rewritten by applyTheme instead, keeping the phone's status bar in step with the
 *  choice rather than with the operating system.
 */
export const viewport: Viewport = {
  colorScheme: "dark light",
  themeColor: "#0a0e14",
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
        <HeroUIProvider>
          <ToastProvider>
            {children}
          </ToastProvider>
        </HeroUIProvider>
      </body>
    </html>
  );
}
