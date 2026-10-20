import Link from "next/link";
import { faNum } from "@/lib/format";
import { pageHref, type Paging } from "@/lib/paging";

const BTN =
  "rounded-[var(--radius-sm)] border border-border px-2 py-1 text-[length:var(--text-sm)] no-underline";

/** Previous / next links for a `?page=N` list. Server component, so each link is a plain
 *  navigation that keeps the page's other filters. Renders nothing for a single page. */
export default function Pager({
  base,
  params,
  paging,
}: {
  base: string;
  params: Record<string, string | undefined>;
  paging: Paging;
}) {
  if (paging.pageCount <= 1) return null;
  return (
    <nav aria-label="صفحه‌بندی" className="mt-[var(--space-3)] flex items-center justify-between gap-2">
      {paging.page > 1 ? (
        <Link href={pageHref(base, params, paging.page - 1)} className={BTN} rel="prev">
          صفحهٔ قبل
        </Link>
      ) : (
        <span />
      )}
      <span className="tnum text-[length:var(--text-sm)] text-text-muted">
        صفحهٔ {faNum(paging.page)} از {faNum(paging.pageCount)}
      </span>
      {paging.page < paging.pageCount ? (
        <Link href={pageHref(base, params, paging.page + 1)} className={BTN} rel="next">
          صفحهٔ بعد
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
