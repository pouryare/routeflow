"use client";

import { Pagination } from "@heroui/react";
import { faNum } from "@/lib/format";
import { pageWindow } from "@/lib/pageWindow";
import { Icon } from "@/components/meridian/Icon";

/** Page numbers under a list that the browser fetches page by page (payments, lead run
 *  history). HeroUI's Pagination parts, so the buttons are React Aria buttons with its look;
 *  the server-rendered reports keep components/accounting/Pager.tsx, which are real links.
 *  Renders nothing for a single page. In right to left, «قبلی» sits on the right and points
 *  right. Five page slots at most (lib/pageWindow.ts), so every button keeps 44 px on a phone. */
export default function ListPager({
  page,
  pageCount,
  onPage,
}: {
  page: number;
  pageCount: number;
  onPage: (page: number) => void;
}) {
  if (pageCount <= 1) return null;
  return (
    <Pagination className="listpager" aria-label="صفحه‌بندی">
      <Pagination.Summary className="tnum">
        صفحهٔ {faNum(page)} از {faNum(pageCount)}
      </Pagination.Summary>
      <Pagination.Content>
        <Pagination.Item>
          <Pagination.Previous isDisabled={page <= 1} onPress={() => onPage(page - 1)} aria-label="صفحهٔ قبل">
            {/* Our icon, pointing the way the page reads: HeroUI's chevron does not turn in right to left. */}
            <Icon name="chevron-right" size="sm" />
          </Pagination.Previous>
        </Pagination.Item>
        {pageWindow(page, pageCount).map((slot, i) =>
          slot === "gap" ? (
            <Pagination.Item key={`gap${i}`}>
              <Pagination.Ellipsis />
            </Pagination.Item>
          ) : (
            <Pagination.Item key={slot}>
              <Pagination.Link
                isActive={slot === page}
                aria-current={slot === page ? "page" : undefined}
                aria-label={`صفحهٔ ${faNum(slot)}`}
                onPress={() => onPage(slot)}
                className="tnum"
              >
                {faNum(slot)}
              </Pagination.Link>
            </Pagination.Item>
          )
        )}
        <Pagination.Item>
          <Pagination.Next isDisabled={page >= pageCount} onPress={() => onPage(page + 1)} aria-label="صفحهٔ بعد">
            <Icon name="chevron-left" size="sm" />
          </Pagination.Next>
        </Pagination.Item>
      </Pagination.Content>
    </Pagination>
  );
}
