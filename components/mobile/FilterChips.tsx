"use client";

import { useState } from "react";
import { Button } from "@heroui/react";
import { Icon } from "@/components/meridian/Icon";
import FilterSheet from "@/components/mobile/FilterSheet";
import { ChipGroup, isActive, SearchableGroup, SEARCHABLE_FROM, type FilterGroup } from "@/components/mobile/ChipGroup";

// Re-exported so existing importers keep one import site (see ChipGroup.tsx).
export { ChipGroup, isActive, neutralOf } from "@/components/mobile/ChipGroup";
export type { FilterGroup } from "@/components/mobile/ChipGroup";
import { faNum } from "@/lib/format";

/** A single scrolling row of filter chips (44 px), with the rarer groups behind «فیلترها» and a
 *  badge counting how many are active. No dropdowns. */
export default function FilterChips({ groups }: { groups: FilterGroup[] }) {
  const [open, setOpen] = useState(false);
  const row = groups.filter((g) => !g.sheet);
  const tucked = groups.filter((g) => g.sheet);
  const count = tucked.filter(isActive).length;
  return (
    <div className="filterchips">
      <div className="filterchips__row">
        {row.map((g) => (
          g.options.length >= SEARCHABLE_FROM ? <SearchableGroup key={g.id} group={g} /> : <ChipGroup key={g.id} group={g} />
        ))}
        {tucked.length > 0 && (
          <Button variant="secondary" className={`filterchip${count ? " filterchip--on" : ""}`} aria-haspopup="dialog" onPress={() => setOpen(true)}>
            <Icon name="filter" size="sm" />
            فیلترها
            {count > 0 && <b className="filterchip__badge">{faNum(count)}</b>}
          </Button>
        )}
      </div>
      {tucked.length > 0 && <FilterSheet open={open} onClose={() => setOpen(false)} groups={tucked} />}
    </div>
  );
}
