"use client";

import { formatDistanceKm } from "@/lib/geo";
import { useNavApp } from "@/components/NavAppSetting";
import { navigateUrl } from "@/lib/navApps";
import { SkeletonLabel, SkeletonRows } from "@/components/Skeleton";
import EmptyState from "@/components/EmptyState";
import { Icon } from "@/components/meridian/Icon";
import { RestockHint } from "@/components/planner/RestockHint";
import { PlanRow, Origin, STATUS_META } from "@/lib/plannerView";

/** The selected day's stops: loading skeleton, empty state, or the ordered list with leg distances. */
export default function PlanDayList({ loading, dayPlans, legKm, restockHint, optimising, insertRestockStop, move, setStatus, removePlan, navAppId, returnLegKm, origin }: {
  loading: boolean;
  dayPlans: PlanRow[];
  legKm: Map<number, number>;
  restockHint: { warehouse: { name: string }; km: number; afterIndex: number } | null;
  optimising: boolean;
  insertRestockStop: () => void;
  move: (id: number, dir: 1 | -1) => void | Promise<void>;
  setStatus: (id: number, status: PlanRow["status"]) => void;
  removePlan: (id: number) => void;
  navAppId: ReturnType<typeof useNavApp>[0];
  returnLegKm: number | null;
  origin: Origin | null;
}) {
  return (
loading ? (
        <>
          <SkeletonRows rows={3} />
          <SkeletonLabel>در حال بارگذاری برنامه…</SkeletonLabel>
        </>
      ) : dayPlans.length === 0 ? (
        <EmptyState
          icon="calendar"
          title="برای این روز هنوز چیزی برنامه‌ریزی نشده"
          hint="از کادر «افزودن به برنامه» بالای همین صفحه، یک مشتری یا سرنخ پیشنهادی اضافه کنید."
        />
      ) : (
        <>
        {legKm.size > 0 && (
          <p className="mb-2 font-mono text-[length:var(--text-xs)] text-text-faint">
            فاصله‌های نشان‌داده‌شده بین توقف‌ها خط مستقیم است، نه مسیر جاده‌ای.
          </p>
        )}
        <ul className="print-day-sheet flex flex-col gap-2">
          {/* The hint sits between the two stops it concerns, not in a summary the
              user has to translate back into "between which two?". afterIndex 0
              means the leg from the origin, so it renders above the first stop. */}
          {restockHint && restockHint.afterIndex === 0 && (
            <li>
              <RestockHint hint={restockHint} busy={optimising} onAdd={insertRestockStop} />
            </li>
          )}
          {dayPlans.map((p, i) => (
            <li key={p.id} className="flex flex-col gap-2">
            {legKm.has(p.id) && (
              <div className="flex items-center gap-2 pe-6 font-mono text-[length:var(--text-xs)] text-text-faint">
                <span aria-hidden="true" className="text-text-faint"><Icon name="arrow-down" size="sm" /></span>
                <span>{formatDistanceKm(legKm.get(p.id) as number)}</span>
                <span className="h-px flex-1 bg-border" aria-hidden="true" />
              </div>
            )}
            <div
              className="print-stop flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2"
            >
              <div className="no-print flex flex-col gap-0.5">
                <button
                  onClick={() => move(p.id, -1)}
                  disabled={i === 0}
                  aria-label="انتقال توقف به بالا"
                  className="text-text-faint hover:text-text disabled:opacity-30"
                >
                  <Icon name="arrow-up" size="sm" />
                </button>
                <button
                  onClick={() => move(p.id, 1)}
                  disabled={i === dayPlans.length - 1}
                  aria-label="انتقال توقف به پایین"
                  className="text-text-faint hover:text-text disabled:opacity-30"
                >
                  <Icon name="arrow-down" size="sm" />
                </button>
              </div>
              <div className="min-w-0 flex-1 basis-32 truncate text-[length:var(--text-sm)] text-text">
                {p.entity_type === "district" ? <Icon name="map" size="sm" /> : null}
                 {p.entity_type === "lead_location" ? <Icon name="map-pin" size="sm" className="text-accent" /> : null}{" "}
                {p.label}
              </div>
              <span
                className="shrink-0 rounded-[var(--radius-sm)] px-2 py-0.5 font-mono text-[length:var(--text-xs)]"
                style={{
                  color: STATUS_META[p.status].color,
                  background: `color-mix(in srgb, ${STATUS_META[p.status].color} 16%, transparent)`,
                }}
              >
                {STATUS_META[p.status].label}
              </span>
              <div className="no-print flex w-full flex-wrap justify-end gap-1 sm:w-auto">
                {p.lat !== null && p.lng !== null && (
                  <a
                    href={navigateUrl(navAppId, { lat: p.lat, lng: p.lng }, p.label)}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`مسیریابی به ${p.label}`}
                    className="rounded-[var(--radius-sm)] px-1.5 py-1 text-accent transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:bg-white/5"
                  >
                    <Icon name="external-link" size="sm" />
                    <span className="ms-1 text-[length:var(--text-xs)]">مسیریابی</span>
                  </a>
                )}
                <button
                  onClick={() => setStatus(p.id, "done")}
                  className="rounded-[var(--radius-sm)] px-1.5 py-1 text-good transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:bg-white/5"
                >
                  <Icon name="check" size="sm" />
                  <span className="ms-1 text-[length:var(--text-xs)]">ثبت انجام توقف</span>
                </button>
                <button
                  onClick={() => setStatus(p.id, "skipped")}
                  className="rounded-[var(--radius-sm)] px-1.5 py-1 text-text-muted transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:bg-white/5"
                >
                  <Icon name="x" size="sm" />
                  <span className="ms-1 text-[length:var(--text-xs)]">رد کردن توقف</span>
                </button>
                <button
                  onClick={() => removePlan(p.id)}
                  className="rounded-[var(--radius-sm)] px-1.5 py-1 text-crit transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:bg-white/5"
                >
                  <Icon name="minus" size="sm" />
                  <span className="ms-1 text-[length:var(--text-xs)]">حذف از برنامه</span>
                </button>
              </div>
            </div>
            {restockHint && restockHint.afterIndex === i + 1 && (
              <RestockHint hint={restockHint} busy={optimising} onAdd={insertRestockStop} />
            )}
            </li>
          ))}
          {returnLegKm !== null && origin && (
            <li className="flex items-center gap-2 pe-6 font-mono text-[length:var(--text-xs)] text-text-faint">
              <span aria-hidden="true"><Icon name="arrow-down" size="sm" /></span>
              <span>{formatDistanceKm(returnLegKm)}</span>
              <span>بازگشت به {origin.label}</span>
              <span className="h-px flex-1 bg-border" aria-hidden="true" />
            </li>
          )}
        </ul>
        </>
      )
  );
}
