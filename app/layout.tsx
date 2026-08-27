import type { Metadata, Viewport } from "next";
import { Vazirmatn, JetBrains_Mono } from "next/font/google";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";
import { ToastProvider } from "@/components/ToastProvider";
import { MyPositionProvider } from "@/components/MyPositionProvider";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import "./globals.css";

const vazirmatn = Vazirmatn({
  variable: "--font-vazirmatn",
  subsets: ["arabic"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400"],
});

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
    // suppressHydrationWarning because the inline script below sets data-theme on this
    // element before React ever sees it. The mismatch is the entire point of the script.
    <html
      lang="fa"
      dir="rtl"
      suppressHydrationWarning
      className={`${vazirmatn.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans">
        {/* Blocking and inline, ahead of everything. next/script's beforeInteractive is
            explicitly documented as not blocking hydration, which is a weaker guarantee
            than this needs: the attribute has to exist before the first paint, not before
            hydration, or a light-mode load starts with a black flash. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <ServiceWorkerRegister />
        {/* One geolocation watch for the whole app, mounted at the root so every page --
            map, planner, leads -- reads the same live position instead of each opening
            its own watch on the same GPS chip. */}
        <ToastProvider>
          <MyPositionProvider>{children}</MyPositionProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
