import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "RouteFlow — پخش و فروش",
    short_name: "RouteFlow",
    description: "سامانه فروش، پخش و مدیریت مسیر",
    start_url: "/",
    display: "standalone",
    background_color: "#ECEDEF",
    theme_color: "#ECEDEF",
    dir: "rtl",
    lang: "fa",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
    ],
  };
}
