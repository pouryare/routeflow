"use client";

import { faNum } from "@/lib/format";
import { formatDistanceKm } from "@/lib/geo";
import { NavAppId, navApp, routeIsSingleLeg, droppedWaypoints } from "@/lib/navApps";

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
  onRemove,
  onClear,
  onOptimise,
  optimiseGain,
  busy,
}: {
  stops: RunStop[];
  totalKm: number | null;
  navAppId: NavAppId;
  routeHref: string | null;
  navigateHref: (stop: RunStop) => string;
  onMove: (id: number, dir: -1 | 1) => void;
  onRemove: (id: number) => void;
  onClear: () => void;
  onOptimise: () => void;
  /** Percent this run would shorten by if reordered, or null when it is already good. */
  optimiseGain: number | null;
  busy: boolean;
}) {
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
            className="rounded-[var(--radius-sm)] border border-accent bg-accent px-3 py-1.5 text-[length:var(--text-sm)] font-medium text-[#04191c] transition-[filter,transform] duration-[var(--dur-base)] ease-[var(--ease-out)] hover:brightness-110 active:scale-[0.98]"
          >
            {singleLeg
              ? `مسیریابی به توقف ۱ در ${navApp(navAppId).label} ↗`
              : `شروع مسیر با ${faNum(stops.length)} توقف ↗`}
          </a>
        )}

        {optimiseGain !== null && (
          <button
            onClick={onOptimise}
            disabled={busy}
            className="rounded-[var(--radius-sm)] border border-accent px-2 py-1.5 text-[length:var(--text-xs)] text-accent transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:bg-accent hover:text-[#04191c] disabled:opacity-50"
          >
            مرتب‌سازی خودکار — {faNum(optimiseGain)}٪ کوتاه‌تر
          </button>
        )}

        <button
          onClick={onClear}
          disabled={busy}
          className="rounded-[var(--radius-sm)] border border-border px-2 py-1.5 text-[length:var(--text-xs)] text-text-muted transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:border-crit hover:text-crit disabled:opacity-50"
        >
          خالی کردن
        </button>

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
          {navApp(navAppId).label} فقط یک مقصد را می‌پذیرد؛ مسیر توقف‌به‌توقف باز می‌شود. برای باز کردن کل
          مسیر در یک لینک، از «گوگل مپ» استفاده کنید.
        </p>
      )}
      {dropped > 0 && (
        <p className="text-[length:var(--text-xs)] leading-5 text-warn">
          گوگل مپ حداکثر ۱۰ ایستگاه میانی می‌پذیرد؛ {faNum(dropped)} توقف آخر در این لینک نمی‌آید.
        </p>
      )}

      <ol className="flex flex-col gap-1.5">
        {stops.map((s, i) => (
          <li key={s.id} className="flex flex-col gap-1">
            {s.legKm !== null && (
              <div className="flex items-center gap-2 pe-6 font-mono text-[length:var(--text-xs)] text-text-faint">
                <span aria-hidden="true">↓</span>
                <span>{formatDistanceKm(s.legKm)}</span>
                <span className="h-px flex-1 bg-border" aria-hidden="true" />
              </div>
            )}
            <div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-border bg-surface px-2 py-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/15 font-mono text-[length:var(--text-xs)] text-accent">
                {faNum(i + 1)}
              </span>
              <span className="min-w-0 flex-1 truncate text-[length:var(--text-sm)] text-text">{s.name}</span>

              <div className="flex shrink-0 flex-col gap-0.5">
                <button
                  onClick={() => onMove(s.id, -1)}
                  disabled={i === 0 || busy}
                  aria-label="بالا"
                  className="text-text-faint hover:text-text disabled:opacity-30"
                >
                  ▲
                </button>
                <button
                  onClick={() => onMove(s.id, 1)}
                  disabled={i === stops.length - 1 || busy}
                  aria-label="پایین"
                  className="text-text-faint hover:text-text disabled:opacity-30"
                >
                  ▼
                </button>
              </div>

              <a
                href={navigateHref(s)}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`مسیریابی به ${s.name}`}
                className="shrink-0 rounded-[var(--radius-sm)] border border-border px-2 py-1 text-[length:var(--text-xs)] text-accent transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:border-accent"
              >
                ↗
              </a>
              <button
                onClick={() => onRemove(s.id)}
                disabled={busy}
                aria-label={`حذف ${s.name} از مسیر`}
                className="shrink-0 rounded-[var(--radius-sm)] px-1.5 py-1 text-crit transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:bg-white/5 disabled:opacity-50"
              >
                ✕
              </button>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
