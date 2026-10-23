"use client";

import RouteTabs from "@/components/RouteTabs";

/** The in-page view strip, under the header's own tab row.
 *
 *  Two rows, answering two different questions, and both are deliberate (spec §6). The
 *  header row is the nav group's siblings — a way to LEAVE this area. This row is the
 *  page's own views — a way to read THIS data differently. Merging them would leave a
 *  reader with no way out of the area and no way to change lens inside it.
 *
 *  HeroUI Tabs (RouteTabs): the selected view is announced as the selected tab, which is
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
  const on = tabs.find((t) => t.value === current);
  return (
    <RouteTabs
      className="jmode"
      label="نمای این صفحه"
      tabs={tabs.map((t) => ({ href: href(t), label: t.label }))}
      current={on ? href(on) : undefined}
    />
  );
}
