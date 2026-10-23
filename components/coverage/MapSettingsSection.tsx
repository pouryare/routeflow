"use client";

import Link from "next/link";
import CollapsibleSection from "@/components/CollapsibleSection";
import NavAppSetting from "@/components/NavAppSetting";
import ToggleSwitch from "@/components/ToggleSwitch";
import { Icon } from "@/components/meridian/Icon";
import { faNum } from "@/lib/format";
import { PRECISION_AUTO_ZOOM, type PrecisionMode } from "@/lib/precision";
import CheckField from "@/components/CheckField";

/** One labelled on/off switch of the settings panel. The five switches used to be five copies of the same markup. */
function ToggleRow({
  title,
  hint,
  tightHint = false,
  checked,
  ariaLabel,
  onToggle,
}: {
  title: string;
  hint: string;
  /** Some hints sit on a taller line; kept as they were. */
  tightHint?: boolean;
  checked: boolean;
  ariaLabel: string;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div>
        <span className="text-[length:var(--text-sm)] text-text">{title}</span>
        <p className={`text-[length:var(--text-xs)] ${tightHint ? "leading-5 " : ""}text-text-faint`}>{hint}</p>
      </div>
      <ToggleSwitch on={checked} onChange={onToggle} label={ariaLabel} />
    </div>
  );
}

