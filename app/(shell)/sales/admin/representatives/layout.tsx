import { Suspense, type ReactNode } from "react";
import PageHeader from "@/components/meridian/PageHeader";
import PageHeaderCard from "@/components/meridian/PageHeaderCard";
import { pageMetaFor } from "@/lib/pageMeta";

/** The page-overview card lives here rather than in page.tsx because the page is a client
 *  component and PageHeader is an async server one — a client file cannot import it, which
 *  is exactly how this route lost its sibling tabs.
 *
 *  The <Suspense> is load-bearing, not decoration. PageHeader awaits cookies(), and per
 *  Next's layout.js docs loading.tsx sits BELOW layout.tsx and cannot cover a layout's own
 *  await. Without this boundary the layout would block every navigation into the route and
 *  loading.tsx would silently never render — a slow app with no error, which is the very
 *  failure the app-shell slice existed to remove. tests/shell-pages-have-tabs.test.ts
 *  holds both halves of that rule.
 *
 *  The fallback is the real card minus the tabs: title and overview are static, so the
 *  correct page name paints immediately and only the tab row streams in. That is precisely
 *  what these pages showed permanently before this file existed.
 */
const ROUTE = "/sales/admin/representatives";

export default function AdminRepresentativesLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Suspense fallback={<PageHeaderCard {...pageMetaFor(ROUTE)} />}>
        <PageHeader route={ROUTE} />
      </Suspense>
      {children}
    </>
  );
}
