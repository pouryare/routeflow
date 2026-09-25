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

export const SORT_OPTIONS = [
  { value: "nearest", label: "نزدیک‌ترین" },
  { value: "score", label: "بهترین امتیاز" },
  { value: "name", label: "نام" },
  { value: "newest", label: "تازه‌ترین" },
  { value: "status", label: "وضعیت" },
  { value: "route", label: "ترتیب مسیر" },
  { value: "priority", label: "اولویت" },
] as const;

export function detectInputType(q: string): "coord" | "address" | "name" {
  const t = q.trim();
  if (COORD_RE.test(t)) return "coord";
  if (t.length >= 2 && /^[آا-یآ\s\-,./]+$/i.test(t) && /\s/.test(t)) return "address";
  return "name";
}

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

// ---- recent searches (localStorage) ----
const RECENT_KEY = "searchbox_recent";
const MAX_RECENT = 10;

function loadRecent(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); } catch { return []; }
}

function saveRecent(queries: string[]) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(queries)); } catch { /* storage full */ }
}

function pushRecent(query: string) {
  const q = query.trim();
  if (!q) return;
  const existing = loadRecent().filter((r) => r !== q);
  existing.unshift(q);
  saveRecent(existing.slice(0, MAX_RECENT));
}

function removeRecent(query: string) {
  saveRecent(loadRecent().filter((r) => r !== query));
}

function clearAllRecent() {
  localStorage.removeItem(RECENT_KEY);
}

// ---- favorites (localStorage) ----
interface Favorite {
  id: string;
  label: string;
  lat: number;
  lng: number;
  kind: "customer" | "district" | "geo";
}

const FAV_KEY = "searchbox_favorites";

function loadFavorites(): Favorite[] {
  try { return JSON.parse(localStorage.getItem(FAV_KEY) || "[]"); } catch { return []; }
}

function saveFavorites(favs: Favorite[]) {
  try { localStorage.setItem(FAV_KEY, JSON.stringify(favs)); } catch { /* storage full */ }
}

function addFavorite(fav: Favorite) {
  const favs = loadFavorites().filter((f) => f.id !== fav.id);
  favs.unshift(fav);
  saveFavorites(favs);
}

function removeFavorite(id: string) {
  saveFavorites(loadFavorites().filter((f) => f.id !== id));
}

function isFavorite(id: string): boolean {
  return loadFavorites().some((f) => f.id === id);
}

export { loadRecent, pushRecent, removeRecent, clearAllRecent, loadFavorites, addFavorite, removeFavorite, isFavorite };

