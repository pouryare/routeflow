"use client";
import { useState, Suspense, useCallback } from "react";
import dynamic from "next/dynamic";
import { Icon } from "@/components/meridian/Icon";
import BottomSheet from "@/components/mobile/BottomSheet";
import WidgetBoundary from "@/components/WidgetBoundary";
const Map = dynamic(() => import("./CustomerLocationMap"), { ssr: false });
const LocationEditor = dynamic(() => import("./LocationEditor"), { ssr: false });

const TOUCH = { minHeight: 44, minWidth: 44 } as const;

/** The customer's saved pin, mini in the card and enlarged in a dialog. Leaflet loads only
 *  when coordinates exist — an unpinned business shows an honest missing-location row. */
export default function CustomerLocation({ lat, lng, name, mapsUrl, canWrite, busy, onConfirm }: {
  lat: number | null; lng: number | null; name: string; mapsUrl: string | null;
  canWrite?: boolean; busy?: boolean;
  onConfirm?: (lat: number, lng: number, link?: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const hasPin = lat !== null && lng !== null && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  const editButton = canWrite && onConfirm ? <button type="button" className="inline-flex items-center justify-center gap-[var(--space-2)] btn ghost" style={TOUCH} disabled={busy} onClick={() => setEditing(true)}>
  <Icon name={hasPin ? "edit" : "plus"} size="md" />
  {hasPin ? "ویرایش موقعیت" : "افزودن موقعیت"}</button> : null;
  if (editing && canWrite && onConfirm) return <WidgetBoundary label="ویرایش موقعیت"><LocationEditor initial={hasPin ? { lat: lat!, lng: lng!, link: mapsUrl ?? undefined } : null} onCancel={() => setEditing(false)} onConfirm={async (pLat, pLng, link) => { await onConfirm(pLat, pLng, link); setEditing(false); }} /></WidgetBoundary>;
  if (!hasPin) return <div className="no-pin"><Icon name="map-pin" size="sm" /> موقعیت ثبت نشده است{editButton}</div>;
  return (
    <figure className="mini-map">
      <div className="map-frame">
        <WidgetBoundary label="نقشهٔ موقعیت مشتری" resetKeys={[lat, lng]}>
          <Suspense fallback={<div className="map-loading">…</div>}>
            <Map key={`${lat},${lng}`} lat={lat!} lng={lng!} name={name} />
          </Suspense>
        </WidgetBoundary>
        <button type="button" className="inline-flex items-center justify-center gap-[var(--space-2)] map-expand" style={TOUCH} aria-label="بزرگ‌نمایی نقشه" onClick={() => setOpen(true)}>
          <Icon name="maximize" size="sm" /> بزرگ‌نمایی
        </button>
      </div>
      <figcaption className="map-caption">موقعیت ثبت‌شدهٔ کسب‌وکار {editButton}</figcaption>
      <BottomSheet open={open} title={`موقعیت ${name}`} onClose={close} closeLabel="بستن نقشه" bodyClassName="map-sheet" wide>
        <div className="map-frame tall">
          <WidgetBoundary label="نقشهٔ موقعیت مشتری" resetKeys={[lat, lng]}>
            <Suspense fallback={<div className="map-loading">…</div>}>
              <Map key={`${lat},${lng}`} lat={lat!} lng={lng!} name={name} interactive />
            </Suspense>
          </WidgetBoundary>
        </div>
        {mapsUrl && /^https?:\/\//i.test(mapsUrl) && <a className="btn ghost" style={TOUCH} href={mapsUrl} target="_blank" rel="noreferrer"><Icon name="external-link" size="md" />پیوند نقشه</a>}
      </BottomSheet>
    </figure>
  );
}
