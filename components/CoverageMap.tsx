"use client";

import { FieldInput } from "@/components/FieldInput";
import SmartPicker from "@/components/mobile/SmartPicker";
import { tehranTodayIso } from "@/lib/jalali";
import { useRunAfterMount } from "@/lib/useRunAfterMount";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useHydrated } from "@/lib/useHydrated";
import { useAccent } from "@/components/AccentPicker";
import { useTheme } from "@/components/ThemeToggle";
import dynamic from "next/dynamic";
import { Layer, Marker, Source, type MapRef } from "@vis.gl/react-maplibre";
import AppMap from "@/components/map/AppMap";
import { BASEMAP_LABELS } from "@/lib/mapStyle";
import CustomerLayer, { CLUSTER_LAYER, CUSTOMER_LAYER } from "@/components/coverage/CustomerLayer";
import DistrictLayer, { type DistrictPaint } from "@/components/coverage/DistrictLayer";
import { DistrictCollection, DistrictFeature, DistrictGeometryMap, DistrictProperties, DistrictPropertiesResponse, CustomerRow, CoverageStatus, STATUS_COLOR, STATUS_LABEL, CustomerColorMode, customerLifecycleColor, debtColor, salespersonColor, inactivityColor, daysSinceLastPurchase, distanceColor, isCustomerColorMode, shapeForColor, type DistrictColorMode, districtGroupColor, isDistrictColorMode } from "@/lib/types";
import {
  PrecisionMode,
  PrecisionTier,
  geometryUrl,
  isPrecisionMode,
  resolveTier,
} from "@/lib/precision";
import type { Role } from "@/lib/db";
import CollapsibleSection, { SectionFilterContext } from "./CollapsibleSection";
import CustomerFilters from "./CustomerFilters";
import SearchBox from "./SearchBox";
import LocateControl from "./LocateControl";
import MyLocationMarker from "./MyLocationMarker";
import { useMyPosition } from "./MyPositionProvider";
import GeofenceWatcher from "./GeofenceWatcher";
import { useNavApp } from "./NavAppSetting";
import { useToast } from "./ToastProvider";
import { distanceKm } from "@/lib/geo";
import DueRemindersSection, { type DueReminder } from "@/components/coverage/DueRemindersSection";
import NearbyCustomersSection from "@/components/coverage/NearbyCustomersSection";
import PinnedCustomersSection from "@/components/coverage/PinnedCustomersSection";
import RecentCustomersSection from "@/components/coverage/RecentCustomersSection";
import FacilityMarkers from "@/components/coverage/FacilityMarkers";
import LeadMarkers from "@/components/coverage/LeadMarkers";
import FoundLocationMarker from "@/components/coverage/FoundLocationMarker";
import { useMapShortcuts } from "@/components/coverage/useMapShortcuts";
import CustomerColourSection from "@/components/coverage/CustomerColourSection";
import CorridorBandLayer from "@/components/coverage/CorridorBandLayer";
import MapSitesSection, { CORRIDOR_WIDTHS } from "@/components/coverage/MapSitesSection";
import MapLegendSection from "@/components/coverage/MapLegendSection";
import MapSettingsSection from "@/components/coverage/MapSettingsSection";
import { useCorridor } from "@/components/coverage/useCorridor";
import {
  BASEMAP_KEY,
  BASEMAPS_KEY,
  DEFAULT_BASEMAPS,
  parseBasemaps,
  type BasemapBySkin,
  LAYERS_KEY,
  basemapDef,
  changedFromDefault,
  parseLayerPrefs,
  type BasemapId,
  type LayerPrefs,
  type OverlayId,
} from "@/lib/mapLayers";
import LayersPanel, { LayerHint, LayersControl } from "./LayersPanel";
import TrafficZoneLayer, { useTrafficZones } from "./TrafficZoneLayer";
import { isPlaced, pickOrigin, FacilityRow } from "@/lib/facilityTypes";
import { useSwipeDismiss } from "./useSwipeDismiss";
import DataFreshness from "./DataFreshness";
import EmptyState from "./EmptyState";
import { newestSync } from "@/lib/freshness";
import { faNum } from "@/lib/format";
import { MapView, buildMapLink, absoluteMapLink, parseMapLink, replaceUrlQuery } from "@/lib/deepLink";
import { copyText } from "@/lib/clipboard";
import { PINNED_KEY, RECENT_KEY, addRecent, pruneIds, readIds, toggleId, writeIds } from "@/lib/customerLists";
import { Button } from "@heroui/react";
import { Icon } from "@/components/meridian/Icon";
import MapWorklist from "./MapWorklist";
import { buildWorklist, type Bounds } from "@/lib/mapWorklist";
import { MAP_FOCUS_EVENT } from "@/lib/searchModel";
import { } from "@/components/meridian/icon-map";

// Everything below is reachable only after an interaction -- opening a customer, opening
// a district, expanding the import panel, switching the heatmap on -- or carries a
// library the first paint doesn't need.
// Splitting them out keeps that weight off the chunk that has to arrive before the map
// can draw anything. CoverageMap is itself ssr:false, so none of these need an SSR pass.
import { readStoredView, linkTargetView, writeStoredView } from "@/components/coverage/mapViewStore";
import { MAP_INK_FALLBACK, MapInk, readMapInk } from "@/components/coverage/mapInk";
import { MapWatcher, FitToCustomers } from "@/components/coverage/mapParts";
import CheckField from "@/components/CheckField";

const HeatmapLayer = dynamic(() => import("./HeatmapLayer"), { ssr: false });
const FullscreenControl = dynamic(() => import("./FullscreenControl"), { ssr: false });
const CustomerDetailPanel = dynamic(() => import("./CustomerDetailPanel"), { ssr: false });
const DistrictEditor = dynamic(() => import("./DistrictEditor"), { ssr: false });
const NextStopBar = dynamic(() => import("./NextStopBar"), { ssr: false });
const ShortcutHelp = dynamic(() => import("./ShortcutHelp"), { ssr: false });

const TEHRAN_CENTER: [number, number] = [35.7, 51.55];

/** The groups this viewer may see -- for the territory colour mode and the bulk assign
 *  control. An owner gets every group; a manager gets only their own, which is the only
 *  one any district they can see belongs to. */
export interface MapGroup {
  id: number;
  name: string;
  color: string | null;
}

