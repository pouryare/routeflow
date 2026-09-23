import { Suspense, type ReactNode } from "react";
import PageHeader from "@/components/meridian/PageHeader";
import PageHeaderCard from "@/components/meridian/PageHeaderCard";
import { pageMetaFor } from "@/lib/pageMeta";
import type { Metadata } from "next";

const ROUTE = "/analytics";

export const metadata: Metadata = {
  title: pageMetaFor(ROUTE).title,
  description: pageMetaFor(ROUTE).overview,
};

export default function AnalyticsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Suspense fallback={<PageHeaderCard {...pageMetaFor(ROUTE)} />}>
        <PageHeader route={ROUTE} />
      </Suspense>
      {children}
    </>
  );
}
