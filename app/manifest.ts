import type { MetadataRoute } from "next";
import { APP_SHORTCUTS } from "@/lib/mobileNav";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "RouteFlow — پخش و فروش",
    short_name: "RouteFlow",
    description: "سامانه فروش، پخش و مدیریت مسیر",
    start_url: "/",
    display: "standalone",
    background_color: "#0A0E14",
    theme_color: "#0A0E14",
    dir: "rtl",
    lang: "fa",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
    ],
    // Icon shortcuts (Z14): long-press the installed app icon. One list for everyone, because the
    // browser reads the manifest without the sign-in cookie; each page's own gate decides who stays.
    shortcuts: APP_SHORTCUTS.map((s) => ({ name: s.label, short_name: s.label, url: s.href, icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }] })),
  };
}
