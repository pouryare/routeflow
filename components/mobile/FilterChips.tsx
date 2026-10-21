"use client";

import { useState } from "react";
import { Icon } from "@/components/meridian/Icon";
import FilterSheet from "@/components/mobile/FilterSheet";
import { faNum } from "@/lib/format";

/** One filter: a set of options a person toggles. `single` holds one id (the neutral one, "" by
 *  default, means "no filter"); `multi` holds a list (empty means "no filter"). A group with
 *  `sheet: true` lives behind the «فیلترها» chip instead of in the row. */
export interface FilterGroup {
  id: string;
  label: string;
  mode: "single" | "multi";
  options: { id: string; label: string }[];
  value: string | string[];
  onChange: (v: string | string[]) => void;
  /** The id that means "no filter" for a single group. Defaults to "". */
  neutral?: string;
  sheet?: boolean;
}

export const neutralOf = (g: FilterGroup): string | string[] => (g.mode === "multi" ? [] : (g.neutral ?? ""));
export const isActive = (g: FilterGroup): boolean =>
  g.mode === "multi" ? (g.value as string[]).length > 0 : g.value !== (g.neutral ?? "");

const on = (g: FilterGroup, id: string) => (g.mode === "multi" ? (g.value as string[]).includes(id) : g.value === id);

function toggle(g: FilterGroup, id: string) {
  if (g.mode === "multi") {
    const cur = g.value as string[];
    g.onChange(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  } else {
    // Tapping the chosen option again goes back to "no filter".
    g.onChange(g.value === id ? (g.neutral ?? "") : id);
  }
}

/** The chips of one group. Single groups with a neutral option ("همه") show it as a chip too. */
export function ChipGroup({ group, wrap = false }: { group: FilterGroup; wrap?: boolean }) {
  return (
    <div className={`filterchips__group${wrap ? " filterchips__group--wrap" : ""}`} role="group" aria-label={group.label}>
      {group.options.map((o) => (
        <button
          key={o.id}
          type="button"
          className={`filterchip${on(group, o.id) ? " filterchip--on" : ""}`}
          aria-pressed={on(group, o.id)}
          onClick={() => toggle(group, o.id)}
        >
          <Icon name={on(group, o.id) ? "check" : "filter"} size="sm" />
          {o.label}
        </button>
      ))}
    </div>
  );
}

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
          <ChipGroup key={g.id} group={g} />
        ))}
        {tucked.length > 0 && (
          <button type="button" className={`filterchip${count ? " filterchip--on" : ""}`} aria-haspopup="dialog" onClick={() => setOpen(true)}>
            <Icon name="filter" size="sm" />
            فیلترها
            {count > 0 && <b className="filterchip__badge">{faNum(count)}</b>}
          </button>
        )}
      </div>
      {tucked.length > 0 && <FilterSheet open={open} onClose={() => setOpen(false)} groups={tucked} />}
    </div>
  );
}