/** The map sidebar's «تنظیمات» section. State lives in CoverageMap (it drives the map itself); this holds only the markup. */
export default function MapSettingsSection({
  geofenceOn, setGeofenceOn,
  facilityGeofenceOn, setFacilityGeofenceOn,
  driverMode, setDriverMode,
  shapedMarkers, setShapedMarkers,
  nextStopOn, setNextStopOn,
  bulkMode, setBulkMode, clearBulkSelection,
  precisionMode, setPrecisionMode, activeTier,
}: {
  geofenceOn: boolean; setGeofenceOn: (f: (v: boolean) => boolean) => void;
  facilityGeofenceOn: boolean; setFacilityGeofenceOn: (v: boolean) => void;
  driverMode: boolean; setDriverMode: (v: boolean) => void;
  shapedMarkers: boolean; setShapedMarkers: (v: boolean) => void;
  nextStopOn: boolean; setNextStopOn: (v: boolean) => void;
  bulkMode: boolean; setBulkMode: (f: (v: boolean) => boolean) => void; clearBulkSelection: () => void;
  precisionMode: PrecisionMode; setPrecisionMode: (m: PrecisionMode) => void; activeTier: string;
}) {
  return (
    <CollapsibleSection title="تنظیمات" icon="settings" storageKey="settings" keywords="GPS موقعیت ژئوفنس اعلان نوتیفیکیشن دقت مرز انتخاب گروهی توقف بعدی شکل کوررنگی رنگ نابینایی رانندگی بزرگ درشت مسیریابی گوگل نشان بلد ویز">
      <div className="flex flex-col gap-4">
        <ToggleRow
          title="ثبت خودکار بازدید (GPS)"
          hint="وقتی نزدیک مشتری هستید پیشنهاد ثبت بازدید نمایش داده می‌شود"
          checked={geofenceOn}
          ariaLabel="ثبت خودکار بازدید"
          onToggle={() => setGeofenceOn((v) => !v)}
        />

        {/* A sub-option, not a sibling switch: it rides the same permission, the same
            position stream and the same battery cost as the toggle above, and
            presenting it as independent would imply otherwise. */}
        {geofenceOn && (
          <CheckField
            checked={facilityGeofenceOn}
            onChange={(next) => {
              setFacilityGeofenceOn(next);
              localStorage.setItem("coverage_geofence_sites", next ? "1" : "0");
            }}
            className="mt-2 items-start text-[length:var(--text-xs)] leading-5 text-text-muted"
          >
            <span>
              ثبت حضور در انبارها و مبدأ
              <span className="block text-text-faint">
                رسیدن به انبار یا مبدأ هم ثبت می‌شود — مبنای گزارش ساعت کاری روزانه
              </span>
            </span>
          </CheckField>
        )}

        <ToggleRow
          title="حالت رانندگی"
          hint="متن و دکمه‌ها بزرگ‌تر می‌شوند — برای استفاده با یک دست داخل خودرو"
          tightHint
          checked={driverMode}
          ariaLabel="حالت رانندگی"
          onToggle={() => {
            const next = !driverMode;
            setDriverMode(next);
            localStorage.setItem("coverage_driver_mode", next ? "1" : "0");
          }}
        />

        <ToggleRow
          title="نشانگرهای شکل‌دار"
          hint="به جای تکیه بر رنگ سبز/نارنجی/قرمز، هر وضعیت شکل خودش را می‌گیرد — دایره، مثلث، مربع"
          tightHint
          checked={shapedMarkers}
          ariaLabel="نشانگرهای شکل‌دار"
          onToggle={() => {
            const next = !shapedMarkers;
            setShapedMarkers(next);
            localStorage.setItem("coverage_shaped_markers", next ? "1" : "0");
          }}
        />

        <ToggleRow
          title="نوار توقف بعدی"
          hint="توقف بعدی برنامه امروز را پایین نقشه نشان می‌دهد"
          checked={nextStopOn}
          ariaLabel="نوار توقف بعدی"
          onToggle={() => {
            const next = !nextStopOn;
            setNextStopOn(next);
            localStorage.setItem("coverage_nextstop_off", next ? "0" : "1");
          }}
        />

        <ToggleRow
          title="انتخاب چندتایی مناطق"
          hint="برای ویرایش‌های گروهی روی دسکتاپ"
          checked={bulkMode}
          ariaLabel="حالت انتخاب چندتایی مناطق"
          onToggle={() => {
            /* Leaving bulk mode drops the selection. Said at the click rather than in an effect on
               [bulkMode]: an effect renders once with the stale selection still highlighted and then
               again without it, which is what react-hooks/set-state-in-effect is about. This is the
               only place bulkMode changes. */
            if (bulkMode) clearBulkSelection();
            setBulkMode((v) => !v);
          }}
        />

        <div>
          {/* Phase 2 moved every notification control — subscribing this device, quiet
              hours, and the per-type opt-in matrix — to one screen. A toggle here would
              only ever be a third of that story. */}
          <Link
            href="/settings/notifications"
            className="flex items-center justify-between gap-2 text-[length:var(--text-sm)] text-text hover:text-accent"
          >
            <span>تنظیمات اعلان‌ها</span>
            <Icon name="arrow-up-right" size="sm" />
          </Link>
        </div>

        <NavAppSetting />

        <div>
          <p className="mb-2 font-mono text-[length:var(--text-xs)] uppercase tracking-wide text-text-faint">
            دقت مرز مناطق
          </p>

          <div className="flex gap-1 rounded-[var(--radius-md)] border border-border bg-surface p-1">
            {(
              [
                ["auto", "خودکار"],
                ["low", "سریع"],
                ["high", "دقیق"],
              ] as [PrecisionMode, string][]
            ).map(([mode, label]) => (
              <button
                key={mode}
                onClick={() => setPrecisionMode(mode)}
                className={`flex-1 rounded-[var(--radius-sm)] px-0.5 py-1.5 text-[length:var(--text-xs)] transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] ${
                  precisionMode === mode
                    ? "bg-accent font-medium text-accent-ink"
                    : "text-text-muted hover:bg-white/5 hover:text-text"
                }`}
              >
                <Icon name="map-pin" size="sm" />
                {label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[length:var(--text-xs)] leading-5 text-text-faint">
            {precisionMode === "auto"
              ? `خودکار: در بزرگ‌نمایی کم مرزهای ساده‌شده و سبک، از بزرگ‌نمایی ${faNum(PRECISION_AUTO_ZOOM)} به بالا مرزهای کامل. (اکنون: ${activeTier === "high" ? "دقیق" : "سریع"})`
              : precisionMode === "low"
                ? "همیشه مرزهای ساده‌شده — سبک‌ترین حالت برای اینترنت ضعیف."
                : "همیشه مرزهای کامل — دقیق‌تر ولی سنگین‌تر."}
          </p>
        </div>
      </div>
    </CollapsibleSection>
  );
}
