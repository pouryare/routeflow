"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CustomerRow, DistrictFeature } from "@/lib/types";
import { matchesQuery } from "@/lib/persian";

// leaflet-geosearch's own SearchResult type lives at a package-internal path that
// isn't reliably resolvable through its published exports map -- only the fields
// actually used here are declared locally instead of depending on that path.
interface GeoResult {
  x: number; // lng
  y: number; // lat
  label: string;
}

interface GeoProvider {
  search(opts: { query: string }): Promise<GeoResult[]>;
}

type Result =
  | { kind: "customer"; customer: CustomerRow }
  | { kind: "district"; district: DistrictFeature };

const URL_RE = /^https?:\/\//i;
const COORD_RE = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;

// leaflet-geosearch is only needed once a user actually falls through to an address
// search (no local match found) -- deferred to a dynamic import so its chunk never
// loads for the common case of finding a customer/district locally, and instantiated
// once, on first real use, rather than eagerly for every SearchBox mount.
let geoProviderPromise: Promise<GeoProvider> | null = null;
function getGeoProvider(): Promise<GeoProvider> {
  if (!geoProviderPromise) {
    geoProviderPromise = import("leaflet-geosearch").then(
      ({ OpenStreetMapProvider }) =>
        // Iran-biased so a plain place name (e.g. a neighborhood) resolves locally
        // instead of matching a same-named place elsewhere in the world.
        new OpenStreetMapProvider({ params: { countrycodes: "ir", "accept-language": "fa" } }) as GeoProvider
    );
  }
  return geoProviderPromise;
}

