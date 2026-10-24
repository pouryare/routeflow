import Link from "next/link";
import { faNum } from "@/lib/format";
import { pageHref, type Paging } from "@/lib/paging";

const BTN = "pagination__link pagination__link--nav pager__link";

/** Previous / next links for a `?page=N` list. Server component, so each link is a plain
 *  navigation that keeps the page's other filters. Renders nothing for a single page.
 *
 *  HeroUI's pagination look (`pagination` classes from its sheet), on links: HeroUI's
 *  Pagination parts are React Aria buttons, and a page of a report should be a real link
 *  that opens in a new tab and works before the script loads. 44 px to tap. */
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
    <nav aria-label="صفحه‌بندی" className="pagination pager mt-[var(--space-3)]">
      {paging.page > 1 ? (
        <Link href={pageHref(base, params, paging.page - 1)} className={BTN} rel="prev">
          صفحهٔ قبل
        </Link>
      ) : (
        <span />
      )}
      <span className="pagination__summary tnum">
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
