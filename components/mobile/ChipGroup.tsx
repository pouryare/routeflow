"use client";

import { useState } from "react";
import { Button, ListBox, ToggleButton, type Selection } from "@heroui/react";
import { Icon } from "@/components/meridian/Icon";
import BottomSheet from "@/components/mobile/BottomSheet";
import { AnswerSearch, GoButton } from "@/components/tapflow/Answer";
import { faNum } from "@/lib/format";

/* The chip primitives shared by FilterChips (the row) and FilterSheet (the tucked-away groups).
 * They used to live in FilterChips.tsx, which imports FilterSheet, which imports them back: an
 * import cycle. FilterChips.tsx re-exports everything here, so no importer changes. */

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
        <ToggleButton
          key={o.id}
          className={`filterchip${on(group, o.id) ? " filterchip--on" : ""}`}
          isSelected={on(group, o.id)}
          onChange={() => toggle(group, o.id)}
        >
          <Icon name={on(group, o.id) ? "check" : "filter"} size="sm" />
          {o.label}
        </ToggleButton>
      ))}
    </div>
  );
}

/** A group with more options than fit a row of chips (customers' salespeople, product groups)
 *  becomes one chip that opens a sheet: a search box, then the options as a HeroUI ListBox,
 *  ticked as they are tapped. Always with search, never a long scrolling row. */
export const SEARCHABLE_FROM = 9;

export function SearchableGroup({ group }: { group: FilterGroup }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const multi = group.mode === "multi";
  const chosen = multi ? (group.value as string[]) : isActive(group) ? [group.value as string] : [];
  const shown = group.options.filter((o) => o.label.includes(q.trim()));
  const onSelect = (keys: Selection) => {
    const next = keys === "all" ? group.options.map((o) => o.id) : [...keys].map(String);
    if (multi) group.onChange(next);
    else group.onChange(next.find((k) => k !== group.value) ?? neutralOf(group));
  };
  return (
    <>
      <Button variant="secondary" className={`filterchip${chosen.length ? " filterchip--on" : ""}`} aria-haspopup="dialog" onPress={() => { setQ(""); setOpen(true); }}>
        <Icon name="filter" size="sm" />
        {group.label}
        {chosen.length > 0 && <b className="filterchip__badge">{faNum(chosen.length)}</b>}
      </Button>
      <BottomSheet open={open} title={group.label} onClose={() => setOpen(false)} closeLabel={`بستن فهرست ${group.label}`}>
        <div className="smartpicker">
          <AnswerSearch value={q} onChange={setQ} label={`جستجوی ${group.label}`} />
          <ListBox
            aria-label={group.label}
            className="tf-list"
            selectionMode={multi ? "multiple" : "single"}
            selectedKeys={chosen}
            onSelectionChange={onSelect}
            renderEmptyState={() => <p className="tf-note">چیزی پیدا نشد</p>}
          >
            {shown.map((o) => (
              <ListBox.Item key={o.id} id={o.id} textValue={o.label} className="tf-list__row">
                {o.label}
                <ListBox.ItemIndicator />
              </ListBox.Item>
            ))}
          </ListBox>
          <GoButton icon="check" onPress={() => setOpen(false)}>تأیید</GoButton>
        </div>
      </BottomSheet>
    </>
  );
}