export default function CoverageMap({
  initialDistricts,
  initialCustomers,
  initialFacilities,
  initialLeads = [],
  groups,
  role,
  geometryVersion,
}: {
  initialDistricts: DistrictProperties[];
  initialCustomers: CustomerRow[];
  initialFacilities: FacilityRow[];
  initialLeads: Array<{ id: number; name: string; lat: number; lng: number }>;
  groups: MapGroup[];
  role: Role;
  geometryVersion: string;
}) {
  // --- Deep links -------------------------------------------------------------------
  // Read once, on the first render, before the map exists: the opening view is a
  // MapContainer prop, and by the time an effect could run the map has already drawn
  // Tehran and would have to fly away from it.
  //
  // Precedence is URL, then this browser's last position, then fit-to-customers. A link
  // someone sent is the most specific statement of intent available; the remembered view
  // is the next; fitting is what is left when nobody has said anything.
  const [incoming] = useState(() => (typeof window === "undefined" ? {} : parseMapLink(window.location.search)));
  const [startView] = useState<MapView | null>(
    () => incoming.view ?? linkTargetView(incoming, initialCustomers, initialDistricts) ?? readStoredView()
  );
  const viewRef = useRef<MapView | null>(startView);

  const [facilityGeofenceOn, setFacilityGeofenceOn] = useState(false);
  const [corridorWidthKm, setCorridorWidthKm] = useState(5);
  const [layers, setLayers] = useState<LayerPrefs>(() => parseLayerPrefs(null));
  const [layersOpen, setLayersOpen] = useState(false);
  const heatmapOn = layers.heatmap;
  const corridorOn = layers.corridor;
  const [districtProps, setDistrictProps] = useState<DistrictProperties[]>(initialDistricts);
  const [geomVersion, setGeomVersion] = useState(geometryVersion);
  const [geometry, setGeometry] = useState<DistrictGeometryMap | null>(null);
  const [precisionMode, setPrecisionMode] = useState<PrecisionMode>("auto");
  const [zoom, setZoom] = useState(11);
  const [customers, setCustomers] = useState<CustomerRow[]>(initialCustomers);
  const [selectedDistrict, setSelectedDistrict] = useState<DistrictFeature | null>(null);
  // A ?c= link opens with that customer already selected. No effect and no flyTo: the
  // customer's own coordinates are what startView above was computed from, so the map
  // simply opens there.
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerRow | null>(
    () => (incoming.customerId === undefined ? null : initialCustomers.find((c) => c.id === incoming.customerId) ?? null)
  );
  const [colorMode, setColorMode] = useState<CustomerColorMode>(() =>
    isCustomerColorMode(incoming.colorMode) ? incoming.colorMode : "status"
  );
  // What the district fill means. Separate from the customer colour mode above: they
  // colour different things and are read independently.
  const [districtColorMode, setDistrictColorMode] = useState<DistrictColorMode>(() =>
    isDistrictColorMode(incoming.districtColorMode) ? incoming.districtColorMode : "status"
  );
  const [salespersonFilter, setSalespersonFilter] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cityBoundary, setCityBoundary] = useState<GeoJSON.Feature | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [dueReminders, setDueReminders] = useState<DueReminder[]>([]);
  /* What is on screen, for the worklist. Null until the map has reported once. */
  const [viewBounds, setViewBounds] = useState<Bounds | null>(null);
  const [heatmapByDebt, setHeatmapByDebt] = useState(false);
  /* One basemap per skin (lib/mapLayers.ts, BasemapBySkin): the map follows the
     light/dark switch like every other surface. */
  const [skin] = useTheme();
  const [basemaps, setBasemaps] = useState<BasemapBySkin>(DEFAULT_BASEMAPS);
  const basemap = basemaps[skin];
  const [nearbyRadiusKm, setNearbyRadiusKm] = useState(2);
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkSelectedIds, setBulkSelectedIds] = useState<Set<number>>(new Set());
  const [bulkStatusChoice, setBulkStatusChoice] = useState<CoverageStatus | "">("");
  // "" = leave alone, "__ungroup__" = clear it, otherwise a group id. Owner only.
  const [bulkGroupChoice, setBulkGroupChoice] = useState("");
  const [bulkSaving, setBulkSaving] = useState(false);
  const [foundLocation, setFoundLocation] = useState<{ lat: number; lng: number; label: string } | null>(null);
  const [geofenceOn, setGeofenceOn] = useState(false);
  const [nextStopOn, setNextStopOn] = useState(true);
  const [sectionFilter, setSectionFilter] = useState("");
  const [shapedMarkers, setShapedMarkers] = useState(false);
  const [driverMode, setDriverMode] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [searchExpanded, setSearchExpanded] = useState(false);
  // Per-browser working sets. Empty on the server; filled from storage on mount, like
  // every other preference on this page.
  const [pinnedIds, setPinnedIds] = useState<number[]>([]);
  const [recentIds, setRecentIds] = useState<number[]>([]);
  const mapRef = useRef<MapRef | null>(null);
  const asideRef = useRef<HTMLElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const sectionFilterRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const [navAppId] = useNavApp();

  // One shared watch, mounted at the root. Previously this component held its own
  // position state, fed only when the geofence toggle happened to be on -- so the
  // "nearby customers" list and the next-stop distance were silently unavailable for
  // anyone who had not turned that on.
  const { position: myPositionFix, status: positionStatus, error: positionError, retry: retryPosition } = useMyPosition();
  const myPosition = useMemo(
    () => (myPositionFix ? { lat: myPositionFix.lat, lng: myPositionFix.lng } : null),
    [myPositionFix]
  );

  const closeSidebar = useCallback(() => setSidebarOpen(false), []);
  useSwipeDismiss(asideRef, "right", closeSidebar, sidebarOpen);

  useMapShortcuts({
    searchInputRef, sectionFilterRef, mapRef, myPosition, retryPosition, toast,
    showShortcuts, setShowShortcuts, selectedCustomer, setSelectedCustomer, sidebarOpen, setSidebarOpen,
  });

  const loadDistricts = useCallback(async () => {
    const res = await fetch("/api/districts");
    const data: DistrictPropertiesResponse = await res.json();
    setDistrictProps(data.districts ?? []);
    setGeomVersion(data.version);
  }, []);

  const loadCustomers = useCallback(async () => {
    const res = await fetch("/api/customers");
    const data = await res.json();
    setCustomers(data.customers ?? []);
  }, []);

  useEffect(() => {
    // Static reference boundary, not a district row -- purely a visual anchor, never editable.
    fetch("/tehran-city-boundary.geojson")
      .then((r) => r.json())
      .then(setCityBoundary)
      .catch(() => {});
  }, []);

  /* Every remembered toggle is adopted once, on the first render after hydration (the
     block below the reminders): localStorage does not exist on the server, and reading
     it on the hydrating render would disagree with the server's HTML. Writers that run
     as effects wait for `restored`, or the first commit would save the defaults over
     what was remembered before anyone read it. */
  const hydrated = useHydrated();
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    if (restored) localStorage.setItem("coverage_precision", precisionMode);
  }, [precisionMode, restored]);

  const activeTier: PrecisionTier = resolveTier(precisionMode, zoom);

  // Polygon geometry, fetched separately from the properties above and keyed by
  // (version, tier). Both tiers of a given version are immutable, so a tier already
  // pulled once is reused for the rest of the session and served from the browser's
  // disk cache on the next visit -- switching precision back and forth is free after
  // the first look at each.
  const geometryCacheRef = useRef(new Map<string, DistrictGeometryMap>());
  useEffect(() => {
    const key = `${geomVersion}:${activeTier}`;
    const cached = geometryCacheRef.current.get(key);
    if (cached) {
      setGeometry(cached);
      return;
    }

    let cancelled = false;
    setLoading(true);
    // credentials: "include" pairs with the crossOrigin="use-credentials" preload the
    // server-rendered page emits for the low tier; mismatched modes mean the preload is
    // discarded and the payload is fetched a second time.
    fetch(geometryUrl(geomVersion, activeTier), { credentials: "include" })
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json() as Promise<DistrictGeometryMap>;
      })
      .then((data) => {
        geometryCacheRef.current.set(key, data);
        if (cancelled) return;
        setGeometry(data);
        setError(null);
      })
      .catch(() => {
        if (!cancelled) setError("مرز منطقه‌ها بارگذاری نشد؛ دوباره تلاش کنید");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [geomVersion, activeTier]);

  // Properties and geometry are stitched back into the FeatureCollection the rest of the
  // component (and DistrictEditor, SearchBox, flyToDistrict) already expects. A district
  // whose geometry is missing -- a row inserted since this tier was built -- is dropped
  // rather than rendered as a shapeless feature; the next version bump picks it up.
  const districts: DistrictCollection | null = useMemo(() => {
    if (!geometry) return null;
    const features: DistrictFeature[] = [];
    for (const properties of districtProps) {
      const shape = geometry[String(properties.id)];
      if (shape) features.push({ type: "Feature", id: properties.id, geometry: shape, properties });
    }
    return { type: "FeatureCollection", features };
  }, [districtProps, geometry]);

  // Keeps customer data live without a manual reload: any update made elsewhere -- a
  // coworker editing from a different session, or this same tab left open from an
  // earlier visit. /api/customers is always-revalidate
  // (lib/httpCache.ts), so a poll that finds nothing new costs one cheap 304 -- no row
  // fetch even runs server-side -- and only actually re-renders when something changed.
  useEffect(() => {
    const interval = setInterval(loadCustomers, 45000);
    function onVisible() {
      if (document.visibilityState === "visible") loadCustomers();
    }
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", loadCustomers);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", loadCustomers);
    };
  }, [loadCustomers]);

  const loadReminders = useCallback(async () => {
    const res = await fetch("/api/reminders?due=today");
    const data = await res.json();
    setDueReminders(data.reminders ?? []);
  }, []);

  useRunAfterMount(loadReminders);

  if (hydrated && !restored) {
    setRestored(true);
    const storedPrecision = localStorage.getItem("coverage_precision");
    if (isPrecisionMode(storedPrecision)) setPrecisionMode(storedPrecision);
    setGeofenceOn(localStorage.getItem("coverage_geofence_on") === "1");
    setFacilityGeofenceOn(localStorage.getItem("coverage_geofence_sites") === "1");

    // The heatmap and the corridor each had their own key before every layer moved into
    // one panel. Carry those two forward the first time, so a map someone left with the
    // corridor on comes back with it on.
    const storedLayers = localStorage.getItem(LAYERS_KEY);
    const restored = parseLayerPrefs(storedLayers);
    if (!storedLayers) {
      restored.corridor = localStorage.getItem("coverage_corridor_on") === "1";
      restored.heatmap = localStorage.getItem("coverage_heatmap_on") === "1";
    }
    setLayers(restored);
    setBasemaps(parseBasemaps(localStorage.getItem(BASEMAPS_KEY), localStorage.getItem(BASEMAP_KEY)));
    // Defaults on -- it costs nothing on a day with no plan, since the bar renders
    // nothing at all then.
    setNextStopOn(localStorage.getItem("coverage_nextstop_off") !== "1");
    setShapedMarkers(localStorage.getItem("coverage_shaped_markers") === "1");
    setDriverMode(localStorage.getItem("coverage_driver_mode") === "1");
    setPinnedIds(readIds(PINNED_KEY));
    // A customer arrived at by link has been viewed as surely as one arrived at by
    // click. That path sets the selection in a lazy initialiser, before this list
    // exists, so it is recorded here instead.
    const storedRecent = readIds(RECENT_KEY);
    const linked = incoming.customerId !== undefined && initialCustomers.some((c) => c.id === incoming.customerId);
    // Saved by the effect below: rendering does not write to storage.
    setRecentIds(linked ? addRecent(storedRecent, incoming.customerId as number) : storedRecent);
    const storedWidth = Number(localStorage.getItem("coverage_corridor_km"));
    if (CORRIDOR_WIDTHS.includes(storedWidth)) setCorridorWidthKm(storedWidth);
  }
  // The restore above may add a linked customer to the recent list; this keeps storage in
  // step with it and with every later change.
  useEffect(() => {
    if (restored) writeIds(RECENT_KEY, recentIds);
  }, [recentIds, restored]);
  useEffect(() => {
    if (restored) localStorage.setItem("coverage_geofence_on", geofenceOn ? "1" : "0");
  }, [geofenceOn, restored]);

  /** One toggle for every layer, so nothing has to remember its own storage key. */
  const setLayer = useCallback((id: OverlayId, on: boolean) => {
    setLayers((prev) => {
      const next = { ...prev, [id]: on };
      localStorage.setItem(LAYERS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const chooseBasemap = useCallback(
    (id: BasemapId) => {
      setBasemaps((prev) => {
        const next = { ...prev, [skin]: id };
        localStorage.setItem(BASEMAPS_KEY, JSON.stringify(next));
        return next;
      });
    },
    [skin],
  );

  // The class goes on <html>, not on a wrapper here: it has to reach the Leaflet
  // popups, the toasts and the bottom bar, none of which render inside this tree.
  useEffect(() => {
    document.documentElement.classList.toggle("driver-mode", driverMode);
    return () => document.documentElement.classList.remove("driver-mode");
  }, [driverMode]);

  async function resolveReminder(id: number) {
    try {
      const res = await fetch(`/api/reminders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolved: true }),
      });
      if (!res.ok) throw new Error();
      toast("یادآوری انجام‌شده علامت خورد.", "success");
      loadReminders();
    } catch {
      toast("یادآوری ثبت نشد؛ دوباره تلاش کنید", "error");
    }
  }

  function openReminderEntity(r: DueReminder) {
    if (r.entity_type === "customer") {
      const c = customers.find((cu) => cu.id === r.entity_id);
      if (c) flyToCustomer(c);
    } else {
      const d = districts?.features.find((f) => f.properties.id === r.entity_id);
      if (d) flyToDistrict(d);
    }
  }

  // The district half waits for data: unlike a customer, a district is only a selectable
  // thing once its polygon geometry has been fetched, and that is async. The map is
  // already pointing at the right place by then (startView used the centroid) -- this
  // only opens the panel for it, on the first render that has the feature, and never
  // again once it has, so moving on to another district is not undone.
  const [districtLinkApplied, setDistrictLinkApplied] = useState(false);
  if (incoming.districtId !== undefined && !districtLinkApplied && districts) {
    const d = districts.features.find((f) => f.properties.id === incoming.districtId);
    if (d) {
      setDistrictLinkApplied(true);
      setSelectedDistrict(d);
    }
  }

  const filteredCustomers = useMemo(() => {
    return customers.filter((c) => {
      if (salespersonFilter.size > 0 && !salespersonFilter.has(c.salesperson ?? "")) return false;
      return true;
    });
  }, [customers, salespersonFilter]);

  const nearbyCustomers = useMemo(() => {
    if (!myPosition) return [];
    return customers
      .filter((c) => c.lat && c.lng)
      .map((c) => ({ customer: c, km: distanceKm(myPosition, { lat: c.lat as number, lng: c.lng as number }) }))
      .filter((x) => x.km <= nearbyRadiusKm)
      .sort((a, b) => a.km - b.km)
      .slice(0, 20);
  }, [customers, myPosition, nearbyRadiusKm]);

  const customerById = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);

  const pinnedCustomers = useMemo(
    () => pruneIds(pinnedIds, new Set(customerById.keys())).map((id) => customerById.get(id) as CustomerRow),
    [pinnedIds, customerById]
  );

  // A customer already pinned is not also "recent": it has a permanent home two
  // sections up, and listing it twice makes the panel longer without saying more.
  const recentCustomers = useMemo(
    () =>
      pruneIds(recentIds, new Set(customerById.keys()))
        .filter((id) => !pinnedIds.includes(id))
        .map((id) => customerById.get(id) as CustomerRow),
    [recentIds, pinnedIds, customerById]
  );

  const dormantCustomers = useMemo(() => {
    const now = new Date();
    return customers
      .filter((c) => c.lifecycle === "active")
      .map((c) => ({ customer: c, days: daysSinceLastPurchase(c, now) }))
      .filter((x): x is { customer: CustomerRow; days: number } => x.days !== null && x.days > 30)
      .sort((a, b) => b.days - a.days)
      .slice(0, 20);
  }, [customers]);

  const hasPurchaseHistory = useMemo(() => customers.some((c) => c.last_purchase_date), [customers]);

  const noCoordCustomers = useMemo(() => {
    return customers
      .filter((c) => c.lifecycle === "active" && (!c.lat || !c.lng))
      .slice(0, 30);
  }, [customers]);

  const salespeople = useMemo(() => {
    const s = new Set<string>();
    customers.forEach((c) => c.salesperson && s.add(c.salesperson));
    return Array.from(s).sort();
  }, [customers]);

  /** Palette slot per salesperson, assigned alphabetically.
   *
   *  salespersonColor hands out slots on first sight, mutating the map it is given. Fed
   *  from a ref during render, that made a person's colour depend on which markers
   *  happened to render first -- so it could differ between two loads of the same map.
   *  Deriving it from the sorted list instead makes it deterministic, and means nothing
   *  is mutated while rendering. */
  const salesIndex = useMemo(() => {
    const m = new Map<string, number>();
    salespeople.forEach((name, i) => m.set(name, i));
    return m;
  }, [salespeople]);

  const groupColors = useMemo(() => new Map(groups.map((g) => [g.id, g.color])), [groups]);

  const activeBasemap = basemapDef(basemap);
  /* Read out of the live stylesheet rather than held as constants -- see readMapInk. Keyed
     on the basemap's own ground, not the page skin: the strokes are drawn on the basemap,
     so a cream basemap needs dark strokes whatever the skin is.

     Re-read whenever the accent, the skin or the ground changes, because all three move
     these values and none of them is observable from inside a canvas paint. The restyle
     effect below lists `ink` as a dependency, which is what repaints the already-drawn
     district layers once a new one arrives. */
  const viewportRef = useRef<HTMLDivElement>(null);
  /* Item 26: the map fills what the shell leaves below it, and no more. At 100dvh it
     ran a full screen below the header and the page card, so the page scrolled and the
     map read as an embedded frame. Measured rather than guessed, because the header
     wraps to two rows below 1024px and the page card's height depends on its copy. */
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const fit = () => {
      const top = el.getBoundingClientRect().top + window.scrollY;
      /* On a phone the fixed bottom bar covers the last stretch of the viewport, so the map
         stops above it: measured, not guessed, because the bar grows by the home-indicator
         inset on some phones. Zero where the bar is not shown. */
      const bar = document.querySelector<HTMLElement>(".bottomnav");
      const barPx = bar && getComputedStyle(bar).display !== "none" ? bar.offsetHeight : 0;
      el.style.height = `${Math.max(360, Math.floor(window.innerHeight - top - 16 - barPx))}px`;
      mapRef.current?.resize();
    };
    fit();
    /* The bar streams in with the header, which may land after this effect; fit again once it has. */
    const raf = requestAnimationFrame(() => requestAnimationFrame(fit));
    document.fonts?.ready.then(fit).catch(() => {});
    window.addEventListener("resize", fit);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", fit);
    };
  }, []);
  const [accent] = useAccent();
  const [ink, setInk] = useState<MapInk>(() => MAP_INK_FALLBACK[activeBasemap.ground]);
  useEffect(() => {
    // A frame later than the attribute write, so getComputedStyle sees the new cascade
    // rather than the one being replaced.
    const id = requestAnimationFrame(() =>
      setInk(readMapInk(viewportRef.current, activeBasemap.ground)),
    );
    return () => cancelAnimationFrame(id);
  }, [accent, skin, activeBasemap.ground]);

  function toggleBulkSelect(id: number) {
    setBulkSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const pickDistrict = useCallback(
    (f: DistrictFeature) => {
      if (bulkMode) toggleBulkSelect(f.properties.id);
      else setSelectedDistrict(f);
    },
    [bulkMode],
  );
  const districtTooltip = useCallback((f: DistrictFeature) => {
    const label = f.properties.parent_name ? `${f.properties.name} (${f.properties.parent_name})` : f.properties.name;
    return `${label} — ${STATUS_LABEL[f.properties.coverage_status]}`;
  }, []);

  async function applyBulk() {
    if (bulkSelectedIds.size === 0 || (!bulkStatusChoice && !bulkGroupChoice)) return;
    setBulkSaving(true);
    const count = bulkSelectedIds.size;
    const body: {
      ids: number[];
      coverage_status?: CoverageStatus;
      group_id?: number | null;
    } = { ids: Array.from(bulkSelectedIds) };
    if (bulkStatusChoice) body.coverage_status = bulkStatusChoice;
    // The server rejects this from anyone but an owner, and recomputes which customers
    // belong to whom once the territory has moved.
    if (bulkGroupChoice) body.group_id = bulkGroupChoice === "__ungroup__" ? null : Number(bulkGroupChoice);
    try {
      const res = await fetch("/api/districts/bulk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error();
      // regrouped is how many customers changed hands with the territory -- the part of a
      // territory move nobody can see on the map, so it gets said out loud.
      toast(
        typeof data.regrouped === "number" && data.regrouped > 0
          ? `${faNum(count)} منطقه به‌روزرسانی شد — ${faNum(data.regrouped)} مشتری هم جابه‌جا شد.`
          : `${faNum(count)} منطقه به‌روزرسانی شد.`,
        "success"
      );
    } catch {
      toast("منطقه‌ها به‌روز نشدند؛ دوباره تلاش کنید", "error");
    } finally {
      setBulkSaving(false);
      setBulkSelectedIds(new Set());
      setBulkStatusChoice("");
      setBulkGroupChoice("");
      loadDistricts();
    }
  }

  const mantagheFeatures = useMemo(
    () => (districts ? { type: "FeatureCollection" as const, features: districts.features.filter((f) => f.properties.level === "mantaghe") } : null),
    [districts]
  );
  const mahalleFeatures = useMemo(
    () => (districts ? { type: "FeatureCollection" as const, features: districts.features.filter((f) => f.properties.level === "mahalle") } : null),
    [districts]
  );

  /** Everything about the current view except where the map is pointing.
   *
   *  The default colour mode is omitted rather than written out, so an untouched map
   *  produces the short link people will actually paste. */
  const linkState = useMemo(
    () => ({
      customerId: selectedCustomer?.id,
      districtId: selectedDistrict?.properties.id,
      colorMode: colorMode === "status" ? undefined : colorMode,
      districtColorMode: districtColorMode === "status" ? undefined : districtColorMode,
    }),
    [selectedCustomer, selectedDistrict, colorMode, districtColorMode]
  );

  /** Rewrites the address bar to describe what is on screen.
   *
   *  The map position comes from a ref rather than state on purpose: it changes on every
   *  pan, and holding it in state would re-render 430 polygons for each one. */
  const syncUrl = useCallback(() => {
    replaceUrlQuery(buildMapLink({ ...linkState, view: viewRef.current ?? undefined }));
  }, [linkState]);

  useEffect(() => {
    syncUrl();
  }, [syncUrl]);

  const handleView = useCallback(
    (v: MapView) => {
      viewRef.current = v;
      writeStoredView(v);
      syncUrl();
    },
    [syncUrl]
  );

  /** Copies a link to exactly this view. The share button's whole job. */
  async function shareView() {
    const url = absoluteMapLink({ ...linkState, view: viewRef.current ?? undefined }, "/");
    const ok = await copyText(url);
    toast(ok ? "لینک این نما کپی شد." : "کپی لینک ممکن نبود.", ok ? "success" : "error");
  }

  /** Every route to an open customer panel funnels through here, so this is the one
   *  place that has to record the view. */
  const openCustomer = useCallback((c: CustomerRow) => {
    setSelectedCustomer(c);
    setRecentIds((prev) => {
      const next = addRecent(prev, c.id);
      writeIds(RECENT_KEY, next);
      return next;
    });
  }, []);

  /* Item 27: with nothing selected the panel leads with the work in the area on screen.
     Rebuilt whenever the map settles somewhere new (BoundsReporter). */
  const worklist = useMemo(
    () =>
      viewBounds
        ? buildWorklist(customers, dueReminders, districtProps, viewBounds, tehranTodayIso())
        : null,
    [customers, dueReminders, districtProps, viewBounds],
  );

  /* The header's search overlay sends a picked customer here when the map is already open,
     rather than navigating to the page it is on: CoverageMap reads ?c= once, at mount, so
     a same-route push would have changed the address bar and nothing else. */
  const focusCustomerRef = useRef<(id: number) => void>(() => {});
  useEffect(() => {
    focusCustomerRef.current = (id) => {
      const c = customers.find((x) => x.id === id);
      if (c) flyToCustomer(c);
    };
  });
  useEffect(() => {
    const on = (e: Event) => focusCustomerRef.current((e as CustomEvent<number>).detail);
    window.addEventListener(MAP_FOCUS_EVENT, on);
    return () => window.removeEventListener(MAP_FOCUS_EVENT, on);
  }, []);

  function flyToCustomer(c: CustomerRow) {
    openCustomer(c);
    if (c.lat && c.lng && mapRef.current) {
      mapRef.current.flyTo({ center: [c.lng, c.lat], zoom: 15, duration: 1000 });
    }
  }

  function togglePinned(id: number) {
    setPinnedIds((prev) => {
      const next = toggleId(prev, id);
      writeIds(PINNED_KEY, next);
      return next;
    });
  }

  // Feature 3: the stretch actually driven between two of our sites. Anything sitting a
  // few kilometres off it is a nearly free visit, and nothing in the app knew the line
  // existed. Defaults to the two most distant sites, which for the current pair is the
  // home base and the warehouse.
  /** The site distances and colours are measured from. Deliberately the configured
   *  site and never a live GPS fix (spec 1.2): letting position feed this would repaint
   *  the entire map as the user drives, and a customer's colour would describe where the
   *  phone is rather than what the customer costs to reach. */
  const colourOrigin = useMemo(() => pickOrigin(initialFacilities), [initialFacilities]);

  /* Everything that puts a facility ON the map works from this list, not from
     initialFacilities. A place with no location has no pin to drop, no distance to
     measure and nothing for the user to fly to -- and Leaflet given [null, null] does not
     fail loudly, it puts the marker somewhere arbitrary. The sidebar below still lists
     every facility, including the unplaced ones, because "this place exists but is not on
     the map yet" is exactly what the user needs to see in order to fix it. */
  const placedFacilities = useMemo(() => initialFacilities.filter(isPlaced), [initialFacilities]);

  const {
    ends: corridorEnds,
    route: corridorRoute,
    routing: corridorRouting,
    path: corridorPath,
    band: corridorBand,
    districtIds: corridorDistrictIds,
    uncovered: corridorUncovered,
  } = useCorridor({ on: corridorOn, widthKm: corridorWidthKm, placedFacilities, districtProps });

  // Fetched only once either zone is asked for, so a map nobody switches them on never
  // pays for the file.
  const { zones: trafficZones, status: zoneStatus } = useTrafficZones(
    layers.traffic_zone || layers.low_emission
  );

  /** How each district is painted, handed to DistrictLayer as per-feature properties. */
  const districtPaint = useCallback(
    (feature: DistrictFeature): DistrictPaint => {
      const status = (feature.properties.coverage_status ?? "unknown") as CoverageStatus;
      /* "unknown" takes the themed neutral rather than the fixed one. It is 429 of the 439
         districts, so it is not really a status colour at all -- it is what the map looks
         like. visited/needs_coverage/not_allowed keep STATUS_COLOR untouched: those three
         carry meaning shared with /report and /analytics. The legend follows the same rule. */
      const fill =
        districtColorMode === "group"
          ? districtGroupColor(feature.properties.group_id ?? null, groupColors)
          : status === "unknown"
            ? ink.unknown
            : STATUS_COLOR[status];
      const level = feature.properties.level === "mantaghe" ? "mantaghe" : "mahalle";
      const selected = bulkSelectedIds.has(feature.properties.id);

      // With the corridor on, districts off it recede rather than disappear: the point is
      // to show what sits near the drive *in context*.
      const inCorridor = !corridorDistrictIds || corridorDistrictIds.has(feature.properties.id);
      const dim = corridorDistrictIds && !inCorridor ? 0.25 : 1;

      return {
        line: selected ? ink.selected : level === "mantaghe" ? ink.strokeMajor : ink.strokeMinor,
        lineWidth: selected ? 3 : level === "mantaghe" ? 1.5 : 1,
        fill,
        // Territory reads as a filled area rather than a tint: in group mode the fill is the
        // whole point, where in status mode it sits under markers that have to stay legible.
        fillOpacity: (selected ? 0.55 : districtColorMode === "group" ? 0.45 : level === "mantaghe" ? 0.08 : 0.35) * dim,
        lineOpacity: (selected ? 1 : level === "mantaghe" ? 0.5 : 0.8) * dim,
        selected,
      };
    },
    [districtColorMode, groupColors, ink, bulkSelectedIds, corridorDistrictIds],
  );

  /** A customer's marker colour under the active mode. Extracted because the selected
   *  customer is rendered separately from the rest and both must agree. */
  const markerColor = useCallback(
    (c: CustomerRow): string => {
      if (colorMode === "debt") return debtColor(c.debt);
      if (colorMode === "phone_sales") return salespersonColor(c.salesperson, salesIndex);
      if (colorMode === "inactivity") return inactivityColor(c);
      if (colorMode === "distance") return distanceColor(c, colourOrigin);
      return customerLifecycleColor(c.lifecycle);
    },
    [colorMode, salesIndex, colourOrigin],
  );

  function flyToFacility(f: FacilityRow & { lat: number; lng: number }) {
    mapRef.current?.flyTo({ center: [f.lng, f.lat], zoom: 15, duration: 1000 });
  }

  function flyToDistrict(d: DistrictFeature) {
    setSelectedDistrict(d);
    if (!mapRef.current) return;
    try {
      const pts = (d.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon).coordinates.flat(2) as unknown as [number, number][];
      const lngs = pts.map((p) => p[0]), lats = pts.map((p) => p[1]);
      mapRef.current.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: 60, duration: 1000 });
    } catch {
      // malformed geometry -- selection still opens the editor, just skip the fly
    }
  }

  function handleLocationFound(lat: number, lng: number, label: string) {
    setFoundLocation({ lat, lng, label });
    mapRef.current?.flyTo({ center: [lng, lat], zoom: 16, duration: 1000 });
  }

  /** A panel is up and is the thing being read. Map chrome stands down for it. */
  const panelOwnsScreen = selectedCustomer !== null || selectedDistrict !== null || layersOpen;

  /* The customers drawn as map pins. The selected one is drawn on its own, above them,
     and never swallowed into a cluster bubble. */
  const mapCustomers = useMemo(
    () =>
      (layers.customers ? filteredCustomers : []).filter(
        (c): c is CustomerRow & { lat: number; lng: number } => !!c.lat && !!c.lng && c.id !== selectedCustomer?.id,
      ),
    [layers.customers, filteredCustomers, selectedCustomer],
  );
  const shownZones = useMemo(() => {
    const on = new Set<string>();
    if (layers.traffic_zone) on.add("limited_traffic");
    if (layers.low_emission) on.add("low_emission");
    return on;
  }, [layers.traffic_zone, layers.low_emission]);

  return (
    /* The `meridian` scope used to be rooted HERE, because the map was the one surface
       that did not sit inside it. app/(shell)/layout.tsx now provides it, and repeating
       it would be a second copy of the tokens nested under the skin's own.
       Everything below still reads --surface, --border, --accent and the rest; it just
       inherits them now. See app/globals.css, "مریدین". */
    /* data-ground says what the chosen basemap's ground looks like, so the overlays drawn
       through CSS -- cluster bubbles, the corridor band, the zone fills, the names layer
       -- can be tuned for it the way MAP_INK tunes the ones drawn through Leaflet. It
       tracks the basemap, not the skin: those used to be the same thing and no longer
       are. */
    <div
      ref={viewportRef}
      data-ground={activeBasemap.ground}
      className="map-viewport relative w-full overflow-hidden bg-bg"
    >
      {/* Stood down in two cases, both while the sidebar is shut -- when it is open this
          button is the only way to close it and has to stay reachable.

          Against the phone-sized search box: two 40px controls and a full-width input
          cannot share 100vw, and the input is the one being used.

          Against an open panel: this button sits above the sidebar in the stacking scale,
          and the sidebar sits above the panels, so it floats over a panel's own title bar
          -- covering the name of what you are looking at with a menu button that would
          only bury it further. With a panel owning the screen there is nothing here worth
          reaching, so it stands down until the panel is closed. */}
      <button
        onClick={() => setSidebarOpen((v) => !v)}
        aria-label={sidebarOpen ? "بستن پنل" : "باز کردن پنل"}
        aria-expanded={sidebarOpen}
        hidden={selectedCustomer !== null || (!sidebarOpen && (searchExpanded || panelOwnsScreen))}
        className="mapbtn absolute right-4 top-4 z-[var(--z-sidebar-toggle)]"
      >
        <Icon name={sidebarOpen ? "x" : "menu"} size="md" />
        {!sidebarOpen && dueReminders.length > 0 && (
          <span className="absolute -left-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-crit px-1 font-mono text-[10px] font-bold text-white">
            {faNum(dueReminders.length)}
          </span>
        )}
      </button>

      <SearchBox
        customers={customers}
        districts={districts?.features ?? []}
        onSelectCustomer={flyToCustomer}
        onSelectDistrict={flyToDistrict}
        onLocationFound={handleLocationFound}
        inputRef={searchInputRef}
        onExpandedChange={setSearchExpanded}
      />

      <GeofenceWatcher
        enabled={geofenceOn}
        facilitiesEnabled={facilityGeofenceOn}
        customers={filteredCustomers}
        facilities={initialFacilities}
        leads={initialLeads}
      />

      <aside
        ref={asideRef}
        className={`mapside absolute inset-y-3 right-3 z-[var(--z-sidebar)] flex w-80 max-w-[calc(100%-1.5rem)] flex-col gap-5 overflow-y-auto p-4 pt-16 transition-transform duration-[var(--dur-slow)] ease-[var(--ease-out)] ${
          sidebarOpen && !selectedCustomer ? "sidebar-stagger translate-x-0" : "translate-x-[calc(100%+1rem)]"
        }`}
      >
        <div>
          {/* No brand row: the logo went with item 1, and the page header above already
              names this page. What stays is the one map-native action the old «لینک‌های
              سریع» section held: the current view as a link. */}
          <div className="mapside__bar">
            <button type="button" className="inline-flex items-center justify-center gap-[var(--space-2)] mapbtn mapbtn--sm" onClick={shareView} aria-label="کپی لینک این نما" title="کپی لینک این نما">
              <Icon name="copy" size="sm" />
            </button>
          </div>

          {/* Silent while the data is current. Every figure on this map -- debts,
              statuses, last-purchase dates -- comes from a spreadsheet somebody has to
              remember to import, and nothing goes visibly wrong when they forget. */}
          <DataFreshness syncedAt={newestSync(customers)} className="mt-2" />

          {positionStatus === "denied" && (
            <p className="mt-2 flex flex-wrap items-center gap-1.5 text-[length:var(--text-xs)] leading-5 text-crit">
              <Icon name="warn" size="sm" />
              {positionError ?? "دسترسی به موقعیت داده نشده"} — موقعیت شما روی نقشه نشان داده نمی‌شود.
              <button
                onClick={retryPosition}
                className="inline-flex items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-sm)] border border-border px-2 py-0.5 touch text-text-muted transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:border-accent hover:text-accent"
              >
                <Icon name="refresh" size="md" />
                تلاش دوباره
              </button>
            </p>
          )}

          {/* Finds a section by name. Twelve folded sections is a better control surface
              than twelve open ones, but it is still twelve headings to scan past when
              you know exactly which switch you came for. Deliberately labelled as a
              filter of sections, so it is not mistaken for the customer search that
              floats over the map. */}
          <div className="relative mt-3">
            <FieldInput
              ref={sectionFilterRef}
              value={sectionFilter}
              onChange={(e) => setSectionFilter(e.target.value)}
              placeholder="فیلتر بخش‌ها…"
              aria-label="فیلتر بخش‌های پنل"
              className="w-full pe-2 ps-7 text-[length:var(--text-xs)] text-text"
            />
            {sectionFilter && (
              <button
                onClick={() => setSectionFilter("")}
                aria-label="پاک کردن فیلتر"
                className="absolute left-1.5 top-1/2 -translate-y-1/2 text-text-faint transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:text-text"
              >
                <Icon name="x" size="sm" />
              </button>
            )}
          </div>
        </div>

        {worklist && !selectedCustomer ? (
          <MapWorklist
            worklist={worklist}
            onCustomer={flyToCustomer}
            onDistrict={(d) => {
              const f = districts?.features.find((x) => x.properties.id === d.id);
              if (f) flyToDistrict(f);
            }}
            onReminder={(r) => {
              const due = dueReminders.find((x) => x.id === r.id);
              if (due) openReminderEntity(due);
            }}
          />
        ) : null}

        {/* Everything below is filterable. An empty panel with no explanation reads as a
            failure, so a filter that matches nothing says so. */}
        <SectionFilterContext.Provider value={sectionFilter}>
        {sectionFilter.trim() && (
          <p className="text-[length:var(--text-xs)] leading-5 text-text-faint">
            نمایش بخش‌های مرتبط با «{sectionFilter.trim()}».
          </p>
        )}

        <DueRemindersSection dueReminders={dueReminders} openReminderEntity={openReminderEntity} resolveReminder={resolveReminder} />

        <NearbyCustomersSection myPosition={myPosition} nearbyCustomers={nearbyCustomers} nearbyRadiusKm={nearbyRadiusKm} setNearbyRadiusKm={setNearbyRadiusKm} flyToCustomer={flyToCustomer} />

        <PinnedCustomersSection pinnedCustomers={pinnedCustomers} flyToCustomer={flyToCustomer} togglePinned={togglePinned} />

        <RecentCustomersSection recentCustomers={recentCustomers} flyToCustomer={flyToCustomer} togglePinned={togglePinned} />

        <CustomerFilters
          salespeople={salespeople}
          salespersonFilter={salespersonFilter}
          onSalespersonFilterChange={setSalespersonFilter}
          totalCount={customers.length}
          filteredCount={filteredCustomers.length}
        />

<CustomerColourSection colorMode={colorMode} setColorMode={setColorMode} colourOrigin={colourOrigin} shapedMarkers={shapedMarkers} />
        {/* Always present, unlike before: a section that disappears when it is empty
            cannot be distinguished from a section that is broken, and "no dormant
            customers" is itself worth knowing. The count in the heading answers it
            without opening. */}
        <CollapsibleSection help="card.map-dormant"
          title="مشتریان راکد" icon="moon"
          count={hasPurchaseHistory ? dormantCustomers.length : undefined}
          storageKey="dormant"
          keywords="بی‌خرید قدیمی سفارش"
        >
          {!hasPurchaseHistory ? (
            <EmptyState
              icon="receipt"
              title="تاریخ خرید هیچ مشتری‌ای ثبت نشده"
              hint="این فهرست از برگه «فروش» اکسل ساخته می‌شود. تا وارد شدن سفارش‌ها، «راکد بودن» قابل تشخیص نیست — و این با «هیچ مشتری راکدی نیست» یکی نیست."
              className="py-4"
            />
          ) : dormantCustomers.length === 0 ? (
            <EmptyState icon="check" title="همهٔ مشتریان فعال در ۳۰ روز گذشته خرید داشته‌اند" className="py-4" />
          ) : (
            <div className="flex max-h-72 flex-col gap-1.5 overflow-y-auto">
              {dormantCustomers.map(({ customer, days }) => (
                <Button key={customer.id} variant="secondary" className="covrow" onPress={() => flyToCustomer(customer)}>
                  <Icon name="calendar" size="md" />
                  <span className="truncate text-[length:var(--text-sm)] text-text">{customer.business_name}</span>
                  <span
                    className="shrink-0 font-mono text-[length:var(--text-xs)]"
                    style={{ color: days > 60 ? "var(--crit)" : "var(--warn)" }}
                  >
                    {faNum(days)} روز
                  </span>
                </Button>
              ))}
            </div>
          )}
        </CollapsibleSection>

        <CollapsibleSection help="card.map-nocoord"
          title="بدون مختصات" icon="help"
          count={noCoordCustomers.length}
          storageKey="nocoord"
          keywords="مختصات نقشه جای‌گذاری"
        >
          {noCoordCustomers.length === 0 ? (
            <EmptyState icon="check" title="همه مشتریان فعال روی نقشه جای گرفته‌اند" className="py-4" />
          ) : (
            <div className="flex max-h-72 flex-col gap-1.5 overflow-y-auto">
              {noCoordCustomers.map((customer) => (
                <Button key={customer.id} variant="secondary" className="covrow" onPress={() => flyToCustomer(customer)}>
                  <Icon name="map-pin" size="md" />
                  <span className="truncate text-[length:var(--text-sm)] text-text">{customer.business_name}</span>
                  <span className="shrink-0 text-[length:var(--text-xs)] text-text-faint">
                    {customer.phone ?? "—"}
                  </span>
                </Button>
              ))}
              <p className="mt-1.5 text-[length:var(--text-xs)] leading-5 text-text-faint">
                روی نام کلیک کنید تا جزئیات مشتری باز شود و بتوانید مختصات را بررسی کنید.
              </p>
            </div>
          )}
        </CollapsibleSection>

        {/* The two silhouettes are repeated here at marker size, not described in words:
            the legend's job is to teach the shape the user will actually look for. */}
<MapSitesSection initialFacilities={initialFacilities} placedFacilities={placedFacilities} flyToFacility={flyToFacility} corridorEnds={corridorEnds} corridorOn={corridorOn} corridorWidthKm={corridorWidthKm} setCorridorWidthKm={setCorridorWidthKm} corridorRoute={corridorRoute} corridorRouting={corridorRouting} corridorUncovered={corridorUncovered} setLayersOpen={setLayersOpen} />
<MapLegendSection groups={groups} districtColorMode={districtColorMode} setDistrictColorMode={setDistrictColorMode} shapedMarkers={shapedMarkers} bulkMode={bulkMode} />
        {/* Switching it on lives in the layers panel with every other layer; how it is
            weighted is a property of the layer, and belongs next to the data it weights. */}
        <CollapsibleSection help="card.map-heat" title="نقشه حرارتی" icon="flame" storageKey="heatmap" keywords="تراکم بدهی heatmap لایه">
            {heatmapOn ? (
              <CheckField checked={heatmapByDebt} onChange={setHeatmapByDebt} className="text-[length:var(--text-sm)] text-text-muted">
                وزن‌دهی بر اساس شدت بدهی
              </CheckField>
            ) : (
              <LayerHint onOpen={() => setLayersOpen(true)} what="نقشه حرارتی" />
            )}
        </CollapsibleSection>

        <MapSettingsSection
          geofenceOn={geofenceOn} setGeofenceOn={setGeofenceOn}
          facilityGeofenceOn={facilityGeofenceOn} setFacilityGeofenceOn={setFacilityGeofenceOn}
          driverMode={driverMode} setDriverMode={setDriverMode}
          shapedMarkers={shapedMarkers} setShapedMarkers={setShapedMarkers}
          nextStopOn={nextStopOn} setNextStopOn={setNextStopOn}
          bulkMode={bulkMode} setBulkMode={setBulkMode} clearBulkSelection={() => setBulkSelectedIds(new Set())}
          precisionMode={precisionMode} setPrecisionMode={setPrecisionMode} activeTier={activeTier}
        />

        {/* Last in the panel on purpose: a driver never needs this, and it would be
            competing with the things they do. */}
        <button
          onClick={() => setShowShortcuts(true)}
          className="self-start font-mono text-[length:var(--text-xs)] uppercase tracking-wide text-text-faint transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:text-accent"
        >
          <Icon name="help" size="sm" />
          میان‌برهای صفحه‌کلید (؟)
        </button>

        {error && (
          <p className="flex items-center gap-1.5 text-[length:var(--text-sm)] text-crit">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-crit" />
            {error}
          </p>
        )}

        {loading && <p className="text-[length:var(--text-sm)] text-text-muted">در حال بارگذاری…</p>}
        </SectionFilterContext.Provider>
      </aside>

      <div className="absolute inset-0">
        <AppMap
          ref={mapRef}
          basemap={basemap}
          initialViewState={{
            latitude: startView ? startView.lat : TEHRAN_CENTER[0],
            longitude: startView ? startView.lng : TEHRAN_CENTER[1],
            zoom: startView?.zoom ?? 11,
          }}
          interactiveLayerIds={[CUSTOMER_LAYER, CLUSTER_LAYER, "mantaghe-fill", "mahalle-fill"]}
        >
          {/* Everything that is area rather than point goes under the basemap's street
              names (BASEMAP_LABELS), so the names read through the fills. */}
          <TrafficZoneLayer
            zones={trafficZones}
            status={zoneStatus}
            show={shownZones}
            ground={activeBasemap.ground}
            beforeId={BASEMAP_LABELS}
          />

          {layers.districts && (
            <DistrictLayer
              mantaghe={mantagheFeatures}
              mahalle={mahalleFeatures}
              paint={districtPaint}
              tooltip={districtTooltip}
              onPick={pickDistrict}
              beforeId={BASEMAP_LABELS}
            />
          )}
          {cityBoundary && (
            <Source id="city-boundary" type="geojson" data={cityBoundary}>
              <Layer id="city-boundary" type="line" beforeId={BASEMAP_LABELS}
                paint={{ "line-color": ink.boundary, "line-width": 2, "line-dasharray": [3, 2.5], "line-opacity": 0.85 }} />
            </Source>
          )}

          {/* Feature 3 + 14b: the band, and the dashed line down its middle that makes it
              read as a route rather than an arbitrary rectangle. */}
          <CorridorBandLayer corridorOn={corridorOn} corridorEnds={corridorEnds} corridorBand={corridorBand} corridorPath={corridorPath} lightGround={activeBasemap.ground === "light"} beforeId={BASEMAP_LABELS} />

          {heatmapOn && <HeatmapLayer customers={filteredCustomers} weightByDebt={heatmapByDebt} beforeId={BASEMAP_LABELS} />}

          <CustomerLayer customers={mapCustomers} colorOf={markerColor} shaped={shapedMarkers} ink={ink} onOpen={openCustomer} />

          {/* Outside the clusters on purpose: the customer whose panel is open is the one
              thing on this map that must never be swallowed into a bubble. Drawn even with
              the customers layer switched off: whatever you turned off, you did not mean
              the one you are looking at. Only this one pulses. */}
          {selectedCustomer?.lat && selectedCustomer?.lng && (
            <Marker longitude={selectedCustomer.lng} latitude={selectedCustomer.lat} style={{ zIndex: 2 }}>
              <div
                className={`customer-marker customer-marker--${shapedMarkers ? shapeForColor(markerColor(selectedCustomer)) : "diamond"} customer-marker--selected`}
                style={{ "--marker-color": markerColor(selectedCustomer) } as React.CSSProperties}
                title={selectedCustomer.business_name}
              >
                <span className="customer-marker__ping" aria-hidden="true" style={{ animationDelay: "0ms" }} />
                <span className="customer-marker__ping" aria-hidden="true" style={{ animationDelay: "var(--pulse-stagger)" }} />
                <span className="customer-marker__diamond" />
              </div>
            </Marker>
          )}

          {/* Landmarks the rest of the map is read against: DOM markers, so they always
              sit above the customer pins. */}
          {layers.facilities && <FacilityMarkers placedFacilities={placedFacilities} navAppId={navAppId} />}

          <LeadMarkers initialLeads={initialLeads} navAppId={navAppId} />

          {foundLocation && <FoundLocationMarker foundLocation={foundLocation} onClear={() => setFoundLocation(null)} />}

          <FitToCustomers
            customers={customers}
            enabled={!startView && incoming.customerId === undefined && incoming.districtId === undefined}
          />
          <MapWatcher onView={handleView} onZoom={setZoom} onBounds={setViewBounds} />
          {/* Always drawn, never waiting to be asked for. */}
          <MyLocationMarker />
          <LocateControl />
          <FullscreenControl />
          <LayersControl open={layersOpen} count={changedFromDefault(layers)} onClick={() => setLayersOpen((v) => !v)} />
        </AppMap>

        {selectedCustomer && (
          <CustomerDetailPanel
            customer={selectedCustomer}
            facilities={initialFacilities}
            pinned={pinnedIds.includes(selectedCustomer.id)}
            onTogglePin={() => togglePinned(selectedCustomer.id)}
            onClose={() => setSelectedCustomer(null)}
            onReminderAdded={loadReminders}
            onUpdated={loadCustomers}
          />
        )}
      </div>

      <LayersPanel
        open={layersOpen}
        onClose={() => setLayersOpen(false)}
        basemap={basemap}
        onBasemap={chooseBasemap}
        layers={layers}
        onLayer={setLayer}
        zoneStatus={zoneStatus}
        hasCorridor={corridorEnds !== null}
      />

      {selectedDistrict && (
        <DistrictEditor
          district={selectedDistrict}
          onClose={() => setSelectedDistrict(null)}
          onReminderAdded={loadReminders}
          onSaved={() => {
            setSelectedDistrict(null);
            loadDistricts();
          }}
        />
      )}

      {/* Suppressed in bulk mode, where the bulk action bar owns the bottom of the
          screen -- and bulk district editing is a desk activity, not a driving one. */}
      {!bulkMode && (
        <NextStopBar
          enabled={nextStopOn}
          myPosition={myPosition}
          onDismiss={() => {
            setNextStopOn(false);
            localStorage.setItem("coverage_nextstop_off", "1");
            toast("نوار توقف بعدی پنهان شد — از «تنظیمات» دوباره روشن می‌شود.", "info");
          }}
          onFocus={(entityId, lat, lng) => {
            const c = customers.find((x) => x.id === entityId);
            if (c) flyToCustomer(c);
            else mapRef.current?.flyTo({ center: [lng, lat], zoom: 15, duration: 1000 });
          }}
        />
      )}

      {showShortcuts && <ShortcutHelp onClose={() => setShowShortcuts(false)} />}

      {bulkMode && bulkSelectedIds.size > 0 && (
        <div
          dir="rtl"
          className="pinned-bottom absolute left-1/2 z-[var(--z-map-overlay)] flex w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 flex-wrap items-center gap-2 rounded-[var(--radius-lg)] border border-accent bg-surface-raised p-3 elevate-accent"
        >
          <span className="shrink-0 text-[length:var(--text-sm)] font-medium text-text">
            {bulkSelectedIds.size} منطقه انتخاب شده
          </span>
          <SmartPicker
            scope="coverage-status"
            label="وضعیت"
            items={(Object.keys(STATUS_LABEL) as CoverageStatus[]).map((st) => ({ id: st, label: STATUS_LABEL[st] }))}
            value={bulkStatusChoice}
            onChange={(id) => setBulkStatusChoice(id as CoverageStatus | "")}
            clearLabel="— بدون تغییر وضعیت —"
            placeholder="— بدون تغییر وضعیت —"
          />
          {(role === "owner" || role === "platform_owner") && groups.length > 0 && (
            <SmartPicker
              scope="coverage-group"
              label="گروه"
              items={[...groups.map((g) => ({ id: String(g.id), label: g.name })), { id: "__ungroup__", label: "— خارج کردن از گروه —" }]}
              value={bulkGroupChoice}
              onChange={setBulkGroupChoice}
              clearLabel="— بدون تغییر گروه —"
              placeholder="— بدون تغییر گروه —"
            />
          )}
          <div className="mr-auto flex shrink-0 gap-2">
            <button
              onClick={() => setBulkSelectedIds(new Set())}
              className="rounded-[var(--radius-sm)] border border-border px-3 py-1.5 text-[length:var(--text-sm)] text-text-muted hover:border-crit hover:text-crit"
            >
              <Icon name="x" size="sm" />
              لغو انتخاب
            </button>
            <button
              onClick={applyBulk}
              disabled={bulkSaving || (!bulkStatusChoice && !bulkGroupChoice)}
              className="inline-flex items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-sm)] border border-accent bg-accent px-3 py-1.5 text-[length:var(--text-sm)] font-medium text-accent-ink transition-[filter,transform] duration-[var(--dur-base)] ease-[var(--ease-out)] hover:enabled:brightness-110 active:enabled:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Icon name="check" size="sm" />
              {bulkSaving ? "در حال اعمال…" : "اعمال روی همه"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
