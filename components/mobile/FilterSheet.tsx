"use client";

import { Icon } from "@/components/meridian/Icon";
import BottomSheet from "@/components/mobile/BottomSheet";
import { ChipGroup, type FilterGroup, isActive, neutralOf } from "@/components/mobile/ChipGroup";

/** The filters that do not earn a place in the row: the same chip groups, stacked, in a sheet.
 *  Changes apply as they are tapped (the list behind updates), so «نمایش نتایج» only closes. */
export default function FilterSheet({ open, onClose, groups }: { open: boolean; onClose: () => void; groups: FilterGroup[] }) {
  const any = groups.some(isActive);
  return (
    <BottomSheet open={open} title="فیلترها" onClose={onClose} closeLabel="بستن فیلترها">
      <div className="filtersheet">
        {groups.map((g) => (
          <section key={g.id} className="filtersheet__group">
            <div className="tf-group">{g.label}</div>
            <ChipGroup group={g} wrap />
          </section>
        ))}
        <button type="button" className="inline-flex items-center justify-center gap-[var(--space-2)] tf-go" onClick={onClose}>
          <Icon name="check" size="md" />
          نمایش نتایج
        </button>
        <button
          type="button"
          className="inline-flex items-center justify-center gap-[var(--space-2)] tf-skip"
          disabled={!any}
          onClick={() => groups.forEach((g) => g.onChange(neutralOf(g)))}
        >
          <Icon name="x" size="md" />
          پاک کردن فیلترها
        </button>
      </div>
    </BottomSheet>
  );
}
