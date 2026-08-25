"use client";

import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
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

/** The layers button, sitting with Leaflet's own controls.
 *
 *  The button is a Leaflet control so it keeps its place in the top-left stack whatever
 *  else the map does; the panel it opens is ordinary React rendered outside the map, so
 *  it can be a bottom sheet on a phone like every other panel in this app.
 */
function LayersButton({ open, count, onClick }: { open: boolean; count: number; onClick: () => void }) {
  const map = useMap();
  const buttonRef = useRef<HTMLAnchorElement | null>(null);
  // Written in an effect rather than during render: the control is created once and its
  // click handler closes over this ref, so it needs the latest callback without the
  // control being torn down and rebuilt every time the parent re-renders.
  const onClickRef = useRef(onClick);
  useEffect(() => {
    onClickRef.current = onClick;
  }, [onClick]);

  useEffect(() => {
    const Button = L.Control.extend({
      onAdd() {
        const container = L.DomUtil.create("div", "leaflet-bar leaflet-control layers-toggle-control");
        const button = L.DomUtil.create("a", "", container) as HTMLAnchorElement;
        button.href = "#";
        button.setAttribute("role", "button");
        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.on(button, "click", (e) => {
          L.DomEvent.preventDefault(e);
          onClickRef.current();
        });
        buttonRef.current = button;
        return container;
      },
      onRemove() {
        buttonRef.current = null;
      },
    });
    const control = new Button({ position: "topleft" });
    control.addTo(map);
    return () => {
      control.remove();
    };
  }, [map]);

  useEffect(() => {
    const button = buttonRef.current;
    if (!button) return;
    const label = open ? "بستن لایه‌ها" : "لایه‌های نقشه";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.setAttribute("aria-expanded", open ? "true" : "false");
    button.innerHTML = count > 0 ? `▤<span class="layers-badge">${faDigits(String(count))}</span>` : "▤";
    button.classList.toggle("is-open", open);
  }, [open, count]);

  return null;
}

export function LayersControl(props: { open: boolean; count: number; onClick: () => void }) {
  return <LayersButton {...props} />;
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
  icon: string;
  label: string;
  hint: string;
  disabled?: boolean;
  suffix?: React.ReactNode;
}) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-2.5 rounded-[var(--radius-md)] px-2 py-2 transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] ${
        disabled ? "cursor-not-allowed opacity-45" : "hover:bg-white/5"
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 accent-[color:var(--accent)]"
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[length:var(--text-sm)] text-text">
          <span aria-hidden="true">{icon}</span>
          <span>{label}</span>
          {suffix}
        </span>
        <span className="mt-0.5 block text-[length:var(--text-xs)] leading-5 text-text-faint">{hint}</span>
      </span>
    </label>
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
      className="modal-card-enter sheet-on-mobile absolute bottom-4 left-4 top-20 z-[var(--z-panel)] flex w-72 flex-col overflow-y-auto rounded-[var(--radius-lg)] border border-border bg-surface-raised/97 backdrop-blur elevate-accent"
    >
      <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-border bg-surface-raised/97 px-3 py-2.5 backdrop-blur">
        <h2 className="text-[length:var(--text-md)] font-bold text-text">لایه‌های نقشه</h2>
        <button
          onClick={onClose}
          aria-label="بستن"
          className="rounded-[var(--radius-sm)] px-2 py-1 text-text-muted transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:bg-white/5 hover:text-text"
        >
          ✕
        </button>
      </div>

      <div className="flex flex-col gap-3 p-3">
        <section>
          <h3 className="mb-1.5 font-mono text-[length:var(--text-xs)] uppercase tracking-[0.12em] text-text-faint">
            نقشه پایه
          </h3>
          <div className="flex gap-1 rounded-[var(--radius-md)] border border-border bg-surface p-1">
            {BASEMAPS.map((b) => (
              <button
                key={b.id}
                onClick={() => onBasemap(b.id)}
                aria-pressed={basemap === b.id}
                className={`flex-1 rounded-[var(--radius-sm)] px-1 py-1.5 text-[length:var(--text-xs)] transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] ${
                  basemap === b.id
                    ? "bg-accent font-medium text-[#04191c]"
                    : "text-text-muted hover:bg-white/5 hover:text-text"
                }`}
              >
                <span aria-hidden="true" className="me-1">
                  {b.icon}
                </span>
                {b.label}
              </button>
            ))}
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
                // The street basemap draws its own names, so the overlay would print a
                // second set on top of the first. Say why it is off rather than hiding it
                // and leaving the switch to look broken.
                const redundant = o.id === "labels" && base.hasLabels;
                const missing = o.id === "corridor" && !hasCorridor;
                const status = zoneStatus?.[o.id === "traffic_zone" ? "limited_traffic" : "low_emission"];
                return (
                  <Row
                    key={o.id}
                    checked={layers[o.id] && !redundant}
                    onChange={(next) => onLayer(o.id, next)}
                    icon={o.icon}
                    label={o.label}
                    disabled={redundant || missing}
                    hint={
                      redundant
                        ? "نقشه خیابانی خودش نام‌ها را دارد."
                        : missing
                          ? "برای این لایه باید دست‌کم دو انبار ثبت شده باشد."
                          : o.hint
                    }
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
        compact ? "shrink-0 px-2 py-1" : "w-full px-2 py-2 text-right"
      }`}
    >
      ▤ {compact ? "روشن کردن" : `${what} خاموش است — از دکمه لایه‌ها روشنش کنید`}
    </button>
  );
}

export { changedFromDefault };
