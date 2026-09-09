import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** /sales/analysis merged into /sales/dashboard (the «تحلیل فروش» tab) -- the two read
 *  the same figures against the same period and were always compared side by side. Kept
 *  as a redirect so old links, bookmarks and the odd prefetch still land somewhere. */
export default function AnalysisPage() {
  redirect("/sales/dashboard");
}
