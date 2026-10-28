"use client";

// The load and the unload, above the delivery stops.
//
// NEITHER CARD IS NUMBERED. That is the whole design, and it is easy to get backwards.
//
// A load is the first thing that happens. An unload has NO POSITION AT ALL — the driver
// decides when, at the end or in the middle of the day. Numbering it would make it look
// like a third doorstep, and then dragging it would renumber everything after it, and the
// list would be claiming a route that does not exist. That is the same mistake as showing a
// precise fourteen-week grid that is only half real: a number that looks authoritative and
// is not.
//
// So the two cards are visually outside the sequence, and the stop list below keeps its own
// 1..n. The divider between them is doing real work — it says "these are not stops in an
// order", not just "there is a section here".

import { navigateUrl, type NavAppId } from "@/lib/navApps";
import { facilityMarkerHtml } from "@/components/facilityArt";
import { Icon } from "@/components/meridian/Icon";
import type { RunFacilityStop } from "@/lib/delivery";

const ROLE_LABEL: Record<RunFacilityStop["role"], string> = {
  // "اولِ روز" not "توقف ۱" — a position, not a sequence number.
  load: "اولِ روز",
  // The driver's call, and the wording says so.
  unload: "هر وقت خواستی",
};

export default function FacilityStopCards({
  facilities,
  navAppId,
  onOpenUnload,
}: {
  facilities: RunFacilityStop[];
  navAppId: NavAppId;
  /** Called when the driver taps the unload card. Omit to render it as inert. */
  onOpenUnload?: (stop: RunFacilityStop) => void;
}) {
  if (facilities.length === 0) return null;

  return (
    <div className="mb-3 flex flex-col gap-2" dir="rtl">
      {facilities.map((f) => (
        <FacilityCard key={f.id} stop={f} navAppId={navAppId} onOpenUnload={onOpenUnload} />
      ))}
      {/* The divider: these two are outside the sequence the stops below are numbered in. */}
      <div className="my-1 flex items-center gap-2 text-text-faint">
        <span className="h-px flex-1 bg-border" />
        <span className="text-[length:var(--text-xs)]">توقف‌ها</span>
        <span className="h-px flex-1 bg-border" />
      </div>
    </div>
  );
}

function FacilityCard({
  stop,
  navAppId,
  onOpenUnload,
}: {
  stop: RunFacilityStop;
  navAppId: NavAppId;
  onOpenUnload?: (stop: RunFacilityStop) => void;
}) {
  const done = stop.status === "done";
  const placed = stop.lat !== null && stop.lng !== null;

  return (
    <div
      className={`rounded-[var(--radius-lg)] border p-3 ${
        done ? "border-border bg-surface/60" : "border-accent/40 bg-surface"
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="shrink-0"
          dangerouslySetInnerHTML={{ __html: facilityMarkerHtml(stop.icon_key, stop.kind as never) }}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate text-[length:var(--text-sm)] text-text">
              {stop.role === "load" ? "بارگیری" : "تخلیه"} · {stop.name}
            </span>
          </div>
          <div className="mt-0.5 text-[length:var(--text-xs)] text-text-muted">
            {/* The position of the visit in the DAY, stated in words. Never a number that
                could be confused with the stop sequence below. */}
            {ROLE_LABEL[stop.role]}
          </div>
        </div>
        {done ? (
          <span className="flex shrink-0 items-center gap-1 text-[length:var(--text-xs)] text-ok">
            <Icon name="check" size="sm" /> انجام شد
          </span>
        ) : null}
      </div>

      {placed ? (
        <a
          href={navigateUrl(navAppId, { lat: stop.lat as number, lng: stop.lng as number }, stop.name)}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 flex items-center gap-1 text-[length:var(--text-xs)] text-accent"
        >
          <Icon name="compass" size="sm" />
          <span className="truncate">{stop.address ?? stop.name}</span>
        </a>
      ) : (
        // A place can exist before anyone has put it on the map. Say so rather than showing
        // an empty line where an address should be.
        <p className="mt-2 text-[length:var(--text-xs)] text-text-faint">
          هنوز مکان مشخص نیست
        </p>
      )}

      {!done && stop.role === "unload" && (
        <button
          type="button"
          disabled={!onOpenUnload}
          onClick={() => onOpenUnload?.(stop)}
          className="mt-2 w-full rounded-[var(--radius-md)] border border-accent px-3 py-1.5 text-[length:var(--text-xs)] text-accent transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:bg-accent hover:text-accent-ink disabled:cursor-not-allowed disabled:border-border disabled:text-text-faint"
        >
          <Icon name="check" size="sm" /> ثبت تخلیه</button>
      )}
    </div>
  );
}