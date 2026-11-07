import type { Metadata } from "next";
import type { ReactNode } from "react";

/** Only the tab title lives here: the page is a client component and cannot export metadata itself. */
export const metadata: Metadata = { title: "رمز عبور تازه" };

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
