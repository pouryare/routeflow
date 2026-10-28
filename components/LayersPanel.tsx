"use client";

import MapButton from "@/components/map/MapButton";
import {
  BASEMAPS,
  OVERLAYS,
  OVERLAY_GROUPS,
  basemapDef,
  changedFromDefault,
  type BasemapId,
  type LayerPrefs,
  type OverlayId,
} from "@/lib/mapLayers";
import { faDigits } from "@/lib/format";
import type { ZoneKind, ZoneStatus } from "@/lib/trafficZones";
import type { IconName } from "@/components/meridian/icon-map";
import { Icon } from "@/components/meridian/Icon";
import CheckField from "@/components/CheckField";

/** The layers button, sitting with the map's own controls. The panel it opens is
 *  ordinary React rendered outside the map, so it can be a bottom sheet on a phone like
 *  every other panel in this app. No count badge: the number of layers that differ from
 *  their defaults is not something anyone keeps in their head. */
export function LayersControl({ open, onClick }: { open: boolean; count: number; onClick: () => void }) {
  return (
    <MapButton label={open ? "بستن لایه‌ها" : "لایه‌های نقشه"} expanded={open} className={`layers-toggle${open ? " is-open" : ""}`} onClick={onClick}>
      <Icon name="layers" size="md" />
    </MapButton>
  );
}

function Row({
  checked,
  onChange,
  icon,
  label,
  hint,
  disabled = false,
  suffix,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  icon: IconName;
  label: string;
  hint: string;
  disabled?: boolean;
  suffix?: React.ReactNode;
}) {
  return (
    <CheckField
      checked={checked}
      disabled={disabled}
      onChange={onChange}
      className={`items-start gap-2.5 rounded-[var(--radius-md)] px-2 py-2 transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] ${
        disabled ? "opacity-45" : "hover:bg-white/5"
      }`}
    >
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[length:var(--text-sm)] text-text">
          <Icon name={icon} size="sm" />
          <span>{label}</span>
          {suffix}
        </span>
        <span className="mt-0.5 block text-[length:var(--text-xs)] leading-5 text-text-faint">{hint}</span>
      </span>
    </CheckField>
  );
}

/** A zone's own line in the panel says whether you may drive in right now, because the
 *  boundary alone does not answer the question anyone actually has.
 *
 *  A permit zone in force reads as شد/نشد and is drawn in the critical colour; a quota
 *  zone in force is a price, not a wall, so it gets the warning colour and says what it
 *  spends. Giving both the same red would have the app shout equally at "turn around" and
 *  at "this is one of your twenty days". */
function ZoneNow({ status, kind }: { status: ZoneStatus; kind: ZoneKind }) {
  if (status.state === "unknown") {
    return <span className="rounded-full bg-white/10 px-1.5 py-px text-[10px] text-text-faint">ساعت نامعلوم</span>;
  }
  if (status.state === "restricted") {
    const until = status.until ? ` تا ${faDigits(status.until)}` : "";
    return kind === "permit" ? (
      <span className="rounded-full bg-crit/20 px-1.5 py-px text-[10px] text-crit">الان محدود{until}</span>
    ) : (
      <span className="rounded-full bg-warn/20 px-1.5 py-px text-[10px] text-warn">الان طرح است{until}</span>
    );
  }
  return (
    <span className="rounded-full bg-good/20 px-1.5 py-px text-[10px] text-good">
      الان آزاد{status.until ? ` تا ${faDigits(status.until)}` : ""}
    </span>
  );
}

