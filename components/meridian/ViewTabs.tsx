import Link from "next/link";

/** The in-page view strip, under the header's own tab row.
 *
 *  Two rows, answering two different questions, and both are deliberate (spec §6). The
 *  header row is the nav group's siblings — a way to LEAVE this area. This row is the
 *  page's own views — a way to read THIS data differently. Merging them would leave a
 *  reader with no way out of the area and no way to change lens inside it.
 *
 *  aria-current="page" rather than a class alone: the visual difference between the
 *  selected pill and the others is not something a screen reader can announce, and this is
 *  the only thing on the row that says which view is showing. */
export interface ViewTab {
  /** The `?view=` value. "" is the default view and is written as the bare path. */
  value: string;
  label: string;
  /** The route this tab lives on, so the strip is reusable by both hosts. */
  route: string;
}

export default function ViewTabs({ tabs, current }: { tabs: ViewTab[]; current: string }) {
  const href = (t: ViewTab) => (t.value === "" ? t.route : `${t.route}?view=${t.value}`);
  return (
    <nav className="jmode" aria-label="نمای این صفحه">
      {tabs.map((t) => (
        <Link
          key={t.value || "default"}
          className={`btn ${current === t.value ? "solid" : "ghost"}`}
          aria-current={current === t.value ? "page" : undefined}
          href={href(t)}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
