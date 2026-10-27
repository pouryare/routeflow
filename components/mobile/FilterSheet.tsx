"use client";

import { GoButton, SkipButton } from "@/components/tapflow/Answer";
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
        <GoButton icon="check" onPress={onClose}>نمایش نتایج</GoButton>
        <SkipButton icon="x" isDisabled={!any} onPress={() => groups.forEach((g) => g.onChange(neutralOf(g)))}>پاک کردن فیلترها</SkipButton>
      </div>
    </BottomSheet>
  );
}