export default function SearchBox({
  customers,
  districts,
  onSelectCustomer,
  onSelectDistrict,
  onLocationFound,
}: {
  customers: CustomerRow[];
  districts: DistrictFeature[];
  onSelectCustomer: (c: CustomerRow) => void;
  onSelectDistrict: (d: DistrictFeature) => void;
  onLocationFound: (lat: number, lng: number, label: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [linkLoading, setLinkLoading] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [geoResults, setGeoResults] = useState<GeoResult[] | null>(null);
  const [geoLoading, setGeoLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const trimmed = query.trim();
  const isUrl = URL_RE.test(trimmed);
  const coordMatch = trimmed.match(COORD_RE);

  const results = useMemo<Result[]>(() => {
    if (!trimmed || isUrl || coordMatch) return [];
    // Matched under normalisation rather than by raw substring. Imported names very
    // often carry the Arabic ي and ك where a phone keyboard produces the Persian ی and
    // ک -- different codepoints, near-identical glyphs -- so a raw match made those
    // customers unfindable by typing their own name.
    const customerResults: Result[] = customers
      .filter(
        (c) =>
          matchesQuery(c.business_name, trimmed) ||
          matchesQuery(c.customer_code, trimmed) ||
          matchesQuery(c.phone ?? "", trimmed)
      )
      .slice(0, 6)
      .map((customer) => ({ kind: "customer", customer }));
    const districtResults: Result[] = districts
      .filter((d) => matchesQuery(d.properties.name, trimmed))
      .slice(0, 6)
      .map((district) => ({ kind: "district", district }));
    return [...customerResults, ...districtResults].slice(0, 8);
  }, [trimmed, customers, districts, isUrl, coordMatch]);

  useEffect(() => {
    setGeoResults(null);
    setLinkError(null);
  }, [query]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function select(r: Result) {
    if (r.kind === "customer") onSelectCustomer(r.customer);
    else onSelectDistrict(r.district);
    reset();
  }

  function reset() {
    setQuery("");
    setOpen(false);
    setGeoResults(null);
  }

  function useCoords() {
    if (!coordMatch) return;
    onLocationFound(Number(coordMatch[1]), Number(coordMatch[2]), "مختصات وارد شده");
    reset();
  }

  async function decodeLink() {
    setLinkLoading(true);
    setLinkError(null);
    try {
      const res = await fetch(`/api/geo/decode-link?url=${encodeURIComponent(trimmed)}`);
      const data = await res.json();
      if (!data.ok) {
        setLinkError(data.error || "لینک قابل تشخیص نبود");
        return;
      }
      onLocationFound(data.lat, data.lng, "لینک نقشه");
      reset();
    } catch {
      setLinkError("خطا در ارتباط با سرور");
    } finally {
      setLinkLoading(false);
    }
  }

  async function runGeosearch() {
    setGeoLoading(true);
    try {
      const provider = await getGeoProvider();
      const res = await provider.search({ query: trimmed });
      setGeoResults(res.slice(0, 5));
    } catch {
      setGeoResults([]);
    } finally {
      setGeoLoading(false);
    }
  }

  function selectGeoResult(r: GeoResult) {
    onLocationFound(r.y, r.x, r.label);
    reset();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    if (isUrl) decodeLink();
    else if (coordMatch) useCoords();
    else if (results.length === 0 && trimmed) runGeosearch();
  }

  return (
    <div
      ref={boxRef}
      // Centered within the space left of the sidebar-toggle button (top-right, 40px
      // wide + its own margin) rather than the full viewport -- centering on 100vw
      // regardless of that button made the two overlap on narrow phone screens.
      className="absolute left-4 right-[4.5rem] top-4 z-[1001] mx-auto w-72 max-w-[calc(100vw-5.5rem)]"
      dir="rtl"
    >
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="جستجوی مشتری، منطقه، آدرس یا لینک نقشه…"
        className="w-full rounded-[var(--radius-md)] border border-border bg-surface-raised px-3 py-2 text-[length:var(--text-sm)] text-text outline-none elevate-accent transition-[border-color] duration-[var(--dur-base)] ease-[var(--ease-out)] placeholder:text-text-faint focus:border-accent"
      />

      {open && trimmed && (
        <div className="mt-1 max-h-80 overflow-y-auto rounded-[var(--radius-md)] border border-border bg-surface-raised elevate-accent">
          {isUrl ? (
            <div className="p-2">
              <button
                onClick={decodeLink}
                disabled={linkLoading}
                className="w-full rounded-[var(--radius-sm)] border border-accent bg-accent px-3 py-2 text-[length:var(--text-sm)] font-medium text-[#04191c] disabled:opacity-60"
              >
                {linkLoading ? "در حال شناسایی لینک…" : "🔗 نمایش این لینک روی نقشه"}
              </button>
              {linkError && <p className="mt-2 px-1 text-[length:var(--text-xs)] text-crit">{linkError}</p>}
              <p className="mt-2 px-1 text-[length:var(--text-xs)] leading-5 text-text-faint">
                لینک گوگل‌مپس به‌صورت کامل پشتیبانی می‌شود؛ نشان و بلد به‌صورت حدسی بررسی می‌شوند.
              </p>
            </div>
          ) : coordMatch ? (
            <div className="p-2">
              <button
                onClick={useCoords}
                className="w-full rounded-[var(--radius-sm)] border border-accent bg-accent px-3 py-2 text-[length:var(--text-sm)] font-medium text-[#04191c]"
              >
                📍 نمایش این مختصات روی نقشه ({coordMatch[1]}, {coordMatch[2]})
              </button>
            </div>
          ) : geoResults !== null ? (
            geoResults.length > 0 ? (
              geoResults.map((r, i) => (
                <button
                  key={i}
                  onClick={() => selectGeoResult(r)}
                  className="flex w-full items-start gap-2 border-b border-border px-3 py-2 text-right text-[length:var(--text-sm)] text-text transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] last:border-b-0 hover:bg-white/5"
                >
                  <span>📍</span>
                  <span className="truncate">{r.label}</span>
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
                className="flex w-full items-center justify-between gap-2 border-b border-border px-3 py-2 text-right text-[length:var(--text-sm)] text-text transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] last:border-b-0 hover:bg-white/5"
              >
                {r.kind === "customer" ? (
                  <>
                    <span className="truncate">{r.customer.business_name}</span>
                    <span className="shrink-0 font-mono text-[length:var(--text-xs)] text-text-faint">
                      {r.customer.customer_code}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="truncate">{r.district.properties.name}</span>
                    <span className="shrink-0 text-[length:var(--text-xs)] text-text-faint">
                      {r.district.properties.parent_name ?? ""}
                    </span>
                  </>
                )}
              </button>
            ))
          ) : (
            <div className="p-2">
              <p className="px-1 pb-2 text-[length:var(--text-sm)] text-text-faint">نتیجه‌ای یافت نشد</p>
              <button
                onClick={runGeosearch}
                disabled={geoLoading}
                className="w-full rounded-[var(--radius-sm)] border border-border px-3 py-2 text-[length:var(--text-sm)] text-text-muted transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:border-accent hover:text-accent disabled:opacity-60"
              >
                {geoLoading ? "در حال جستجو…" : `🔍 جستجوی «${trimmed}» به‌عنوان آدرس`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