export default function LayersPanel({
  open,
  onClose,
  basemap,
  onBasemap,
  layers,
  onLayer,
  zoneStatus,
  hasCorridor,
}: {
  open: boolean;
  onClose: () => void;
  basemap: BasemapId;
  onBasemap: (id: BasemapId) => void;
  layers: LayerPrefs;
  onLayer: (id: OverlayId, on: boolean) => void;
  /** Live "may I drive in" per zone id, or null while the zone file is still loading. */
  zoneStatus: Record<string, ZoneStatus> | null;
  /** False when there are fewer than two of our own sites, so there is no corridor to
   *  draw and the row would be a switch that does nothing. */
  hasCorridor: boolean;
}) {
  if (!open) return null;

  const base = basemapDef(basemap);

  return (
    <div
      dir="rtl"
      role="dialog"
      aria-label="لایه‌های نقشه"
      className="modal-card-enter sheet-on-mobile absolute bottom-4 left-4 top-20 z-[var(--z-panel)] flex w-80 flex-col overflow-y-auto rounded-[var(--radius-lg)] border border-border bg-surface-raised/97 backdrop-blur elevate-accent"
    >
      <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-border bg-surface-raised/97 px-3 py-2.5 backdrop-blur">
        <h2 className="text-[length:var(--text-md)] font-bold text-text">لایه‌های نقشه</h2>
        <button
          onClick={onClose}
          aria-label="بستن لایه‌ها"
          className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-[var(--radius-sm)] px-2 py-1 text-text-muted transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:bg-white/5 hover:text-text"
        >
          <Icon name="x" size="sm" />
          <span className="text-[length:var(--text-xs)]">بستن لایه‌ها</span>
        </button>
      </div>

      <div className="flex flex-col gap-3 p-3">
        <section>
          <h3 className="mb-1.5 font-mono text-[length:var(--text-xs)] uppercase tracking-[0.12em] text-text-faint">
            نقشه پایه
          </h3>
          <div className="opt-row third gap-1.5">
            {BASEMAPS.map((b) => {
              const on = basemap === b.id;
              return (
                <button
                  key={b.id}
                  onClick={() => onBasemap(b.id)}
                  aria-pressed={on}
                  title={b.hint}
                  className={`group relative overflow-hidden rounded-[var(--radius-sm)] border text-right transition-[border-color,transform] duration-[var(--dur-base)] ease-[var(--ease-out)] active:scale-[0.97] ${
                    on
                      ? "border-accent ring-1 ring-accent"
                      : "border-border hover:border-text-faint"
                  }`}
                >
                  {/* Pre-rendered in public/basemap-thumbs by scripts/gen-basemap-thumbs.mjs.
                      Wrapped in <picture> to match the codebase's other raster thumbs and
                      keep next/lint's no-img-element rule quiet. */}
                  <picture>
                    <img
                      src={`/basemap-thumbs/${b.id}.png`}
                      alt=""
                      aria-hidden="true"
                      loading="lazy"
                      decoding="async"
                      className="h-12 w-full bg-surface object-cover"
                    />
                  </picture>
                  <span
                    className={`flex items-center gap-1 px-1.5 py-1 text-[length:var(--text-xs)] leading-4 ${
                      on ? "bg-accent font-medium text-accent-ink" : "bg-surface text-text-muted"
                    }`}
                  >
                    <Icon name={b.icon} size="sm" />
                    <span className="truncate">{b.label}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <p className="mt-1.5 px-1 text-[length:var(--text-xs)] leading-5 text-text-faint">{base.hint}</p>
        </section>

        {OVERLAY_GROUPS.map((group) => {
          const rows = OVERLAYS.filter((o) => o.group === group.id);
          if (rows.length === 0) return null;
          return (
            <section key={group.id}>
              <h3 className="mb-0.5 font-mono text-[length:var(--text-xs)] uppercase tracking-[0.12em] text-text-faint">
                {group.label}
              </h3>
              {rows.map((o) => {
                const missing = o.id === "corridor" && !hasCorridor;
                const status = zoneStatus?.[o.id === "traffic_zone" ? "limited_traffic" : "low_emission"];
                return (
                  <Row
                    key={o.id}
                    checked={layers[o.id]}
                    onChange={(next) => onLayer(o.id, next)}
                    icon={o.icon}
                    label={o.label}
                    disabled={missing}
                    hint={missing ? "برای این لایه باید دست‌کم دو انبار ثبت شده باشد." : o.hint}
                    suffix={
                      (o.id === "traffic_zone" || o.id === "low_emission") && status ? (
                        <ZoneNow status={status} kind={o.id === "traffic_zone" ? "permit" : "quota"} />
                      ) : undefined
                    }
                  />
                );
              })}
            </section>
          );
        })}

        <p className="border-t border-border px-1 pt-2 text-[length:var(--text-xs)] leading-5 text-text-faint">
          هیچ‌کدام از این دو، تعطیلات رسمی را نمی‌دانند — در تعطیلات هر دو محدوده آزادند ولی
          اینجا فعال نشان داده می‌شوند. جمعه‌ها درست حساب می‌شود.
        </p>
      </div>
    </div>
  );
}

/** Stands in for a switch that used to live in the sidebar.
 *
 *  The settings for a layer stay next to the data they describe -- the corridor's width,
 *  the heatmap's weighting -- but switching the layer on is now one job done in one place.
 *  A section that just went blank would read as broken, so it says where the switch went
 *  and offers to open it.
 */
export function LayerHint({
  onOpen,
  what,
  compact = false,
}: {
  onOpen: () => void;
  what: string;
  compact?: boolean;
}) {
  return (
    <button
      onClick={onOpen}
      className={`rounded-[var(--radius-sm)] border border-border text-[length:var(--text-xs)] text-text-muted transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:border-accent hover:text-accent ${
        compact ? "inline-flex shrink-0 items-center gap-1.5 px-2 py-1" : "flex w-full items-center gap-1.5 px-2 py-2 text-right"
      }`}
    >
      <Icon name="layers" size="sm" /> {compact ? "روشن کردن" : `${what} خاموش است — از دکمه لایه‌ها روشنش کنید`}
    </button>
  );
}

export { changedFromDefault };
