import type { Metadata } from "next";
import { Vazirmatn, JetBrains_Mono } from "next/font/google";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";
import { ToastProvider } from "@/components/ToastProvider";
import { MyPositionProvider } from "@/components/MyPositionProvider";
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

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="fa"
      dir="rtl"
      className={`${vazirmatn.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans">
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
