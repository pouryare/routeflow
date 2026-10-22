"use client";

import FilterChips from "@/components/mobile/FilterChips";
import { friendlyError } from "@/lib/userMessage";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CustomerRow, DistrictFeature } from "@/lib/types";
import { matchesQuery } from "@/lib/persian";
import SearchRecent from "@/components/searchbox/SearchRecent";
import SearchFavorites from "@/components/searchbox/SearchFavorites";
import SearchResultsBody from "@/components/searchbox/SearchResultsBody";
import { Icon } from "@/components/meridian/Icon";

import { COORD_RE, Favorite, GeoResult, SORT_OPTIONS, URL_RE, addFavorite, clearAllRecent, detectInputType, getGeoProvider, isFavorite, loadFavorites, loadRecent, pushRecent, removeFavorite, removeRecent } from "@/components/searchbox/searchBoxStore";

export type Result =
  | { kind: "customer"; customer: CustomerRow }
  | { kind: "district"; district: DistrictFeature };

export { SORT_OPTIONS, detectInputType, loadRecent, pushRecent, removeRecent, clearAllRecent, loadFavorites, addFavorite, removeFavorite, isFavorite };

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

  /** Geocode `query` and show the top few results. `stale` lets a caller that has since moved
   *  on (the user kept typing) discard the answer: responses do not arrive in the order the
   *  requests left, so without it a slow reply for "ته" could overwrite the results for
   *  "تهران". */
  const geosearch = useCallback(async (query: string, stale: () => boolean) => {
    setGeoLoading(true);
    try {
      const provider = await getGeoProvider();
      const res = await provider.search({ query });
      if (!stale()) setGeoResults(res.slice(0, 5));
    } catch {
      if (!stale()) setGeoResults([]);
    } finally {
      if (!stale()) setGeoLoading(false);
    }
  }, []);

  // For address input, skip local search and go straight to geo on every keystroke.
  useEffect(() => {
    if (inputType !== "address" || trimmed.length < 2) return;
    let cancelled = false;
    void Promise.resolve().then(() => geosearch(trimmed, () => cancelled));
    return () => {
      cancelled = true;
    };
  }, [trimmed, inputType, geosearch]);

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
        setLinkError(friendlyError(data.error, "لینک شناسایی نشد؛ لینک گوگل‌مپ، نشان، بلد یا ویز را بچسبانید"));
        return;
      }
      onLocationFound?.(data.lat, data.lng, "لینک نقشه");
      if (trimmed) pushRecent(trimmed);
      reset();
    } catch {
      setLinkError("اتصال برقرار نشد. اینترنت را بررسی کنید و دوباره تلاش کنید.");
    } finally {
      setLinkLoading(false);
    }
  }

  function runGeosearch() {
    return geosearch(trimmed, () => false);
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
          className="inline-flex items-center justify-center gap-[var(--space-2)] mapbtn"
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
        placeholder="جستجوی مشتری، منطقه، آدرس یا لینک نقشه…" aria-label="جستجوی مشتری، منطقه، آدرس یا لینک نقشه"
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
          className="inline-flex items-center justify-center gap-[var(--space-2)] absolute inset-y-0 right-2 flex items-center text-text-faint transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:text-text"
        >
          <Icon name="search" size="sm" />
        </button>
      )}
      </div>

      {open && (
        <div className="mapsearch__panel">
          <div className="mapsearch__filter-strip border-b border-border p-2 flex flex-wrap gap-1.5 items-center">
              {/* Chips, not dropdowns: a dropdown over a map search panel is a full-screen wheel on a phone. */}
              <FilterChips
                groups={[
                  {
                    id: "sort",
                    label: "ترتیب",
                    mode: "single",
                    neutral: "nearest",
                    value: sortMode ?? "nearest",
                    onChange: (v) => { if (!sortDisabled) onSortModeChange?.(v as string); },
                    options: visibleSortOptions.map((o) => ({ id: o.value, label: o.label })),
                  },
                  {
                    id: "list",
                    label: "فهرست مسیر",
                    mode: "single",
                    neutral: "",
                    value: activeListId === null || activeListId === undefined ? "" : String(activeListId),
                    sheet: true,
                    onChange: (v) => onListChange?.(v ? Number(v) : null),
                    options: (lists ?? []).map((l) => ({ id: String(l.id), label: l.name })),
                  },
                ]}
              />
              {sortAnchor ? (
                <span className="flex items-center gap-1 rounded-[var(--radius-sm)] border border-accent bg-accent/10 px-2 py-1 text-[length:var(--text-xs)] text-accent">
                  <Icon name="map-pin" size="sm" /> شما
                  <button
                    type="button"
                    onClick={onPositionClear}
                    aria-label="پاک کردن موقعیت"
                    title="پاک کردن موقعیت"
                    className="inline-flex items-center justify-center gap-[var(--space-2)] inline-flex items-center text-accent/60 hover:text-accent"
                  >
                    <Icon name="x" size="sm" />
                  </button>
                </span>
              ) : (
                <button type="button" onClick={() => onSetPosition?.()} className="rounded-[var(--radius-sm)] px-2 py-1 text-[length:var(--text-xs)] border border-border text-text-muted hover:border-accent hover:text-accent">
                  <Icon name="map-pin" size="sm" /> تعیین موقعیت
                </button>
              )}
              {!sortAnchor && (
                <button onClick={useMyLocation} className="inline-flex items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-sm)] border border-border px-2 py-1 text-[length:var(--text-xs)] text-text-muted hover:border-accent hover:text-accent transition-colors" title="Show my location">
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
          {!trimmed && <SearchRecent recentSearches={recentSearches} setRecentSearches={setRecentSearches} changeQuery={changeQuery} setOpen={setOpen} />}

          {/* Favorites — shown when input is empty */}
          {!trimmed && <SearchFavorites favorites={favorites} setFavorites={setFavorites} changeQuery={changeQuery} setOpen={setOpen} />}

          {trimmed && !hideResults && <SearchResultsBody trimmed={trimmed} isUrl={isUrl} decodeLink={decodeLink} linkLoading={linkLoading} linkError={linkError} inputType={inputType} coordMatch={coordMatch} goToCoords={goToCoords} geoResults={geoResults} selectGeoResult={selectGeoResult} results={results} select={select} toggleFavorite={toggleFavorite} runGeosearch={runGeosearch} geoLoading={geoLoading} />}

        </div>
      )}
      </>
      )}
    </div>
  );
}
