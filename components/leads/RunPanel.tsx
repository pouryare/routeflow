"use client";

import { useRef, useState } from "react";
import { Button } from "@heroui/react";
import { moveItem, slotAt } from "@/lib/reorder";
import { faNum } from "@/lib/format";
import { formatDistanceKm } from "@/lib/geo";
import { NavAppId, navApp, routeIsSingleLeg, droppedWaypoints } from "@/lib/navApps";
import LeadRunPlanner from "@/components/leads/LeadRunPlanner";
import { Icon } from "@/components/meridian/Icon";

export interface RunStop {
  id: number;
  name: string;
  lat: number;
  lng: number;
  /** Straight-line distance from the previous stop (or from the user, for the first). */
  legKm: number | null;
}

/** The route you are actually going to drive.
 *
 *  This is the answer to the app proposing an order and the driver having no way to
 *  disagree with it. Stops go in in the order they are tapped and stay there; nothing
 *  re-sorts them behind your back. Optimising is a button you press, and it is the only
 *  thing that ever changes the order without you.
 */
export default function RunPanel({
  stops,
  totalKm,
  navAppId,
  routeHref,
  navigateHref,
  onMove,
  onReorder,
  onRemove,
  onClear,
  onOptimise,
  optimiseGain,
  busy,
  onTapFlow,
  onAssignRoute,
}: {
  stops: RunStop[];
  totalKm: number | null;
  navAppId: NavAppId;
  routeHref: string | null;
  navigateHref: (stop: RunStop) => string;
  onMove: (id: number, dir: -1 | 1) => void;
  /** Drag-to-reorder: the new order of stop ids. The up/down buttons stay for keyboards. */
  onReorder?: (ids: number[]) => void;
  onRemove: (id: number) => void;
  onClear: () => void;
  onOptimise: () => void;
  /** Percent this run would shorten by if reordered, or null when it is already good. */
  optimiseGain: number | null;
  busy: boolean;
  onTapFlow?: (stopId: number) => void;
  /** Opens the "سپردن مسیر" assignment flow. Omitted for a driver, who cannot assign. */
  onAssignRoute?: () => void;
}) {
  /* Dragging a stop by its handle: the row under the pointer shows a drop line, and letting go
     reorders. Pointer events with capture on the handle (touch-none keeps the page from scrolling
     under the finger); the decision is lib/reorder. */
  const listRef = useRef<HTMLOListElement>(null);
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null);
  const startDrag = (e: React.PointerEvent<HTMLButtonElement>, from: number) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ from, over: from });
  };
  const moveDrag = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!drag || !listRef.current) return;
    const mids = [...listRef.current.children].map((c) => {
      const r = c.getBoundingClientRect();
      return r.top + r.height / 2;
    });
    const over = slotAt(mids, e.clientY);
    if (over !== drag.over) setDrag({ ...drag, over });
  };
  const endDrag = () => {
    if (drag && drag.over !== drag.from && onReorder) onReorder(moveItem(stops, drag.from, drag.over).map((x) => x.id));
    setDrag(null);
  };

  const singleLeg = routeIsSingleLeg(navAppId, stops.length);
  const dropped = droppedWaypoints(navAppId, stops.length);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {routeHref && (
          <a
            href={routeHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] border border-accent bg-accent px-3 py-1.5 text-[length:var(--text-sm)] font-medium text-accent-ink transition-[filter,transform] duration-[var(--dur-base)] ease-[var(--ease-out)] hover:brightness-110 active:scale-[0.98]"
          >
            <Icon name="navigation" size="sm" />
            {singleLeg
              ? `مسیریابی به مقصد ۱ در ${navApp(navAppId).label}`
              : `شروع مسیر با ${faNum(stops.length)} مقصد`}
          </a>
        )}

        {optimiseGain !== null && (
          <Button variant="outline" size="sm" onPress={onOptimise} isDisabled={busy}>
            <Icon name="sparkle" size="sm" />
            مرتب‌سازی خودکار — {faNum(optimiseGain)}٪ کوتاه‌تر
          </Button>
        )}

        {onAssignRoute && (
          <LeadRunPlanner
            locationIds={stops.map((s) => s.id)}
            busy={busy}
            onOpen={onAssignRoute}
          />
        )}

        <Button variant="danger-soft" size="sm" onPress={onClear} isDisabled={busy}>
          <Icon name="trash" size="sm" />
          خالی کردن
        </Button>

        {totalKm !== null && (
          <span className="ms-auto font-mono text-[length:var(--text-xs)] text-text-faint">
            {formatDistanceKm(totalKm)} کل — خط مستقیم
          </span>
        )}
      </div>

      {/* Said plainly rather than discovered at the second stop: only Google's URL API
          can carry a whole run, so with any other app "start route" means the first leg
          and you come back here for the next one. */}
      {singleLeg && (
        <p className="text-[length:var(--text-xs)] leading-5 text-warn">
          {navApp(navAppId).label} فقط یک مقصد را می‌پذیرد؛ مسیر مقصد‌به‌مقصد باز می‌شود. برای باز کردن کل
          مسیر در یک لینک، از گوگل‌مپ، نشان، بلد یا ویز استفاده کنید.
        </p>
      )}
      {dropped > 0 && (
        <p className="text-[length:var(--text-xs)] leading-5 text-warn">
          گوگل‌مپ حداکثر ۱۰ ایستگاه میانی می‌پذیرد؛ {faNum(dropped)} مقصد آخر در این لینک نمی‌آید.
        </p>
      )}

      <ol className="flex flex-col gap-1.5" ref={listRef}>
        {stops.map((s, i) => (
          <li key={s.id} className={`flex flex-col gap-1${drag && drag.over === i && drag.from !== i ? " reorder-over" : ""}${drag?.from === i ? " reorder-lifted" : ""}`}>
            {s.legKm !== null && (
              <div className="flex items-center gap-2 pe-6 font-mono text-[length:var(--text-xs)] text-text-faint">
                <span aria-hidden="true"><Icon name="arrow-down" size="sm" /></span>
                <span>{formatDistanceKm(s.legKm)}</span>
                <span className="h-px flex-1 bg-border" aria-hidden="true" />
              </div>
            )}
            <div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-border bg-surface px-2 py-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/15 font-mono text-[length:var(--text-xs)] text-accent">
                {faNum(i + 1)}
              </span>
              <span className="min-w-0 flex-1 truncate text-[length:var(--text-sm)] text-text">{s.name}</span>

              {onReorder && (
                <button
                  type="button"
                  aria-label={`جابه‌جایی ${s.name}`}
                  className="touch shrink-0 cursor-grab touch-none text-text-faint"
                  onPointerDown={(e) => startDrag(e, i)}
                  onPointerMove={moveDrag}
                  onPointerUp={endDrag}
                  onPointerCancel={() => setDrag(null)}
                >
                  <Icon name="layers" size="md" />
                </button>
              )}
              <div className="flex shrink-0 flex-col gap-0.5">
                <Button isIconOnly variant="ghost" size="sm" onPress={() => onMove(s.id, -1)} isDisabled={i === 0 || busy} aria-label="بالا">
                  <Icon name="arrow-up" size="sm" />
                </Button>
                <Button isIconOnly variant="ghost" size="sm" onPress={() => onMove(s.id, 1)} isDisabled={i === stops.length - 1 || busy} aria-label="پایین">
                  <Icon name="arrow-down" size="sm" />
                </Button>
              </div>

              <a
                href={navigateHref(s)}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`مسیریابی به ${s.name}`}
                className="shrink-0 rounded-[var(--radius-sm)] border border-border px-2 py-1 text-[length:var(--text-xs)] text-accent transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:border-accent"
              >
                <Icon name="navigation" size="sm" />
              </a>
              <Button isIconOnly variant="danger-soft" size="sm" onPress={() => onRemove(s.id)} isDisabled={busy} aria-label={`حذف ${s.name} از مسیر`}>
                <Icon name="minus" size="sm" />
              </Button>
              {onTapFlow && (
                <Button variant="secondary" size="sm" onPress={() => onTapFlow(s.id)}>
                  <Icon name="check" size="sm" /> ثبت بازدید
                </Button>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
