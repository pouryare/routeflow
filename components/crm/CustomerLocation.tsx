"use client";
import { useState, Suspense, useEffect } from "react";
import dynamic from "next/dynamic";
import { Icon } from "@/components/meridian/Icon";
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
  useEffect(() => {
    if (!open) return;
    const close = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);
  const hasPin = lat !== null && lng !== null && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  const editButton = canWrite && onConfirm ? <button type="button" className="inline-flex items-center justify-center gap-[var(--space-2)] btn ghost" style={TOUCH} disabled={busy} onClick={() => setEditing(true)}>
  <Icon name="map-pin" size="md" />
  {hasPin ? "ویرایش موقعیت" : "افزودن موقعیت"}</button> : null;
  if (editing && canWrite && onConfirm) return <LocationEditor initial={hasPin ? { lat: lat!, lng: lng!, link: mapsUrl ?? undefined } : null} onCancel={() => setEditing(false)} onConfirm={async (pLat, pLng, link) => { await onConfirm(pLat, pLng, link); setEditing(false); }} />;
  if (!hasPin) return <div className="no-pin"><Icon name="map-pin" size="sm" /> موقعیت ثبت نشده است{editButton}</div>;
  return (
    <figure className="mini-map">
      <div className="map-frame">
        <Suspense fallback={<div className="map-loading">…</div>}>
          <Map key={`${lat},${lng}`} lat={lat!} lng={lng!} name={name} />
        </Suspense>
        <button type="button" className="inline-flex items-center justify-center gap-[var(--space-2)] map-expand" style={TOUCH} aria-label="بزرگ‌نمایی نقشه" onClick={() => setOpen(true)}>
          <Icon name="maximize" size="sm" /> بزرگ‌نمایی
        </button>
      </div>
      <figcaption className="map-caption">موقعیت ثبت‌شدهٔ کسب‌وکار {editButton}</figcaption>
      {open && (
        <div className="meridian-scrim on" onClick={() => setOpen(false)} aria-hidden />
      )}
      {open && (
        <div className="sheet on map-sheet" role="dialog" aria-modal="true" aria-label={`نقشهٔ موقعیت ${name}`}>
          <div className="sheethead">
            <h2>موقعیت {name}</h2>
            <button className="inline-flex items-center justify-center gap-[var(--space-2)] x" type="button" aria-label="بستن نقشهٔ بزرگ" onClick={() => setOpen(false)}><Icon name="x" size="sm" /></button>
          </div>
          <div className="map-frame tall">
            <Suspense fallback={<div className="map-loading">…</div>}>
              <Map key={`${lat},${lng}`} lat={lat!} lng={lng!} name={name} interactive />
            </Suspense>
          </div>
          {mapsUrl && /^https?:\/\//i.test(mapsUrl) && <a className="btn ghost" style={TOUCH} href={mapsUrl} target="_blank" rel="noreferrer">پیوند نقشه</a>}
        </div>
      )}
    </figure>
  );
}
