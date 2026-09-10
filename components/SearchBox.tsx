"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CustomerRow, DistrictFeature } from "@/lib/types";
import { matchesQuery } from "@/lib/persian";
import { Icon } from "@/components/meridian/Icon";

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
  inputRef,
  onExpandedChange,
}: {
  customers: CustomerRow[];
  districts: DistrictFeature[];
  onSelectCustomer: (c: CustomerRow) => void;
  onSelectDistrict: (d: DistrictFeature) => void;
  onLocationFound: (lat: number, lng: number, label: string) => void;
  /** Handed in so the map's "/" shortcut can put the cursor here. Owned by the caller
   *  because the caller is what knows about keyboard shortcuts; this component only has
   *  to agree to be focused. */
  inputRef?: React.RefObject<HTMLInputElement | null>;
  /** Fires when the phone-sized box opens or closes.
   *
   *  Expanded, it takes the whole top row -- the row the sidebar button also sits in. The
   *  parent hides that button for the duration, which is the only way two things sharing
   *  one strip can avoid landing on top of each other. Padding the text away from it
   *  would leave the button covering an input the user is typing into. */
  onExpandedChange?: (expanded: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [linkLoading, setLinkLoading] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [geoResults, setGeoResults] = useState<GeoResult[] | null>(null);
  const [geoLoading, setGeoLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const localInputRef = useRef<HTMLInputElement>(null);

  /** Collapsed to an icon on a phone until it is wanted.
   *
   *  Expanded, this box is a permanent 300px obstruction across the top of a map that is
   *  already sharing that strip with the sidebar button -- and it is a control you reach
   *  for occasionally, on a screen where the map is the point. Collapsed it costs a
   *  40px circle; expanded it takes the whole width, which is more room than it ever had
   *  squeezed in beside the sidebar button.
   *
   *  Desktop has the width to spare and keeps the box open, so this only ever engages
   *  below the sheet breakpoint. */
  const [isNarrow, setIsNarrow] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const apply = () => setIsNarrow(mq.matches);
    // Reads a media query, which only exists in the browser -- there is no render in
    // which this could be computed instead.
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const collapsed = isNarrow && !expanded;

  function expand() {
    setExpanded(true);
    onExpandedChange?.(true);
    // After paint, or there is nothing focusable yet.
    window.setTimeout(() => (inputRef ?? localInputRef).current?.focus(), 0);
  }

  /** Every change of the query invalidates what the previous one produced.
   *
   *  Said here, at the moment it happens, rather than in an effect watching [query]:
   *  clearing state in an effect makes React render once with the stale results still on
   *  screen and then again without them, which is what react-hooks/set-state-in-effect is
   *  about. There are only three ways the query changes and all three go through here. */
  function changeQuery(next: string) {
    setQuery(next);
    setGeoResults(null);
    setLinkError(null);
  }

  function collapse() {
    setExpanded(false);
    onExpandedChange?.(false);
    setOpen(false);
    changeQuery("");
  }

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
    changeQuery("");
    setOpen(false);
  }

  function goToCoords() {
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
    else if (coordMatch) goToCoords();
    else if (results.length === 0 && trimmed) runGeosearch();
  }

  return (
    <div
      ref={boxRef}
      // Three arrangements, one element.
      //
      // Collapsed: a 40px button beside the sidebar toggle, top-right. Not top-left --
      // that belongs to Leaflet's own control stack (zoom, locate, basemap), which runs
      // 44px wide and 190px down the side and sits on top of anything put there.
      //
      // Expanded on a phone: nearly the full row, but starting clear of that same stack
      // so opening the search never buries the locate button. The sidebar toggle is
      // hidden by the parent for the duration, which is what frees the right end.
      //
      // Desktop: centred in the space left of the sidebar toggle, where it has always been.
      className={
        collapsed
          ? "absolute right-[4.5rem] top-4 z-[var(--z-map-chrome)]"
          : isNarrow
            ? "absolute left-14 right-4 top-4 z-[var(--z-map-chrome)]"
            : "absolute left-4 right-[4.5rem] top-4 z-[var(--z-map-chrome)] mx-auto w-72 max-w-[calc(100vw-5.5rem)]"
      }
      dir="rtl"
    >
      {collapsed ? (
        <button
          onClick={expand}
          aria-label="جستجوی مشتری، منطقه یا آدرس"
          aria-expanded={false}
          className="mapbtn"
        >
          <Icon name="search" size="md" />
        </button>
      ) : (
      <>
      <div className="relative">
      <input
        ref={inputRef ?? localInputRef}
        value={query}
        onChange={(e) => {
          changeQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="جستجوی مشتری، منطقه، آدرس یا لینک نقشه…"
        className={`mapsearch__input ${
          isNarrow ? "ps-9" : "ps-3"
        }`}
      />
      {/* Only on a phone, where the box was opened from an icon and so needs a way back
          to one. On a desktop it was never collapsed and there is nothing to return to. */}
      {isNarrow && (
        <button
          onClick={collapse}
          aria-label="بستن جستجو"
          className="absolute inset-y-0 left-2 flex items-center text-text-faint transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:text-text"
        >
          <Icon name="x" size="sm" />
        </button>
      )}
      </div>

      {open && trimmed && (
        <div className="mapsearch__panel">
          {isUrl ? (
            <div className="p-2">
              <button
                onClick={decodeLink}
                disabled={linkLoading}
                className="w-full rounded-[var(--radius-sm)] border border-accent bg-accent px-3 py-2 text-[length:var(--text-sm)] font-medium text-accent-ink disabled:opacity-60"
              >
                {linkLoading ? "در حال شناسایی لینک…" : <><Icon name="link" size="sm" /> نمایش این لینک روی نقشه</>}
              </button>
              {linkError && <p className="mt-2 px-1 text-[length:var(--text-xs)] text-crit">{linkError}</p>}
              <p className="mt-2 px-1 text-[length:var(--text-xs)] leading-5 text-text-faint">
                لینک گوگل‌مپس به‌صورت کامل پشتیبانی می‌شود؛ نشان و بلد به‌صورت حدسی بررسی می‌شوند.
              </p>
            </div>
          ) : coordMatch ? (
            <div className="p-2">
              <button
                onClick={goToCoords}
                className="w-full rounded-[var(--radius-sm)] border border-accent bg-accent px-3 py-2 text-[length:var(--text-sm)] font-medium text-accent-ink"
              >
                <Icon name="map-pin" size="sm" /> نمایش این مختصات روی نقشه ({coordMatch[1]}, {coordMatch[2]})
              </button>
            </div>
          ) : geoResults !== null ? (
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
                {geoLoading ? (
                  "در حال جستجو…"
                ) : (
                  <>
                    <Icon name="search" size="sm" /> جستجوی «{trimmed}» به‌عنوان آدرس
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      )}
      </>
      )}
    </div>
  );
}
