"use client";

import type { FacilityRow } from "@/lib/facilityTypes";
import { formatDistanceKm } from "@/lib/geo";
import { faFixed } from "@/lib/format";
import { useNavApp } from "@/components/NavAppSetting";
import { navApp } from "@/lib/navApps";
import { Icon } from "@/components/meridian/Icon";
import { Origin } from "@/lib/plannerView";
import CheckField from "@/components/CheckField";

/** The planner's origin line: where the day is measured from, the picker, the route length and the optimise button. */
export default function PlanOriginPanel({ origin, originPickerOpen, setOriginPickerOpen, returnToOrigin, toggleReturnToOrigin, facilities, originOverrideId, setOriginOverrideId, setMyPos, locate, dayLengthKm, warehouseDetour, googleRoute, navAppId, optimisation, applyOptimalOrder, optimising }: {
  origin: Origin | null;
  originPickerOpen: boolean;
  setOriginPickerOpen: (open: boolean) => void;
  returnToOrigin: boolean;
  toggleReturnToOrigin: () => void;
  facilities: FacilityRow[];
  originOverrideId: number | null;
  setOriginOverrideId: (id: number | null) => void;
  setMyPos: (p: null) => void;
  locate: () => void;
  dayLengthKm: number | null;
  warehouseDetour: { name: string; deltaKm: number } | null;
  googleRoute: { url: string; singleLeg: boolean; dropped: number } | null;
  navAppId: ReturnType<typeof useNavApp>[0];
  optimisation: { savedPct: number; savedKm: number } | null;
  applyOptimalOrder: () => void;
  optimising: boolean;
}) {
  return (
          <div className="mb-3 flex flex-col gap-2 rounded-[var(--radius-md)] border border-border bg-surface p-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[length:var(--text-xs)] uppercase tracking-wide text-text-faint">
                مبدأ
              </span>
              <button
                onClick={() => setOriginPickerOpen(!originPickerOpen)}
                className="rounded-[var(--radius-sm)] border border-border px-2 py-1 text-[length:var(--text-xs)] text-text transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:border-accent hover:text-accent"
              >
                {origin ? origin.label : "تعیین نشده"}
                {origin?.source === "gps" && " (GPS)"}
                {origin?.source === "override" && " (برای امروز)"}
                <span className="no-print"> <Icon name="chevron-down" size="sm" /></span>
              </button>

              <span className="mr-auto">
                <CheckField checked={returnToOrigin} onChange={() => toggleReturnToOrigin()} className="text-[length:var(--text-xs)] text-text-muted">
                  بازگشت به مبدأ
                </CheckField>
              </span>
            </div>

            {originPickerOpen && (
              <div className="flex flex-wrap gap-1.5 border-t border-border pt-2">
                {facilities.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => {
                      setOriginOverrideId(f.id);
                      setMyPos(null);
                      setOriginPickerOpen(false);
                    }}
                    className="rounded-[var(--radius-sm)] border border-border px-2 py-1 text-[length:var(--text-xs)] text-text-muted hover:border-accent hover:text-accent"
                  >
                    <Icon name="locate" size="sm" />
                    {f.name}
                  </button>
                ))}
                <button
                  onClick={() => {
                    setOriginOverrideId(null);
                    setOriginPickerOpen(false);
                    locate();
                  }}
                  className="rounded-[var(--radius-sm)] border border-border px-2 py-1 text-[length:var(--text-xs)] text-text-muted hover:border-accent hover:text-accent"
                >
                  <Icon name="locate" size="sm" />
                  موقعیت فعلی من (GPS)
                </button>
                {originOverrideId !== null && (
                  <button
                    onClick={() => {
                      setOriginOverrideId(null);
                      setOriginPickerOpen(false);
                    }}
                    className="rounded-[var(--radius-sm)] border border-border px-2 py-1 text-[length:var(--text-xs)] text-text-faint hover:border-crit hover:text-crit"
                  >
                    <Icon name="arrow-right" size="sm" />
                    بازگشت به مبدأ پیش‌فرض
                  </button>
                )}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[length:var(--text-xs)] text-text-faint">
              {dayLengthKm !== null && (
                <span>
                  {formatDistanceKm(dayLengthKm)} کل مسیر — خط مستقیم
                </span>
              )}
              {/* Feature 4 */}
              {warehouseDetour && (
                <span style={{ color: warehouseDetour.deltaKm > 0 ? "var(--warn)" : "var(--good)" }}>
                  بارگیری از {warehouseDetour.name}:{" "}
                  {warehouseDetour.deltaKm > 0 ? "+" : "−"}
                  {formatDistanceKm(Math.abs(warehouseDetour.deltaKm))}
                  {warehouseDetour.deltaKm <= 0 && " (سر راه است)"}
                </span>
              )}
            </div>

            {googleRoute?.singleLeg && (
              <p className="text-[length:var(--text-xs)] leading-5 text-warn">
                {navApp(navAppId).label} فقط یک مقصد را می‌پذیرد؛ توقف‌های بعدی را از همین فهرست باز کنید.
                برای باز کردن کل مسیر در یک لینک، از گوگل‌مپ، نشان، بلد یا ویز استفاده کنید.
              </p>
            )}

            {googleRoute && googleRoute.dropped > 0 && (
              <p className="text-[length:var(--text-xs)] leading-5 text-warn">
                گوگل‌مپ حداکثر ۱۰ ایستگاه میانی می‌پذیرد؛ {googleRoute.dropped} ایستگاه در لینک مسیر
                نمی‌آید. مسیر را در دو بخش باز کنید.
              </p>
            )}

            {/* Feature 6: an explicit action, never a live re-sort -- the list below
                has manual reorder arrows and they must not be overwritten silently. */}
            {optimisation && optimisation.savedPct >= 1 && (
              <button
                onClick={applyOptimalOrder}
                disabled={optimising}
                className="inline-flex items-center justify-center gap-[var(--space-2)] w-fit rounded-[var(--radius-sm)] border border-accent px-2 py-1 text-[length:var(--text-xs)] text-accent transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:bg-accent hover:text-accent-ink disabled:opacity-50"
              >
                <Icon name="sparkle" size="sm" />
                {optimising
                  ? "در حال اعمال…"
                  : `مرتب‌سازی خودکار — ${faFixed(optimisation.savedPct, 0)}٪ کوتاه‌تر (${formatDistanceKm(optimisation.savedKm)})`}
              </button>
            )}
          </div>
  );
}