export default function SearchBox({
  customers,
  districts,
  onSelectCustomer,
  onSelectDistrict,
  onLocationFound,
  inputRef,
  onExpandedChange,
  value: externalValue,
  onChange: onExternalChange,
  sortMode,
  onSortModeChange,
  activeListId,
  onListChange,
  lists,
  sortAnchor,
  onPositionClear,
  onSetPosition,
  onSelectAll,
  inBatchView,
  activeView,
  hideResults,
  defaultExpanded,
  inline,
}: {
  customers?: CustomerRow[];
  districts?: DistrictFeature[];
  onSelectCustomer?: (c: CustomerRow) => void;
  onSelectDistrict?: (d: DistrictFeature) => void;
  onLocationFound?: (lat: number, lng: number, label: string) => void;
  /** Handed in so the map's "/" shortcut can put the cursor here. Owned by the caller
   *  because the caller is what knows about keyboard shortcuts; this component only has
   *  to agree to be focused. */
  inputRef?: React.RefObject<HTMLInputElement | null>;
  /** Fires when the phone-sized box opens or closes.
   *
   *  Expanded, it takes the whole top row -- the row the sidebar button also sits in. The
   *  parent hides the sidebar button for the duration so the box gets the full width.
   *  Collapsed, the sidebar button is visible again. */
  onExpandedChange?: (open: boolean) => void;
  /** Controlled value — when supplied the input reflects this instead of internal state. */
  value?: string;
  /** Called with the new value on every keystroke. */
  onChange?: (val: string) => void;
  sortMode?: string;
  onSortModeChange?: (mode: string) => void;
  activeListId?: number | null;
  onListChange?: (id: number | null) => void;
  lists?: Array<{ id: number; name: string }>;
  sortAnchor?: { lat: number; lng: number } | null;
  onPositionClear?: () => void;
  onSetPosition?: () => void;
  onSelectAll?: () => void;
  inBatchView?: boolean;
  activeView?: string;
  /** Hide the search-results section — for pages where results render elsewhere (e.g. leads). */
  hideResults?: boolean;
  /** Force the box open on mount — for pages where the search box must always be visible. */
  defaultExpanded?: boolean;
  /** Render in document flow instead of absolute overlay — for non-map pages like /leads. */
  inline?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [linkLoading, setLinkLoading] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [geoResults, setGeoResults] = useState<GeoResult[] | null>(null);
  const [geoLoading, setGeoLoading] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>(loadRecent);
  const [favorites, setFavorites] = useState<Favorite[]>(loadFavorites);
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
  const [expanded, setExpanded] = useState(defaultExpanded ?? false);

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
  const inputType = detectInputType(trimmed);

  const results = useMemo<Result[]>(() => {
    if (!trimmed || isUrl || inputType === "coord") return [];
    if (inputType === "address") return [];
    // Matched under normalisation rather than by raw substring. Imported names very
    // often carry the Arabic ي and ك where a phone keyboard produces the Persian ی and
    // ک -- different codepoints, near-identical glyphs -- so a raw match made those
    // customers unfindable by typing their own name.
    const customerResults: Result[] = (customers ?? [])
      .filter(
        (c) =>
          matchesQuery(c.business_name, trimmed) ||
          matchesQuery(c.customer_code, trimmed) ||
          matchesQuery(c.phone ?? "", trimmed)
      )
      .slice(0, 6)
      .map((customer) => ({ kind: "customer", customer }));
    const districtResults: Result[] = (districts ?? [])
      .filter((d) => matchesQuery(d.properties.name, trimmed))
      .slice(0, 6)
      .map((district) => ({ kind: "district", district }));
    return [...customerResults, ...districtResults].slice(0, 8);
  }, [trimmed, customers, districts, isUrl, inputType]);

  // For address input, skip local search and go straight to geo on every keystroke.
  useEffect(() => {
    if (inputType !== "address" || trimmed.length < 2) return;
    runGeosearch();
  }, [trimmed, inputType]);

  const visibleSortOptions = useMemo(() => {
    if (activeView === "kanban") return SORT_OPTIONS.filter((o) => o.value !== "status");
    if (activeView === "score") return SORT_OPTIONS.filter((o) => o.value === "score");
    return SORT_OPTIONS;
  }, [activeView]);

  const sortDisabled = visibleSortOptions.length <= 1;



  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function select(r: Result) {
    if (r.kind === "customer") onSelectCustomer?.(r.customer);
    else onSelectDistrict?.(r.district);
    if (trimmed) pushRecent(trimmed);
    reset();
  }

  function reset() {
    changeQuery("");
    setOpen(false);
  }

  function goToCoords() {
    if (!coordMatch) return;
    onLocationFound?.(Number(coordMatch[1]), Number(coordMatch[2]), "مختصات وارد شده");
    if (trimmed) pushRecent(trimmed);
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
      onLocationFound?.(data.lat, data.lng, "لینک نقشه");
      if (trimmed) pushRecent(trimmed);
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
    onLocationFound?.(r.y, r.x, r.label);
    if (trimmed) pushRecent(trimmed);
    reset();
  }

  function toggleFavorite(r: Result) {
    // Only customer and district reach here. This used to carry a `geo_${r.label}` fallback,
    // but geosearch results render in their own list further down and have no favourite
    // button, so that arm was unreachable -- and unreachable code that looks reachable is how
    // a union quietly grows a member nobody renders.
    const id = r.kind === "customer" ? `cust_${r.customer.customer_code}` : `dist_${r.district.properties.name}`;
    if (isFavorite(id)) {
      removeFavorite(id);
    } else {
      addFavorite({ id, label: r.kind === "customer" ? r.customer.business_name : r.district.properties.name, lat: 0, lng: 0, kind: r.kind });
    }
    setFavorites(loadFavorites());
  }

  function useMyLocation() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (trimmed) pushRecent(trimmed);
        onLocationFound?.(pos.coords.latitude, pos.coords.longitude, "موقعیت من");
        reset();
      },
      () => { /* silent fallback — drivers shouldn't be blocked */ }
    );
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    if (isUrl) decodeLink();
    else if (inputType === "coord" && coordMatch) goToCoords();
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
      // Inline: document flow, centered in the page container — for non-map pages like /leads.
      className={
        inline
          ? "relative mx-auto w-72 max-w-full"
          : collapsed
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
        value={externalValue ?? query}
        onChange={(e) => {
          const val = e.target.value;
          onExternalChange?.(val);
          changeQuery(val);
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
          className="absolute inset-y-0 right-2 flex items-center text-text-faint transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:text-text"
        >
          <Icon name="search" size="sm" />
        </button>
      )}
      </div>

      {open && (
        <div className="mapsearch__panel">
          <div className="mapsearch__filter-strip border-b border-border p-2 flex flex-wrap gap-1.5 items-center">
              <select value={sortMode ?? "nearest"} onChange={(e) => onSortModeChange?.(e.target.value)} disabled={sortDisabled} className="rounded-[var(--radius-sm)] px-2 py-1 text-[length:var(--text-xs)] border border-border bg-surface text-text-muted disabled:opacity-40">
                {visibleSortOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <select value={activeListId ?? ""} onChange={(e) => onListChange?.(e.target.value ? Number(e.target.value) : null)} className="flex-1 min-w-0 rounded border border-border bg-surface px-2 py-1 text-[length:var(--text-xs)]">
                <option value="">مسیر آزاد</option>
                {(lists ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
              {sortAnchor ? (
                <span className="flex items-center gap-1 rounded-[var(--radius-sm)] border border-accent bg-accent/10 px-2 py-1 text-[length:var(--text-xs)] text-accent">
                  <Icon name="map-pin" size="sm" /> شما
                  <button type="button" onClick={onPositionClear} className="text-accent/60 hover:text-accent">↵</button>
                </span>
              ) : (
                <button type="button" onClick={() => onSetPosition?.()} className="rounded-[var(--radius-sm)] px-2 py-1 text-[length:var(--text-xs)] border border-border text-text-muted hover:border-accent hover:text-accent">
                  <Icon name="map-pin" size="sm" /> تعیین موقعیت
                </button>
              )}
              {!sortAnchor && (
                <button onClick={useMyLocation} className="rounded-[var(--radius-sm)] border border-border px-2 py-1 text-[length:var(--text-xs)] text-text-muted hover:border-accent hover:text-accent transition-colors" title="Show my location">
                  <Icon name="map-pin" size="sm" /> خودم
                </button>
              )}
              {!inBatchView && (
                <button type="button" onClick={() => onSelectAll?.()} className="rounded-[var(--radius-sm)] px-2 py-1 text-[length:var(--text-xs)] border border-accent text-accent hover:bg-accent hover:text-accent-ink">
                  <Icon name="check" size="sm" /> همه
                </button>
              )}
            </div>
          {/* Recent searches — shown when input is empty */}
          {!trimmed && recentSearches.length > 0 && (
            <div className="border-b border-border px-3 py-2">
              <div className="flex items-center justify-between mb-1.5">
                <span className="flex items-center gap-1 text-[length:var(--text-xs)] text-text-faint font-medium"><Icon name="clock" size="sm" /> Recent</span>
                <button onClick={() => { clearAllRecent(); setRecentSearches([]); }} className="text-[length:var(--text-xs)] text-accent hover:underline">Clear all</button>
              </div>
              {recentSearches.map((r, i) => (
                <button key={i} onClick={() => { changeQuery(r); setOpen(true); }} className="mapsearch__opt">
                  <Icon name="clock" size="sm" />
                  <span className="mapsearch__label">{r}</span>
                  <button onClick={(e) => { e.stopPropagation(); removeRecent(r); setRecentSearches(loadRecent()); }} className="text-text-faint hover:text-crit text-[length:var(--text-xs)]" aria-label="remove recent"><Icon name="x" size="sm" /></button>
                </button>
              ))}
            </div>
          )}
          {/* Favorites — shown when input is empty */}
          {!trimmed && favorites.length > 0 && (
            <div className="border-b border-border px-3 py-2">
              <div className="flex items-center justify-between mb-1.5">
                <span className="flex items-center gap-1 text-[length:var(--text-xs)] text-text-faint font-medium"><Icon name="star" size="sm" /> Favorites</span>
                <button onClick={() => { localStorage.removeItem(FAV_KEY); setFavorites([]); }} className="text-[length:var(--text-xs)] text-accent hover:underline">Clear all</button>
              </div>
              {favorites.map((f) => (
                <button key={f.id} onClick={() => { changeQuery(f.label); setOpen(true); }} className="mapsearch__opt">
                  <Icon name="star" size="sm" />
                  <span className="mapsearch__label">{f.label}</span>
                  <button onClick={(e) => { e.stopPropagation(); removeFavorite(f.id); setFavorites(loadFavorites()); }} className="text-text-faint hover:text-crit text-[length:var(--text-xs)]" aria-label="remove favorite"><Icon name="x" size="sm" /></button>
                </button>
              ))}
            </div>
          )}
          {trimmed && !hideResults && (
          isUrl ? (
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
          ) : inputType === "coord" && coordMatch ? (
            <div className="p-2">
              <button
                onClick={goToCoords}
                className="w-full rounded-[var(--radius-sm)] border border-accent bg-accent px-3 py-2 text-[length:var(--text-sm)] font-medium text-accent-ink"
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
          )
          )}
        </div>
      )}
      </>
      )}
    </div>
  );
}
