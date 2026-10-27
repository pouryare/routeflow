"use client";

import CollapsibleSection from "./CollapsibleSection";
import ActiveTags from "@/components/mobile/ActiveTags";
import FilterChips from "@/components/mobile/FilterChips";
import { faNum } from "@/lib/format";

export default function CustomerFilters({
  salespeople,
  salespersonFilter,
  onSalespersonFilterChange,
  totalCount,
  filteredCount,
}: {
  salespeople: string[];
  salespersonFilter: Set<string>;
  onSalespersonFilterChange: (s: Set<string>) => void;
  totalCount: number;
  filteredCount: number;
}) {
  return (
    <CollapsibleSection
      title="فیلتر مشتری‌ها"
      icon="search"
      /* The count belongs in the chip, not spliced into the title -- and "N of M" is
         what makes a filter's state readable without opening it. */
      right={
        <span className="font-mono text-[length:var(--text-xs)] text-text-faint">
          {faNum(filteredCount)} از {faNum(totalCount)}
        </span>
      }
      storageKey="filters"
      keywords="فروشنده مسئول نمایش"
    >

      {salespeople.length > 0 && (
        <FilterChips
          groups={[
            {
              id: "salesperson",
              label: "فروشنده",
              mode: "multi",
              options: salespeople.map((x) => ({ id: x, label: x })),
              value: [...salespersonFilter],
              onChange: (v) => onSalespersonFilterChange(new Set(v as string[])),
            },
          ]}
        />
      )}
      <ActiveTags
        label="فروشنده‌های انتخاب‌شده"
        items={[...salespersonFilter].map((x) => ({ id: x, label: x }))}
        onRemove={(id) => onSalespersonFilterChange(new Set([...salespersonFilter].filter((x) => x !== id)))}
      />
    </CollapsibleSection>
  );
}
