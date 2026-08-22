import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "نقشه پوشش مشتریان",
    short_name: "Coverage Map",
    description: "نقشه پوشش مناطق و مشتریان",
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
  };
}
