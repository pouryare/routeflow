"use client";

import type { Result } from "@/components/SearchBox";
import { Icon } from "@/components/meridian/Icon";
import { GeoResult, detectInputType, isFavorite } from "@/components/searchbox/searchBoxStore";

/** What the open search panel shows for a typed query: a link, coordinates, address matches, local matches, or the geocoder offer. */
export default function SearchResultsBody({ trimmed, isUrl, decodeLink, linkLoading, linkError, inputType, coordMatch, goToCoords, geoResults, selectGeoResult, results, select, toggleFavorite, runGeosearch, geoLoading }: {
  trimmed: string;
  isUrl: boolean;
  decodeLink: () => void;
  linkLoading: boolean;
  linkError: string | null;
  inputType: ReturnType<typeof detectInputType>;
  coordMatch: RegExpMatchArray | null;
  goToCoords: () => void;
  geoResults: GeoResult[] | null;
  selectGeoResult: (r: GeoResult) => void;
  results: Result[];
  select: (r: Result) => void;
  toggleFavorite: (r: Result) => void;
  runGeosearch: () => void;
  geoLoading: boolean;
}) {
  return (
        isUrl ? (
          <div className="p-2">
            <button
              onClick={decodeLink}
              disabled={linkLoading}
              className="inline-flex items-center justify-center gap-[var(--space-2)] w-full rounded-[var(--radius-sm)] border border-accent bg-accent px-3 py-2 text-[length:var(--text-sm)] font-medium text-accent-ink disabled:opacity-60"
            >
              {linkLoading ? "در حال شناسایی لینک…" : <><Icon name="link" size="sm" /> نمایش این لینک روی نقشه</>}
            </button>
            {linkError && <p className="mt-2 px-1 text-[length:var(--text-xs)] text-crit">{linkError}</p>}
            <p className="mt-2 px-1 text-[length:var(--text-xs)] leading-5 text-text-faint">
              گوگل‌مپ، نشان، بلد و ویز پشتیبانی می‌شوند
            </p>
          </div>
        ) : inputType === "coord" && coordMatch ? (
          <div className="p-2">
            <button
              onClick={goToCoords}
              className="inline-flex items-center justify-center gap-[var(--space-2)] w-full rounded-[var(--radius-sm)] border border-accent bg-accent px-3 py-2 text-[length:var(--text-sm)] font-medium text-accent-ink"
            >
              <Icon name="map-pin" size="sm" /> نمایش مختصات روی نقشه
              <span className="block text-[length:var(--text-xs)] text-accent/60 font-mono">{coordMatch[1]}, {coordMatch[2]}</span>
            </button>
          </div>
        ) : inputType === "address" && trimmed.length >= 2 ? null : geoResults !== null ? (
          geoResults.length > 0 ? (
            geoResults.map((r, i) => (
              <button
                key={i}
                onClick={() => selectGeoResult(r)}
                className="mapsearch__opt"
              >
                <Icon name="map-pin" size="sm" />
                <span className="mapsearch__label">{r.label}</span>
              </button>
            ))
          ) : (
            <p className="px-3 py-2 text-[length:var(--text-sm)] text-text-faint">آدرسی پیدا نشد</p>
          )
        ) : results.length > 0 ? (
          results.map((r, i) => (
            <button
              key={i}
              onClick={() => select(r)}
              className="mapsearch__opt"
            >
              {r.kind === "customer" ? (
                <>
                  <Icon name="building" size="sm" />
                  <span className="mapsearch__label">{r.customer.business_name}</span>
                  <span className="shrink-0 font-mono text-[length:var(--text-xs)] text-text-faint">
                    {r.customer.customer_code}
                  </span>
                </>
              ) : (
                <>
                  <Icon name="map" size="sm" />
                  <span className="mapsearch__label">{r.district.properties.name}</span>
                  <span className="shrink-0 text-[length:var(--text-xs)] text-text-faint">
                    {r.district.properties.parent_name ?? ""}
                  </span>
                </>
              )}
              <button onClick={(e) => { e.stopPropagation(); toggleFavorite(r); }} className="shrink-0 text-[length:var(--text-xs)] text-text-faint hover:text-accent" aria-label="save favorite">
                <Icon name="star" size="sm" filled={isFavorite(r.kind === "customer" ? `cust_${r.customer.customer_code}` : `dist_${r.district.properties.name}`)} />
              </button>
            </button>
          ))
        ) : (
          <div className="p-2">
            <p className="px-1 pb-2 text-[length:var(--text-sm)] text-text-faint">نتیجه‌ای یافت نشد</p>
            <button
              onClick={runGeosearch}
              disabled={geoLoading}
              className="inline-flex items-center justify-center gap-[var(--space-2)] w-full rounded-[var(--radius-sm)] border border-border px-3 py-2 text-[length:var(--text-sm)] text-text-muted transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:border-accent hover:text-accent disabled:opacity-60"
            >
              {geoLoading ? (
                "در حال جستجو…"
              ) : (
                <>
                  <Icon name="search" size="sm" /> جستجوی «{trimmed}» به‌عنوان آدرس
                </>
              )}
            </button>
          </div>
        )
  );
}
