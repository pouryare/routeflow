"use client";

// Where should this thing be?
//
// Two genuinely different intents sit behind one question: "one of the places I already
// own" and "this spot is not one of mine, it is just here". One button with both paths
// inside, because two buttons would widen a toolbar that already carries a sort dropdown
// and «انتخاب همه», and a search-first box would be ceremony at the three facilities a
// typical business actually has. Search can be added INSIDE the panel later, when thirty
// facilities make the list long -- that degrades gracefully; two buttons from day one do
// not.
//
// The list is the primary path because picking a place you already have is the common case
// and needs no typing. The map is the fallback, under a divider.
//
// A place with no location is LISTED but not selectable, and says why. It exists -- the
// user made it -- but it cannot be given as a point, so offering it would be offering
// something that cannot be delivered. The alternative, hiding it, would make a warehouse
// they just created appear to have vanished.

import { Icon } from "@/components/meridian/Icon";
import { useState } from "react";
import { FACILITY_LABEL, isPlaced, type FacilityRow } from "@/lib/facilityTypes";
import { facilityMarkerHtml } from "@/components/facilityArt";

export interface PlacePickerProps {
  facilities: FacilityRow[];
  /** Called with a place that has a location. */
  onPick: (facility: FacilityRow) => void;
  /** Called when the user drops a pin on a spot that is not one of theirs. */
  onMapPick: (lat: number, lng: number) => void;
  /** Clears whatever position was already set. Optional: omit to hide the affordance. */
  onClear?: () => void;
  /** What is being positioned -- used as the trigger button's label. */
  label?: string;
  /** Called when the trigger is opened. The list is usually fetched here rather than on
   *  mount, because one control in a toolbar does not justify a request every session. */
  onOpen?: () => void;
  /** The map editor. Injected rather than imported: it touches Leaflet, which cannot be
   *  server-rendered, and server components import this file. */
  MapEditor?: React.ComponentType<{
    initial?: { lat: number; lng: number } | null;
    onConfirm: (lat: number, lng: number) => void;
    onCancel: () => void;
  }>;
}

export default function PlacePicker({
  facilities,
  onPick,
  onMapPick,
  onClear,
  onOpen,
  label = "تعیین موقعیت",
  MapEditor,
}: PlacePickerProps) {
  const [open, setOpen] = useState(false);
  const [onMap, setOnMap] = useState(false);

  // Both lists, because a user who just created a warehouse needs to see that it exists
  // even on the day they cannot use it yet.
  const placed = facilities.filter(isPlaced);
  const unplaced = facilities.filter((f) => !isPlaced(f));

  function close() {
    setOpen(false);
    setOnMap(false);
  }

  if (onMap && MapEditor) {
    return (
      <MapEditor
        initial={null}
        onConfirm={(lat, lng) => {
          onMapPick(lat, lng);
          close();
        }}
        onCancel={() => setOnMap(false)}
      />
    );
  }

  if (!open) return <Trigger open={setOpen} label={label} onClear={onClear} onOpen={onOpen} />;

  return (
    <div className="min-w-64 rounded-[var(--radius-md)] border border-border bg-surface p-2 shadow-[var(--shadow-md)]">
      <p className="mb-1.5 px-1 text-[length:var(--text-xs)] text-text-faint">مکان‌های من</p>

      {placed.length === 0 && unplaced.length === 0 && (
        <p className="px-1 py-2 text-[length:var(--text-xs)] text-text-muted">
          هنوز مکانی ثبت نشده است.
        </p>
      )}

      <ul className="flex flex-col">
        {placed.map((f) => (
          <li key={f.id}>
            <button
              type="button"
              onClick={() => {
                onPick(f);
                close();
              }}
              className="flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-1.5 py-1.5 text-right transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:bg-white/5"
            >
              {/* The icon is here — <Art/> draws the facility's own chosen marker, which is
                  exactly the icon that matters: it is the same shape the map will draw. */}
              <Art f={f} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[length:var(--text-sm)] text-text">{f.name}</span>
                {f.address && (
                  <span className="block truncate text-[length:var(--text-xs)] text-text-faint">
                    {f.address}
                  </span>
                )}
              </span>
              <span className="shrink-0 text-[length:var(--text-xs)] text-text-faint">
                {FACILITY_LABEL[f.kind]}
              </span>
            </button>
          </li>
        ))}

        {unplaced.map((f) => (
          <li key={f.id}>
            {/* Listed, not offered. There is no point to give, so the row names the state
                rather than failing silently on click. */}
            <div
              aria-disabled="true"
              className="flex cursor-not-allowed items-center gap-2 rounded-[var(--radius-sm)] px-1.5 py-1.5 opacity-55"
            >
              <Art f={f} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[length:var(--text-sm)] text-text">{f.name}</span>
                <span className="block truncate text-[length:var(--text-xs)] text-text-faint">
                  هنوز مکان مشخص نیست
                </span>
              </span>
            </div>
          </li>
        ))}
      </ul>

      {/* The divider is the point: it says the two paths differ in kind, rather than
          reading as two more options in one list. */}
      <div className="my-1.5 border-t border-border" />

      <button
        type="button"
        onClick={() => setOnMap(true)}
        disabled={!MapEditor}
        className="flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-1.5 py-1.5 text-right text-[length:var(--text-xs)] text-accent transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:bg-white/5 disabled:cursor-not-allowed disabled:text-text-faint"
      >
        <Icon name="map-pin" size="sm" /> اینجا نیست؟ روی نقشه مشخص کن
      </button>

      <button
        type="button"
        onClick={close}
        className="mt-0.5 w-full rounded-[var(--radius-sm)] px-1.5 py-1 text-[length:var(--text-xs)] text-text-faint transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:text-text"
      >
        <Icon name="x" size="sm" />
        انصراف
      </button>
    </div>
  );
}

function Art({ f }: { f: FacilityRow }) {
  return (
    <span
      aria-hidden="true"
      className="shrink-0"
      dangerouslySetInnerHTML={{ __html: facilityMarkerHtml(f.icon_key, f.kind) }}
    />
  );
}

function Trigger({
  open,
  label,
  onClear,
  onOpen,
}: {
  open: (v: boolean) => void;
  label: string;
  onClear?: () => void;
  onOpen?: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={() => {
          open(true);
          onOpen?.();
        }}
        className="flex items-center gap-1 rounded-[var(--radius-sm)] border border-border px-2 py-1 text-[length:var(--text-xs)] text-text-muted transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:border-accent hover:text-accent"
      >
        <PinIcon />
        <Icon name="map-pin" size="sm" />
        {label}
      </button>
      {onClear && (
        <button
          type="button"
          onClick={onClear}
          aria-label="پاک کردن موقعیت"
          className="rounded-[var(--radius-sm)] px-1.5 py-1 text-text-faint transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:text-text"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path
              d="M3 3l6 6M9 3l-6 6"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
        </button>
      )}
    </span>
  );
}

function PinIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="shrink-0">
      <path
        d="M6 1a4 4 0 0 0-4 4c0 3 4 6 4 6s4-3 4-6a4 4 0 0 0-4-4z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <circle cx="6" cy="5" r="1.3" fill="currentColor" />
    </svg>
  );
}
