"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { I18nProvider, RouterProvider } from "@heroui/react";
import { UNSAFE_PortalProvider } from "react-aria";

/** The Persian calendar and Persian digits, for every HeroUI part: the Calendar shows
 *  Shamsi months, and NumberField, Calendar and ProgressBar format with ۰–۹. Storage stays
 *  ISO -- lib/jalali.ts is the only bridge (docs/decisions.md §10). */
export const HEROUI_LOCALE = "fa-IR-u-ca-persian";

/** Where HeroUI's overlays (Drawer, Popover, Toast) are drawn: the `.meridian` root. The tokens
 *  and the sheet styles are scoped there, and a fixed overlay drawn inside a card would be
 *  placed against the card's scroll-reveal `transform`, not the screen -- 6 800 px down a long
 *  orders list. null on the server, where React Aria renders no overlay anyway. */
const overlayHost = (): HTMLElement | null =>
  typeof document === "undefined" ? null : (document.querySelector<HTMLElement>(".meridian") ?? document.body);

/** What every HeroUI part needs from above it: the locale and calendar, client-side
 *  navigation for `href` on Tabs, Links and menu items, and the overlay host. */
export default function HeroUIProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  return (
    <I18nProvider locale={HEROUI_LOCALE}>
      <RouterProvider navigate={(href) => router.push(String(href))}>
        <UNSAFE_PortalProvider getContainer={overlayHost}>{children}</UNSAFE_PortalProvider>
      </RouterProvider>
    </I18nProvider>
  );
}
