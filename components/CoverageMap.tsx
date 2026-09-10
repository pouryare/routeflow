"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import type { ComponentProps } from "react";
import { useAccent } from "@/components/AccentPicker";
import { useTheme } from "@/components/ThemeToggle";
import dynamic from "next/dynamic";
import Link from "next/link";
import { MapContainer, TileLayer, GeoJSON, Marker, Pane, Polygon, Polyline, Popup, useMap, useMapEvents } from "react-leaflet";
/* This app carries its own DistrictFeature shape, which is not structurally the
   GeoJsonObject react-leaflet declares. Casting to GeoJSONProps' own field types says
   exactly which boundary is being crossed; `as any` said nothing and switched off
   checking for the rest of the prop as well. */
import type { GeoJSONProps } from "react-leaflet";
import { LatLngBounds, divIcon, geoJSON } from "leaflet";
import type { DivIcon, Layer, LeafletMouseEvent, Map as LeafletMap } from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import MarkerClusterGroup from "react-leaflet-cluster";
import {
  DistrictCollection,
  DistrictFeature,
  DistrictGeometryMap,
  DistrictProperties,
  DistrictPropertiesResponse,
  CustomerRow,
  CoverageStatus,
  STATUS_COLOR,
  STATUS_LABEL,
  CustomerColorMode,
  customerLifecycleColor,
  debtColor,
  salespersonColor,
  inactivityColor,
  daysSinceLastPurchase,
  distanceColor,
  DISTANCE_BANDS,
  isCustomerColorMode,
  shapeForColor,
  type DistrictColorMode,
  districtGroupColor,
  isDistrictColorMode,
} from "@/lib/types";
import {
  PRECISION_AUTO_ZOOM,
  PrecisionMode,
  PrecisionTier,
  geometryUrl,
  isPrecisionMode,
  resolveTier,
} from "@/lib/precision";
import type { Role } from "@/lib/db";
import CollapsibleSection, { SectionFilterContext } from "./CollapsibleSection";
import CustomerFilters from "./CustomerFilters";
import StatusPill from "./StatusPill";
import SearchBox from "./SearchBox";
import LocateControl from "./LocateControl";
import MyLocationMarker from "./MyLocationMarker";
import { useMyPosition } from "./MyPositionProvider";
import GeofenceWatcher from "./GeofenceWatcher";
import NavAppSetting, { useNavApp } from "./NavAppSetting";
import { navigateUrl } from "@/lib/navApps";
import { useToast } from "./ToastProvider";
import { corridorBandFromPath, distanceKm, distanceToPathKm, formatDistanceKm } from "@/lib/geo";
import type { LatLng } from "@/lib/geo";
import { fetchDrivingRoute, type DrivingRoute } from "@/lib/osrm";
import {
  BASEMAP_KEY,
  LABELS_TILE,
  LAYERS_KEY,
  QUIET_TILES,
  basemapDef,
  changedFromDefault,
  isBasemapId,
  parseLayerPrefs,
  type BasemapId,
  type LayerPrefs,
  type OverlayId,
} from "@/lib/mapLayers";
import LayersPanel, { LayerHint, LayersControl } from "./LayersPanel";
import TrafficZoneLayer, { useTrafficZones } from "./TrafficZoneLayer";
import { FACILITY_COLOR, FACILITY_LABEL, FacilityRow } from "@/lib/facilityTypes";
import { FACILITY_ART, facilityIcon } from "./facilityIcon";
import { useSwipeDismiss } from "./useSwipeDismiss";
import DataFreshness from "./DataFreshness";
import EmptyState from "./EmptyState";
import { newestSync } from "@/lib/freshness";
import { faNum } from "@/lib/format";
import { MapView, buildMapLink, absoluteMapLink, parseMapLink, replaceUrlQuery } from "@/lib/deepLink";
import { copyText, coordText } from "@/lib/clipboard";
import { PINNED_KEY, RECENT_KEY, addRecent, pruneIds, readIds, toggleId, writeIds } from "@/lib/customerLists";
import CopyButton from "./CopyButton";
import { Icon } from "@/components/meridian/Icon";
import MapWorklist from "./MapWorklist";
import { buildWorklist, type Bounds } from "@/lib/mapWorklist";
import { MAP_FOCUS_EVENT } from "@/lib/searchModel";
import { MAP_PIN_SVG } from "@/components/meridian/icon-map";

// Everything below is reachable only after an interaction -- opening a customer, opening
// a district, expanding the import panel, switching the heatmap on -- or carries a
// library the first paint doesn't need (leaflet.heat, leaflet.fullscreen and their CSS).
// Splitting them out keeps that weight off the chunk that has to arrive before the map
// can draw anything. CoverageMap is itself ssr:false, so none of these need an SSR pass.
const HeatmapLayer = dynamic(() => import("./HeatmapLayer"), { ssr: false });
/* MapLibre and its Leaflet bridge are ~250KB: loaded only once a vector basemap is
   actually chosen, so the raster styles -- including the default -- cost nothing. */
const VectorBasemap = dynamic(() => import("./VectorBasemap"), { ssr: false });
const FullscreenControl = dynamic(() => import("./FullscreenControl"), { ssr: false });
const CustomerDetailPanel = dynamic(() => import("./CustomerDetailPanel"), { ssr: false });
const DistrictEditor = dynamic(() => import("./DistrictEditor"), { ssr: false });
const NextStopBar = dynamic(() => import("./NextStopBar"), { ssr: false });
const ShortcutHelp = dynamic(() => import("./ShortcutHelp"), { ssr: false });

const TEHRAN_CENTER: [number, number] = [35.7, 51.55];

const VIEW_KEY = "coverage_view";

/** Where this browser was left. A driver works one district for days at a time, and the
 *  map used to re-fit to every customer in the province on each load. */
function readStoredView(): MapView | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<MapView>;
    if (typeof v.lat !== "number" || typeof v.lng !== "number" || typeof v.zoom !== "number") return null;
    return { lat: v.lat, lng: v.lng, zoom: v.zoom };
  } catch {
    // Unparseable or storage blocked -- fall back to fitting, which is the old behaviour.
    return null;
  }
}

/** The opening view implied by a link that names a target but no position.
 *
 *  Computing it here, before the map is constructed, is what lets `?c=42` open *on* the
 *  customer instead of drawing Tehran and then flying away from it. Districts use the
 *  centroid already carried on their properties row, so this works before any polygon
 *  geometry has been fetched.
 *
 *  Zoom levels: 15 puts a shop in its street, 13 fits a neighbourhood. */
function linkTargetView(
  link: { customerId?: number; districtId?: number },
  customers: CustomerRow[],
  districts: DistrictProperties[]
): MapView | null {
  if (link.customerId !== undefined) {
    const c = customers.find((x) => x.id === link.customerId);
    if (c && c.lat !== null && c.lng !== null) return { lat: c.lat, lng: c.lng, zoom: 15 };
  }
  if (link.districtId !== undefined) {
    const d = districts.find((x) => x.id === link.districtId);
    if (d && d.centroid_lat !== null && d.centroid_lng !== null) {
      return { lat: d.centroid_lat, lng: d.centroid_lng, zoom: 13 };
    }
  }
  return null;
}

function writeStoredView(v: MapView): void {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify(v));
  } catch {
    // Private mode. The map still works, it just won't remember.
  }
}

/** Map geometry colours.
 *
 *  These cannot be `var(--map-stroke-major)`: the map runs with `preferCanvas`, and
 *  Leaflet writes the value straight onto a canvas 2D context, where var() is just an
 *  unrecognised string and the path silently draws black. So the value has to be a real
 *  hex by the time Leaflet sees it.
 *
 *  It is still defined in CSS -- app/globals.css, per accent theme, per skin -- and read
 *  back out here with getComputedStyle. Ten themes times two skins times two grounds is
 *  forty palettes; duplicating those in TypeScript would guarantee the stylesheet and the
 *  map disagreed within a release. One definition, resolved at the point of use.
 *
 *  The fallbacks are the shipping terracotta, and they matter: getComputedStyle returns
 *  "" for a property that has not been applied yet, which on the very first paint would
 *  otherwise hand Leaflet an empty string. */
const MAP_INK_FALLBACK = {
  light: { strokeMajor: "#6B5B4C", strokeMinor: "#8A7A69", selected: "#C0532B", boundary: "#998876", unknown: "#7D7166" },
  dark:  { strokeMajor: "#9A8A78", strokeMinor: "#8A7A69", selected: "#E8734A", boundary: "#6E6055", unknown: "#7D7166" },
} as const;

export interface MapInk {
  strokeMajor: string;
  strokeMinor: string;
  selected: string;
  boundary: string;
  /** The fill for a district whose coverage is unknown -- 429 of 439 of them, so this is
   *  the colour the map mostly IS, and the reason the theme has to reach it. */
  unknown: string;
}

/** Resolves the map ink for a ground out of the live stylesheet.
 *
 *  `ground` and not the page skin: the strokes sit on the basemap, so a cream basemap
 *  needs dark strokes whatever the surrounding UI is doing. The dark set is read by
 *  temporarily asking for the dark-skin values -- see useMapInk, which does this by
 *  reading from an element that carries the right attributes rather than by guessing. */
function readMapInk(el: HTMLElement | null, ground: "light" | "dark"): MapInk {
  const fb = MAP_INK_FALLBACK[ground];
  if (!el || typeof window === "undefined") return { ...fb };
  const cs = getComputedStyle(el);
  const get = (name: string, fallback: string) => {
    const v = cs.getPropertyValue(name).trim();
    return v || fallback;
  };
  return {
    strokeMajor: get("--map-stroke-major", fb.strokeMajor),
    strokeMinor: get("--map-stroke-minor", fb.strokeMinor),
    selected: get("--map-selected", fb.selected),
    boundary: get("--map-boundary", fb.boundary),
    unknown: get("--map-unknown", fb.unknown),
  };
}

// Three presets rather than a slider: this gets used one-handed in a moving vehicle,
// where a slider thumb is unusable.
const CORRIDOR_WIDTHS = [2, 5, 10];

interface DueReminder {
  id: number;
  entity_type: "district" | "customer";
  entity_id: number;
  due_date: string;
  message: string;
  label: string;
}

const toBounds = (b: LatLngBounds): Bounds => ({
  south: b.getSouth(),
  west: b.getWest(),
  north: b.getNorth(),
  east: b.getEast(),
});

/** Reports the visible area once on mount and again whenever the map settles, for the
 *  sidebar's worklist (lib/mapWorklist.ts). */
function BoundsReporter({ onBounds }: { onBounds: (b: Bounds) => void }) {
  const map = useMapEvents({ moveend: () => onBounds(toBounds(map.getBounds())) });
  useEffect(() => {
    onBounds(toBounds(map.getBounds()));
  }, [map, onBounds]);
  return null;
}

function DebugMapExpose() {
  const map = useMap();
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      (window as unknown as { __leafletMap?: unknown }).__leafletMap = map;
    }
  }, [map]);
  return null;
}

/** Publishes the map's zoom upward so the "auto" precision mode can pick a tier.
 *  Deliberately only listens to zoomend, not zoom: the intermediate values during a
 *  pinch or a flyTo would thrash the tier and re-fetch geometry mid-gesture. */
function ZoomWatcher({ onZoom }: { onZoom: (zoom: number) => void }) {
  const map = useMapEvents({
    zoomend: () => onZoom(map.getZoom()),
  });
  return null;
}

/** The opening view when nothing else has said where to look. Skipped entirely when the
 *  URL carries a view or a target, or when this browser remembers where it was left --
 *  fitting to all customers would throw away the thing the user actually asked for. */
/** Publishes the map's position after every gesture. moveend covers zooming too --
 *  Leaflet fires a move for a zoom -- so one listener is enough, and it fires once at the
 *  end of a pan rather than continuously through it. */
function ViewWatcher({ onView }: { onView: (v: MapView) => void }) {
  const map = useMapEvents({
    moveend: () => {
      const c = map.getCenter();
      onView({ lat: c.lat, lng: c.lng, zoom: map.getZoom() });
    },
  });
  return null;
}

function FitToCustomers({ customers, enabled }: { customers: CustomerRow[]; enabled: boolean }) {
  const map = useMap();
  const fitted = useRef(false);
  useEffect(() => {
    if (!enabled || fitted.current) return;
    const pts = customers.filter((c) => c.lat && c.lng).map((c) => [c.lat as number, c.lng as number] as [number, number]);
    if (pts.length === 0) return;
    fitted.current = true;
    if (pts.length === 1) {
      map.setView(pts[0], 13);
    } else {
      const bounds = pts.reduce((b, p) => b.extend(p), new LatLngBounds(pts[0], pts[0]));
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
    }
  }, [customers, map, enabled]);
  return null;
}

// Leaflet icons are stateless factories -- one instance can back every marker that
// looks alike -- so these are built once per distinct appearance and shared. Building
// them inline instead meant 135 fresh divIcons on every render of this component (a
// sidebar toggle, a color-mode switch, a GPS fix), each one forcing Leaflet to tear
// down and rebuild that marker's DOM.
const iconCache = new Map<string, DivIcon>();

// Only the selected marker pulses. Two infinite CSS animations on every customer meant
// a few hundred of them running forever once clustering disengages at zoom 16, which
// the compositor pays for continuously on a phone -- and a map where everything pulses
// communicates nothing anyway.
function customerIcon(color: string, selected: boolean, shaped: boolean): DivIcon {
  const shape = shaped ? shapeForColor(color) : "diamond";
  const key = `${color}|${selected}|${shape}`;
  const cached = iconCache.get(key);
  if (cached) return cached;

  const pings = selected
    ? `<span class="customer-marker__ping" aria-hidden="true" style="animation-delay:0ms"></span>
      <span class="customer-marker__ping" aria-hidden="true" style="animation-delay:var(--pulse-stagger)"></span>`
    : "";
  const icon = divIcon({
    className: "",
    html: `<div class="customer-marker customer-marker--${shape}${selected ? " customer-marker--selected" : ""}" style="--marker-color:${color}">
      ${pings}<span class="customer-marker__diamond"></span>
    </div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
  iconCache.set(key, icon);
  return icon;
}

// Cluster bubbles reuse the accent hue (identity-neutral -- a cluster mixes every
// status/debt/salesperson color underneath it, so it can't commit to one) rather than
// any div in MASTER.md's reserved status palette.
function clusterIcon(cluster: { getChildCount: () => number }) {
  const count = cluster.getChildCount();
  const size = count < 10 ? 30 : count < 50 ? 36 : 44;
  return divIcon({
    className: "",
    html: `<div class="cluster-marker" style="width:${size}px;height:${size}px;">${faNum(count)}</div>`,
    iconSize: [size, size],
  });
}

function foundLocationIcon() {
  return divIcon({
    className: "",
    html: `<div class="found-location-marker">${MAP_PIN_SVG}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 26],
  });
}

/** Straight-line distance from one site to the nearest other one -- the popup's
 *  "N km from the warehouse" line. Takes the list rather than closing over it, since
 *  the sites now arrive as a prop and can change while the map is open. */
function otherFacilityDistance(f: FacilityRow, all: FacilityRow[]): { other: FacilityRow; km: number } | null {
  const others = all.filter((x) => x.id !== f.id);
  if (others.length === 0) return null;
  return others
    .map((other) => ({ other, km: distanceKm(f, other) }))
    .sort((a, b) => a.km - b.km)[0];
}

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
  groups,
  role,
  geometryVersion,
}: {
  initialDistricts: DistrictProperties[];
  initialCustomers: CustomerRow[];
  initialFacilities: FacilityRow[];
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
  const linkAppliedRef = useRef({ customer: false, district: false });

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
  const [basemap, setBasemap] = useState<BasemapId>("dark");
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
  /* Read only inside the Leaflet click handler registered in onEachDistrict, which runs
     long after render -- so this is the "latest value" ref, not render state. Written in
     an effect because a ref mutated in the render body is not a pure render: StrictMode's
     double render and any render React discards both write anyway. */
  const bulkModeRef = useRef(bulkMode);
  useEffect(() => {
    bulkModeRef.current = bulkMode;
  }, [bulkMode]);

  const districtLayersRef = useRef(new Map<number, Layer>());
  const mapRef = useRef<LeafletMap | null>(null);
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

  /** Keyboard shortcuts, for the half of this app's life that happens at a desk.
   *
   *  Every one is a single unmodified key, which is only safe because of the guard
   *  below: without it, typing a customer's name into the search box would toggle the
   *  sidebar on every "s". */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable) return;

      switch (e.key) {
        case "/":
          e.preventDefault();
          searchInputRef.current?.focus();
          break;
        case "s":
        case "S":
          setSidebarOpen((v) => !v);
          break;
        case "f":
        case "F":
          e.preventDefault();
          // Opening the sidebar and focusing its filter are one action: the box does not
          // exist to be focused while the panel is shut.
          setSidebarOpen(true);
          window.setTimeout(() => sectionFilterRef.current?.focus(), 50);
          break;
        case "g":
        case "G":
          if (myPosition) mapRef.current?.flyTo([myPosition.lat, myPosition.lng], 16, { duration: 1 });
          else {
            toast("هنوز موقعیتی دریافت نشده", "info");
            retryPosition();
          }
          break;
        case "?":
        case "؟":
          setShowShortcuts(true);
          break;
        case "Escape":
          // Innermost first: Escape should peel one layer, not clear the screen.
          if (showShortcuts) setShowShortcuts(false);
          else if (selectedCustomer) setSelectedCustomer(null);
          else if (sidebarOpen) setSidebarOpen(false);
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showShortcuts, selectedCustomer, sidebarOpen, toast, myPosition, retryPosition]);

  const [districtsVersion, setDistrictsVersion] = useState(0);
  const loadDistricts = useCallback(async () => {
    const res = await fetch("/api/districts");
    const data: DistrictPropertiesResponse = await res.json();
    setDistrictProps(data.districts ?? []);
    setGeomVersion(data.version);
    // GeoJSON layers below are keyed off this counter: react-leaflet's <GeoJSON> doesn't
    // re-diff its `data` prop, so an in-place status edit (feature count unchanged) needs
    // a forced remount to actually recolor the polygon.
    setDistrictsVersion((v) => v + 1);
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

  useEffect(() => {
    const stored = localStorage.getItem("coverage_precision");
    // Browser-only read: localStorage does not exist during the server render, so this
    // cannot move into useState's initialiser without a hydration mismatch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (isPrecisionMode(stored)) setPrecisionMode(stored);
  }, []);
  useEffect(() => {
    localStorage.setItem("coverage_precision", precisionMode);
  }, [precisionMode]);

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
        if (!cancelled) setError("خطا در بارگذاری مرز مناطق");
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

  useEffect(() => {
    // Fetch on mount. The setState is inside the async function, past its first
    // await; the rule sees only that the call starts synchronously. Moving the data
    // fetch out of an effect entirely is the real answer, and that is a data-layer
    // change rather than a lint fix.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadReminders();
  }, [loadReminders]);

  useEffect(() => {
    // Browser-only read: localStorage does not exist during the server render, so this
    // cannot move into useState's initialiser without a hydration mismatch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
    const storedBasemap = localStorage.getItem(BASEMAP_KEY);
    if (isBasemapId(storedBasemap)) setBasemap(storedBasemap);
    // Defaults on -- it costs nothing on a day with no plan, since the bar renders
    // nothing at all then.
    setNextStopOn(localStorage.getItem("coverage_nextstop_off") !== "1");
    setShapedMarkers(localStorage.getItem("coverage_shaped_markers") === "1");
    setDriverMode(localStorage.getItem("coverage_driver_mode") === "1");
    setPinnedIds(readIds(PINNED_KEY));
    // A customer arrived at by link has been viewed as surely as one arrived at by
    // click. That path sets the selection in a lazy initialiser, before this list
    // exists, so it is recorded here instead.
    const stored = readIds(RECENT_KEY);
    if (incoming.customerId !== undefined && initialCustomers.some((c) => c.id === incoming.customerId)) {
      const withLink = addRecent(stored, incoming.customerId);
      writeIds(RECENT_KEY, withLink);
      setRecentIds(withLink);
    } else {
      setRecentIds(stored);
    }
    const storedWidth = Number(localStorage.getItem("coverage_corridor_km"));
    if (CORRIDOR_WIDTHS.includes(storedWidth)) setCorridorWidthKm(storedWidth);
    // Mount only. Re-running would overwrite toggles the user has changed since load
    // with whatever storage held when the page opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    localStorage.setItem("coverage_geofence_on", geofenceOn ? "1" : "0");
  }, [geofenceOn]);

  /** One toggle for every layer, so nothing has to remember its own storage key. */
  const setLayer = useCallback((id: OverlayId, on: boolean) => {
    setLayers((prev) => {
      const next = { ...prev, [id]: on };
      localStorage.setItem(LAYERS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const chooseBasemap = useCallback((id: BasemapId) => {
    setBasemap(id);
    localStorage.setItem(BASEMAP_KEY, id);
  }, []);

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
      toast("خطا در ثبت یادآوری", "error");
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

  // The district half does need an effect: unlike a customer, a district is only a
  // selectable thing once its polygon geometry has been fetched, and that is async. The
  // map is already pointing at the right place by then (startView used the centroid) --
  // this only opens the panel for it.
  //
  // Guarded by a ref rather than an empty dependency list: the effect has to be allowed
  // to re-run until the geometry arrives, but must not re-select once the user has moved
  // on to another district.
  useEffect(() => {
    if (incoming.districtId === undefined || linkAppliedRef.current.district || !districts) return;
    const d = districts.features.find((f) => f.properties.id === incoming.districtId);
    if (!d) return;
    linkAppliedRef.current.district = true;
    // There is no earlier moment: the feature this selects does not exist until the
    // geometry fetch above resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedDistrict(d);
  }, [districts, incoming]);

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
      el.style.height = `${Math.max(360, Math.floor(window.innerHeight - top - 16))}px`;
      mapRef.current?.invalidateSize();
    };
    fit();
    document.fonts?.ready.then(fit).catch(() => {});
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  const [accent] = useAccent();
  const [skin] = useTheme();
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

  function onEachDistrict(feature: DistrictFeature, layer: Layer) {
    districtLayersRef.current.set(feature.properties.id, layer);
    layer.on("click", (e: LeafletMouseEvent) => {
      // mahalle polygons are drawn after mantaghe (see layer order below); stopping
      // propagation keeps a click on a small mahalle from also selecting its mantaghe.
      (e as unknown as { originalEvent: MouseEvent }).originalEvent?.stopPropagation();
      if (bulkModeRef.current) {
        toggleBulkSelect(feature.properties.id);
        return;
      }
      setSelectedDistrict(feature);
    });
    const label = feature.properties.parent_name
      ? `${feature.properties.name} (${feature.properties.parent_name})`
      : feature.properties.name;
    layer.bindTooltip(`${label} — ${STATUS_LABEL[feature.properties.coverage_status]}`);
  }

  // GeoJSON child layers aren't restyled by react-leaflet when only the `style`
  // function's *output* changes (see the districtsVersion remount above for the same
  // limitation on `data`) -- selection highlighting is applied imperatively instead,
  // directly on the layers captured in onEachDistrict, so toggling a handful of
  // districts doesn't force a full remount of all ~419 polygons.
  useEffect(() => {
    districtLayersRef.current.forEach((layer) => {
      const feature = (layer as unknown as { feature?: DistrictFeature }).feature;
      if (feature && "setStyle" in layer) {
        (layer as unknown as { setStyle: (s: object) => void }).setStyle(districtStyle(feature));
      }
    });
    // `ink` is here because the skin changes the stroke and selection colours, and these
    // polygons are already drawn: without it, flipping the theme leaves 419 districts
    // outlined in the other skin's ink until something else happens to restyle them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bulkSelectedIds, districtColorMode, groupColors, ink]);



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
      toast("خطا در به‌روزرسانی گروهی مناطق", "error");
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
    toast(ok ? "پیوند این نما کپی شد." : "کپی پیوند ممکن نبود.", ok ? "success" : "error");
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
        ? buildWorklist(customers, dueReminders, districtProps, viewBounds, new Date().toISOString().slice(0, 10))
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
      mapRef.current.flyTo([c.lat, c.lng], 15, { duration: 1 });
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
  const colourOrigin = useMemo(
    () =>
      initialFacilities.find((f) => f.is_default_origin === 1) ??
      initialFacilities.find((f) => f.kind === "home_base") ??
      initialFacilities[0] ??
      null,
    [initialFacilities]
  );

  const corridorEnds = useMemo(() => {
    if (initialFacilities.length < 2) return null;
    let best: { a: FacilityRow; b: FacilityRow; km: number } | null = null;
    for (let i = 0; i < initialFacilities.length; i++) {
      for (let j = i + 1; j < initialFacilities.length; j++) {
        const km = distanceKm(initialFacilities[i], initialFacilities[j]);
        if (!best || km > best.km) best = { a: initialFacilities[i], b: initialFacilities[j], km };
      }
    }
    return best;
  }, [initialFacilities]);

  /* ---- The corridor follows the road, not the crow.

     Drawn as a straight band between the two depots, the corridor claimed a stretch of
     city nobody drives through and disowned the districts along the road that actually
     joins them -- which is the whole question it exists to answer. So the route is
     fetched once and everything downstream is computed against the road geometry.

     The straight line survives as the fallback, and the sidebar says which one is on
     screen: a corridor quietly drawn down the wrong streets is worse than one that
     admits it could not reach the router. ---- */
  const corridorKey = corridorEnds ? `${corridorEnds.a.id}-${corridorEnds.b.id}` : null;

  /** What came back, and which pair of depots it came back for. Storing the two together
   *  means "still routing" is derived from them rather than kept as a second flag that
   *  could disagree -- and an answer for a pair of depots that are no longer the corridor
   *  reads as absent instead of as a stale road. */
  const [corridorAnswer, setCorridorAnswer] = useState<{ key: string; route: DrivingRoute | null } | null>(null);

  useEffect(() => {
    if (!corridorOn || !corridorEnds || !corridorKey) return;
    if (corridorAnswer?.key === corridorKey) return;

    const controller = new AbortController();
    let live = true;
    fetchDrivingRoute(corridorEnds.a, corridorEnds.b, controller.signal).then((route) => {
      if (live) setCorridorAnswer({ key: corridorKey, route });
    });
    return () => {
      live = false;
      controller.abort();
    };
    // Only the endpoints change the road. Widening the band re-measures against the same
    // route rather than asking for it again.
  }, [corridorOn, corridorEnds, corridorKey, corridorAnswer]);

  // Fetched only once either zone is asked for, so a map nobody switches them on never
  // pays for the file.
  const { zones: trafficZones, status: zoneStatus } = useTrafficZones(
    layers.traffic_zone || layers.low_emission
  );

  const corridorRoute = corridorAnswer?.key === corridorKey ? corridorAnswer.route : null;
  const corridorRouting = corridorOn && corridorKey !== null && corridorAnswer?.key !== corridorKey;

  const corridorPath = useMemo<LatLng[]>(() => {
    if (corridorRoute) return corridorRoute.path;
    if (corridorEnds) {
      return [
        { lat: corridorEnds.a.lat, lng: corridorEnds.a.lng },
        { lat: corridorEnds.b.lat, lng: corridorEnds.b.lng },
      ];
    }
    return [];
  }, [corridorRoute, corridorEnds]);

  const corridorBand = useMemo(
    () => corridorBandFromPath(corridorPath, corridorWidthKm),
    [corridorPath, corridorWidthKm]
  );

  /** District ids whose centre falls inside the band. Districts with no centroid are
   *  absent rather than assumed outside -- they simply cannot be judged.
   *
   *  Measured against the route itself rather than tested inside the drawn polygon: the
   *  distance is exact through every bend, while the polygon is an approximation that can
   *  cross itself at a hairpin. */
  const corridorDistrictIds = useMemo(() => {
    if (!corridorOn || corridorPath.length < 2) return null;
    const ids = new Set<number>();
    for (const d of districtProps) {
      if (d.centroid_lat === null || d.centroid_lng === null) continue;
      if (distanceToPathKm({ lat: d.centroid_lat, lng: d.centroid_lng }, corridorPath) <= corridorWidthKm) {
        ids.add(d.id);
      }
    }
    return ids;
  }, [corridorOn, corridorPath, corridorWidthKm, districtProps]);

  /* Declared after corridorDistrictIds, not before it.
   *
   * This is only ever called by react-leaflet while rendering the GeoJSON layers, by
   * which point the memo above has been evaluated -- but read top-down it referenced a
   * const from further down the file, which react-hooks/immutability flags and which
   * made the compiler skip optimising this whole component. Moving the declaration is
   * pure code motion: function declarations hoist, so nothing about when it can be
   * called changes. */
  function districtStyle(feature?: DistrictFeature) {
    const status = (feature?.properties.coverage_status ?? "unknown") as CoverageStatus;
    /* "unknown" takes the themed neutral rather than the fixed one. It is 429 of the 439
       districts, so it is not really a status colour at all -- it is what the map looks
       like, and it is the single biggest reason the map read as warm regardless of which
       accent was chosen. visited/needs_coverage/not_allowed keep STATUS_COLOR untouched:
       those three carry meaning shared with /report and /analytics.
       The legend follows the same rule -- see the swatch in the districts panel. */
    const fill =
      districtColorMode === "group"
        ? districtGroupColor(feature?.properties.group_id ?? null, groupColors)
        : status === "unknown"
          ? ink.unknown
          : STATUS_COLOR[status];
    const level = feature?.properties.level === "mantaghe" ? "mantaghe" : "mahalle";
    const selected = !!feature && bulkSelectedIds.has(feature.properties.id);

    // With the corridor on, districts off it recede rather than disappear: the point is
    // to show what sits near the drive *in context*, and a map that hides everything
    // else can't be read as a map any more.
    const inCorridor = !corridorDistrictIds || (!!feature && corridorDistrictIds.has(feature.properties.id));
    const dim = corridorDistrictIds && !inCorridor ? 0.25 : 1;

    return {
      color: selected ? ink.selected : level === "mantaghe" ? ink.strokeMajor : ink.strokeMinor,
      weight: selected ? 3 : level === "mantaghe" ? 1.5 : 1,
      fillColor: fill,
      // Territory reads as a filled area rather than a tint: in group mode the fill is the
      // whole point, where in status mode it sits under markers that have to stay legible.
      fillOpacity: (selected ? 0.55 : districtColorMode === "group" ? 0.45 : level === "mantaghe" ? 0.08 : 0.35) * dim,
      opacity: (selected ? 1 : level === "mantaghe" ? 0.5 : 0.8) * dim,
      dashArray: selected ? "4 3" : undefined,
    };
  }

  const corridorUncovered = useMemo(() => {
    if (!corridorDistrictIds) return 0;
    return districtProps.filter((d) => corridorDistrictIds.has(d.id) && d.coverage_status === "needs_coverage").length;
  }, [corridorDistrictIds, districtProps]);

  /** A customer's marker colour under the active mode. Extracted because the selected
   *  customer is rendered separately from the rest and both must agree. */
  function markerColor(c: CustomerRow): string {
    if (colorMode === "debt") return debtColor(c.debt);
    if (colorMode === "salesperson") return salespersonColor(c.salesperson, salesIndex);
    if (colorMode === "inactivity") return inactivityColor(c);
    if (colorMode === "distance") return distanceColor(c, colourOrigin);
    return customerLifecycleColor(c.lifecycle);
  }

  function flyToFacility(f: FacilityRow) {
    mapRef.current?.flyTo([f.lat, f.lng], 15, { duration: 1 });
  }

  function flyToDistrict(d: DistrictFeature) {
    setSelectedDistrict(d);
    if (!mapRef.current) return;
    try {
      const bounds = geoJSON(d as unknown as GeoJSON.Feature).getBounds();
      mapRef.current.flyToBounds(bounds, { padding: [60, 60], duration: 1 });
    } catch {
      // malformed geometry -- selection still opens the editor, just skip the fly
    }
  }

  function handleLocationFound(lat: number, lng: number, label: string) {
    setFoundLocation({ lat, lng, label });
    mapRef.current?.flyTo([lat, lng], 16, { duration: 1 });
  }

  /** A panel is up and is the thing being read. Map chrome stands down for it. */
  const panelOwnsScreen = selectedCustomer !== null || selectedDistrict !== null || layersOpen;

  // Redundant over a basemap that already prints its own names, and drawing both puts two
  // slightly different label sets on top of each other.
  const showLabels = layers.labels && !activeBasemap.hasLabels;

  /* Which basemaps have had their vector renderer fail this session. Kept per id rather
     than as one flag so a single broken style does not condemn the others, and not
     persisted: a WebGL context lost to a backgrounded tab comes back on reload. */
  const [vectorFailed, setVectorFailed] = useState<ReadonlySet<BasemapId>>(new Set());
  const vectorStyle =
    activeBasemap.styleUrl && !vectorFailed.has(activeBasemap.id) ? activeBasemap.styleUrl : null;
  const handleVectorError = useCallback(() => {
    setVectorFailed((prev) => (prev.has(basemap) ? prev : new Set(prev).add(basemap)));
  }, [basemap]);
  /* The raster to draw when this basemap is not being drawn as vector -- either it never
     was one, or its renderer failed and the fallback is standing in. */
  const rasterTiles = activeBasemap.styleUrl
    ? { ...(activeBasemap.rasterFallback ?? QUIET_TILES), key: `${activeBasemap.id}-raster` }
    : {
        url: activeBasemap.url,
        attribution: activeBasemap.attribution,
        subdomains: activeBasemap.subdomains,
        maxZoom: activeBasemap.maxZoom,
        toneClass: activeBasemap.toneClass,
        key: activeBasemap.id,
      };
  const shownZones = useMemo(() => {
    const on = new Set<string>();
    if (layers.traffic_zone) on.add("limited_traffic");
    if (layers.low_emission) on.add("low_emission");
    return on;
  }, [layers.traffic_zone, layers.low_emission]);

  return (
    /* The `meridian` scope used to be rooted HERE, because the map was the one surface
       that did not sit inside it. app/(shell)/layout.tsx now provides it, and repeating
       it would be a nested copy that redefines --bg back to the light value -- defeating
       the [data-surface="map"] override that keeps this canvas dark under a light skin.
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
            <button type="button" className="mapbtn mapbtn--sm" onClick={shareView} aria-label="کپی پیوند این نما" title="کپی پیوند این نما">
              <Icon name="link" size="sm" />
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
                className="rounded-[var(--radius-sm)] border border-border px-2 py-0.5 text-text-muted transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:border-accent hover:text-accent"
              >
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
            <input
              ref={sectionFilterRef}
              value={sectionFilter}
              onChange={(e) => setSectionFilter(e.target.value)}
              placeholder="فیلتر بخش‌ها…"
              aria-label="فیلتر بخش‌های پنل"
              className="w-full rounded-[var(--radius-md)] border border-border bg-surface py-1.5 pe-2 ps-7 text-[length:var(--text-xs)] text-text outline-none transition-[border-color] duration-[var(--dur-base)] ease-[var(--ease-out)] placeholder:text-text-faint focus:border-accent"
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

        {dueReminders.length > 0 && (
          <CollapsibleSection
            title="یادآوری‌های امروز" icon="bell"
            count={dueReminders.length}
            defaultOpen
          >
            <div className="flex flex-col gap-1.5">
              {dueReminders.map((r) => (
                <div
                  key={r.id}
                  className="flex items-start gap-2 rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2"
                >
                  <button
                    onClick={() => openReminderEntity(r)}
                    className="flex-1 text-right text-[length:var(--text-sm)] text-text hover:text-accent"
                  >
                    <div className="font-medium">{r.label}</div>
                    <div className="text-[length:var(--text-xs)] text-text-muted">{r.message}</div>
                  </button>
                  <button
                    onClick={() => resolveReminder(r.id)}
                    aria-label="انجام شد"
                    className="shrink-0 text-good hover:opacity-80"
                  >
                    <Icon name="check" size="sm" />
                  </button>
                </div>
              ))}
            </div>
          </CollapsibleSection>
        )}

        {myPosition && (
          <CollapsibleSection
            title="مشتریان نزدیک" icon="map-pin"
            count={nearbyCustomers.length}
            defaultOpen
            right={
              /* In the header rather than the body: changing the radius is how you
                 decide whether this section is worth opening at all. */
              <select
                value={nearbyRadiusKm}
                onChange={(e) => setNearbyRadiusKm(Number(e.target.value))}
                aria-label="شعاع جستجوی مشتریان نزدیک"
                className="rounded-[var(--radius-sm)] border border-border bg-surface px-1.5 py-0.5 text-[length:var(--text-xs)] text-text-muted outline-none focus:border-accent"
              >
                <option value={1}>۱ کیلومتر</option>
                <option value={2}>۲ کیلومتر</option>
                <option value={5}>۵ کیلومتر</option>
              </select>
            }
          >
            {nearbyCustomers.length === 0 ? (
              <p className="text-[length:var(--text-xs)] text-text-faint">مشتری‌ای در این شعاع پیدا نشد.</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {nearbyCustomers.map(({ customer, km }) => (
                  <button
                    key={customer.id}
                    onClick={() => flyToCustomer(customer)}
                    className="flex w-full items-center justify-between gap-2 rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2 text-right transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:border-accent"
                  >
                    <span className="truncate text-[length:var(--text-sm)] text-text">{customer.business_name}</span>
                    <span className="shrink-0 font-mono text-[length:var(--text-xs)] text-accent">
                      {formatDistanceKm(km)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </CollapsibleSection>
        )}

        {pinnedCustomers.length > 0 && (
          <CollapsibleSection title="سنجاق‌شده" icon="star" count={pinnedCustomers.length} storageKey="pinned" defaultOpen>
            <div className="flex flex-col gap-1.5">
              {pinnedCustomers.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center gap-1 rounded-[var(--radius-md)] border border-border bg-surface px-2 py-2"
                >
                  <button
                    onClick={() => flyToCustomer(c)}
                    className="min-w-0 flex-1 truncate text-right text-[length:var(--text-sm)] text-text transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:text-accent"
                  >
                    {c.business_name}
                  </button>
                  <button
                    onClick={() => togglePinned(c.id)}
                    aria-label={`برداشتن سنجاق ${c.business_name}`}
                    title="برداشتن سنجاق"
                    className="shrink-0 text-accent transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:text-crit"
                  >
                    <Icon name="star" size="sm" />
                  </button>
                </div>
              ))}
            </div>
          </CollapsibleSection>
        )}

        {recentCustomers.length > 0 && (
          <CollapsibleSection title="اخیراً دیده‌شده" icon="clock" count={recentCustomers.length} storageKey="recent">
            <div className="flex flex-col gap-1.5">
              {recentCustomers.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center gap-1 rounded-[var(--radius-md)] border border-border bg-surface px-2 py-2"
                >
                  <button
                    onClick={() => flyToCustomer(c)}
                    className="min-w-0 flex-1 truncate text-right text-[length:var(--text-sm)] text-text transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:text-accent"
                  >
                    {c.business_name}
                  </button>
                  <button
                    onClick={() => togglePinned(c.id)}
                    aria-label={`سنجاق کردن ${c.business_name}`}
                    title="سنجاق کردن"
                    className="shrink-0 text-text-faint transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:text-accent"
                  >
                    <Icon name="star" size="sm" />
                  </button>
                </div>
              ))}
            </div>
          </CollapsibleSection>
        )}

        <CustomerFilters
          salespeople={salespeople}
          salespersonFilter={salespersonFilter}
          onSalespersonFilterChange={setSalespersonFilter}
          totalCount={customers.length}
          filteredCount={filteredCustomers.length}
        />

        <CollapsibleSection title="رنگ‌بندی مشتریان" icon="palette" storageKey="colour" keywords="وضعیت بدهی فروشنده رکود فاصله">
            {/* Five modes no longer fit a single row at sidebar width on a phone, so this
                is a grid rather than a flex row -- the fifth would otherwise squeeze the
                other four into unreadable slivers. */}
            <div className="grid grid-cols-3 gap-1 rounded-[var(--radius-md)] border border-border bg-surface p-1">
              {(
                [
                  ["status", "وضعیت"],
                  ["debt", "بدهی"],
                  ["salesperson", "فروشنده"],
                  ["inactivity", "رکود"],
                  ["distance", "فاصله"],
                ] as [CustomerColorMode, string][]
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  onClick={() => setColorMode(mode)}
                  disabled={mode === "distance" && !colourOrigin}
                  className={`rounded-[var(--radius-sm)] px-0.5 py-1.5 text-[length:var(--text-xs)] transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] disabled:opacity-40 ${
                    colorMode === mode
                      ? "bg-accent font-medium text-accent-ink"
                      : "text-text-muted hover:bg-white/5 hover:text-text"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Without this the map is unreadable in distance mode -- the legend below
                explains district colours only, and the same three hues mean something
                entirely different on the markers. */}
            {colorMode === "distance" && colourOrigin && (
              <div className="mt-2 flex flex-col gap-1.5">
                <p className="font-mono text-[length:var(--text-xs)] leading-5 text-text-faint">
                  فاصله از {colourOrigin.name} — خط مستقیم
                </p>
                {DISTANCE_BANDS.map((band) => (
                  <StatusPill key={band.label} color={band.color} label={band.label} shaped={shapedMarkers} />
                ))}
              </div>
            )}
        </CollapsibleSection>

        {/* Always present, unlike before: a section that disappears when it is empty
            cannot be distinguished from a section that is broken, and "no dormant
            customers" is itself worth knowing. The count in the heading answers it
            without opening. */}
        <CollapsibleSection
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
            <EmptyState icon="check" title="هیچ مشتری فعالی بیش از ۳۰ روز بدون خرید نیست" className="py-4" />
          ) : (
            <div className="flex max-h-72 flex-col gap-1.5 overflow-y-auto">
              {dormantCustomers.map(({ customer, days }) => (
                <button
                  key={customer.id}
                  onClick={() => flyToCustomer(customer)}
                  className="flex w-full items-center justify-between gap-2 rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2 text-right transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:border-accent"
                >
                  <span className="truncate text-[length:var(--text-sm)] text-text">{customer.business_name}</span>
                  <span
                    className="shrink-0 font-mono text-[length:var(--text-xs)]"
                    style={{ color: days > 60 ? "var(--crit)" : "var(--warn)" }}
                  >
                    {faNum(days)} روز
                  </span>
                </button>
              ))}
            </div>
          )}
        </CollapsibleSection>

        <CollapsibleSection
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
                <button
                  key={customer.id}
                  onClick={() => flyToCustomer(customer)}
                  className="flex w-full items-center justify-between gap-2 rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2 text-right transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:border-accent"
                >
                  <span className="truncate text-[length:var(--text-sm)] text-text">{customer.business_name}</span>
                  <span className="shrink-0 text-[length:var(--text-xs)] text-text-faint">
                    {customer.phone ?? "—"}
                  </span>
                </button>
              ))}
              <p className="mt-1.5 text-[length:var(--text-xs)] leading-5 text-text-faint">
                روی نام کلیک کنید تا جزئیات مشتری باز شود و بتوانید مختصات را بررسی کنید.
              </p>
            </div>
          )}
        </CollapsibleSection>

        {/* The two silhouettes are repeated here at marker size, not described in words:
            the legend's job is to teach the shape the user will actually look for. */}
        <CollapsibleSection title="تأسیسات ما" icon="building" storageKey="sites" keywords="انبار مبدأ خانه کریدور depot">
            <div className="flex flex-col gap-1">
              {initialFacilities.map((f) => (
                <button
                  key={f.id}
                  onClick={() => flyToFacility(f)}
                  className="flex items-center gap-2.5 rounded-[var(--radius-sm)] px-1.5 py-1.5 text-right transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:bg-white/5"
                >
                  <span
                    className="shrink-0"
                    aria-hidden="true"
                    dangerouslySetInnerHTML={{
                      __html: `<span class="facility-marker${f.kind === "home_base" ? " facility-marker--home" : ""}">${FACILITY_ART[f.kind].html}</span>`,
                    }}
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-[length:var(--text-sm)] text-text">{f.name}</span>
                    {f.notes && (
                      <span className="block truncate text-[length:var(--text-xs)] text-text-faint">{f.notes}</span>
                    )}
                  </span>
                </button>
              ))}
            </div>
            {initialFacilities.length === 2 && (
              <p className="mt-2 font-mono text-[length:var(--text-xs)] leading-5 text-text-faint">
                {formatDistanceKm(distanceKm(initialFacilities[0], initialFacilities[1]))} فاصله مستقیم بین دو انبار
              </p>
            )}

            {/* Feature 3. Lives under the sites section because the corridor is a property
                of the sites, not a separate map layer the user has to connect back to them. */}
            {corridorEnds && (
              <div className="mt-3 border-t border-border pt-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[length:var(--text-sm)] text-text">کریدور بین انبارها</span>
                  {!corridorOn && <LayerHint onOpen={() => setLayersOpen(true)} what="کریدور" compact />}
                </div>

                {corridorOn && (
                  <>
                    <div className="mt-2 flex gap-1 rounded-[var(--radius-md)] border border-border bg-surface p-1">
                      {CORRIDOR_WIDTHS.map((km) => (
                        <button
                          key={km}
                          onClick={() => {
                            setCorridorWidthKm(km);
                            localStorage.setItem("coverage_corridor_km", String(km));
                          }}
                          className={`flex-1 rounded-[var(--radius-sm)] px-0.5 py-1.5 font-mono text-[length:var(--text-xs)] transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] ${
                            corridorWidthKm === km
                              ? "bg-accent font-medium text-accent-ink"
                              : "text-text-muted hover:bg-white/5 hover:text-text"
                          }`}
                        >
                          {km} کیلومتر
                        </button>
                      ))}
                    </div>
                    <p className="mt-2 text-[length:var(--text-xs)] leading-5 text-text-faint">
                      <span>
                        مسیر {corridorEnds.a.name} تا {corridorEnds.b.name} (
                        {formatDistanceKm(corridorRoute ? corridorRoute.km : corridorEnds.km)}
                        {corridorRoute ? "، روی جاده" : corridorRouting ? "، در حال مسیریابی…" : "، خط مستقیم"}
                        ).
                      </span>{" "}
                      <span>
                        {corridorUncovered > 0
                          ? `${faNum(corridorUncovered)} منطقه نیازمند پوشش سر این راه است.`
                          : "منطقه نیازمند پوششی سر این راه نیست."}
                      </span>
                      {!corridorRoute && !corridorRouting && (
                        <span className="mt-1 block text-warn">
                          مسیریاب در دسترس نبود — نوار روی خط مستقیم بین دو نقطه کشیده شده، نه روی جاده.
                        </span>
                      )}
                    </p>
                  </>
                )}
              </div>
            )}
        </CollapsibleSection>

        <CollapsibleSection title="راهنمای رنگ مناطق" icon="map" storageKey="legend" keywords="وضعیت پوشش رنگ گروه محدوده legend">
            {/* One meaning at a time. The fill cannot say both "needs coverage" and
                "belongs to گروه غرب" at once without an amber district being ambiguous,
                so the mode switches and the legend below switches with it. Hidden
                entirely when there are no groups yet -- a switch with one option is
                just clutter. */}
            {groups.length > 0 && (
              <div className="mb-2 grid grid-cols-2 gap-1 rounded-[var(--radius-md)] border border-border bg-surface p-1">
                {(
                  [
                    ["status", "وضعیت پوشش"],
                    ["group", "گروه"],
                  ] as [DistrictColorMode, string][]
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    onClick={() => setDistrictColorMode(mode)}
                    className={`rounded-[var(--radius-sm)] px-0.5 py-1.5 text-[length:var(--text-xs)] transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] ${
                      districtColorMode === mode
                        ? "bg-accent font-medium text-accent-ink"
                        : "text-text-muted hover:bg-white/5 hover:text-text"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              {districtColorMode === "group" ? (
                <>
                  {groups.map((g) => (
                    <StatusPill
                      key={g.id}
                      color={g.color ?? STATUS_COLOR.unknown}
                      label={g.name}
                      shaped={shapedMarkers}
                    />
                  ))}
                  <StatusPill color={STATUS_COLOR.unknown} label="بدون گروه" shaped={shapedMarkers} />
                </>
              ) : (
                (Object.keys(STATUS_LABEL) as CoverageStatus[]).map((s) => (
                  <StatusPill key={s} color={STATUS_COLOR[s]} label={STATUS_LABEL[s]} shaped={shapedMarkers} />
                ))
              )}
            </div>
            <p className="mt-2 text-[length:var(--text-xs)] leading-5 text-text-faint">
              {bulkMode
                ? "روی چند منطقه کلیک کنید تا انتخاب شوند، سپس از نوار پایین صفحه تغییر را روی همه اعمال کنید."
                : "برای تغییر وضعیت یک منطقه، روی آن در نقشه کلیک کنید."}
            </p>
        </CollapsibleSection>

        {/* Switching it on lives in the layers panel with every other layer; how it is
            weighted is a property of the layer, and belongs next to the data it weights. */}
        <CollapsibleSection title="نقشه حرارتی" icon="flame" storageKey="heatmap" keywords="تراکم بدهی heatmap لایه">
            {heatmapOn ? (
              <label className="flex items-center gap-2 text-[length:var(--text-sm)] text-text-muted">
                <input
                  type="checkbox"
                  checked={heatmapByDebt}
                  onChange={(e) => setHeatmapByDebt(e.target.checked)}
                  className="accent-[color:var(--accent)]"
                />
                وزن‌دهی بر اساس شدت بدهی
              </label>
            ) : (
              <LayerHint onOpen={() => setLayersOpen(true)} what="نقشه حرارتی" />
            )}
        </CollapsibleSection>

        <CollapsibleSection title="تنظیمات" icon="settings" storageKey="settings" keywords="GPS موقعیت ژئوفنس اعلان نوتیفیکیشن دقت مرز انتخاب گروهی توقف بعدی شکل کوررنگی رنگ نابینایی رانندگی بزرگ درشت مسیریابی نشان بلد ویز گوگل">
          <div className="flex flex-col gap-4">

            <div className="flex items-center justify-between gap-2">
              <div>
                <span className="text-[length:var(--text-sm)] text-text">ثبت خودکار بازدید (GPS)</span>
                <p className="text-[length:var(--text-xs)] text-text-faint">وقتی نزدیک مشتری هستید پیشنهاد ثبت بازدید نمایش داده می‌شود</p>
              </div>
              <button
                onClick={() => setGeofenceOn((v) => !v)}
                role="switch"
                aria-checked={geofenceOn}
                aria-label="ثبت خودکار بازدید"
                className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] ${
                  geofenceOn ? "border-accent bg-accent" : "border-border bg-surface"
                }`}
              >
                <span
                  className="absolute top-0.5 h-4 w-4 rounded-full bg-[color:var(--bg)] transition-[right,left] duration-[var(--dur-base)] ease-[var(--ease-out)]"
                  style={{ right: geofenceOn ? "calc(100% - 1.25rem)" : "0.125rem" }}
                />
              </button>
            </div>

            {/* A sub-option, not a sibling switch: it rides the same permission, the same
                position stream and the same battery cost as the toggle above, and
                presenting it as independent would imply otherwise. */}
            {geofenceOn && (
              <label className="mt-2 flex items-start gap-2 text-[length:var(--text-xs)] leading-5 text-text-muted">
                <input
                  type="checkbox"
                  checked={facilityGeofenceOn}
                  onChange={(e) => {
                    setFacilityGeofenceOn(e.target.checked);
                    localStorage.setItem("coverage_geofence_sites", e.target.checked ? "1" : "0");
                  }}
                  className="mt-0.5 accent-[color:var(--accent)]"
                />
                <span>
                  ثبت حضور در انبارها و مبدأ
                  <span className="block text-text-faint">
                    رسیدن به انبار یا مبدأ هم ثبت می‌شود — مبنای گزارش ساعت کاری روزانه
                  </span>
                </span>
              </label>
            )}

            <div className="flex items-center justify-between gap-2">
              <div>
                <span className="text-[length:var(--text-sm)] text-text">حالت رانندگی</span>
                <p className="text-[length:var(--text-xs)] leading-5 text-text-faint">
                  متن و دکمه‌ها بزرگ‌تر می‌شوند — برای استفاده با یک دست داخل خودرو
                </p>
              </div>
              <button
                onClick={() => {
                  const next = !driverMode;
                  setDriverMode(next);
                  localStorage.setItem("coverage_driver_mode", next ? "1" : "0");
                }}
                role="switch"
                aria-checked={driverMode}
                aria-label="حالت رانندگی"
                className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] ${
                  driverMode ? "border-accent bg-accent" : "border-border bg-surface"
                }`}
              >
                <span
                  className="absolute top-0.5 h-4 w-4 rounded-full bg-[color:var(--bg)] transition-[right,left] duration-[var(--dur-base)] ease-[var(--ease-out)]"
                  style={{ right: driverMode ? "calc(100% - 1.25rem)" : "0.125rem" }}
                />
              </button>
            </div>

            <div className="flex items-center justify-between gap-2">
              <div>
                <span className="text-[length:var(--text-sm)] text-text">نشانگرهای شکل‌دار</span>
                <p className="text-[length:var(--text-xs)] leading-5 text-text-faint">
                  به جای تکیه بر رنگ سبز/نارنجی/قرمز، هر وضعیت شکل خودش را می‌گیرد — دایره، مثلث، مربع
                </p>
              </div>
              <button
                onClick={() => {
                  const next = !shapedMarkers;
                  setShapedMarkers(next);
                  localStorage.setItem("coverage_shaped_markers", next ? "1" : "0");
                }}
                role="switch"
                aria-checked={shapedMarkers}
                aria-label="نشانگرهای شکل‌دار"
                className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] ${
                  shapedMarkers ? "border-accent bg-accent" : "border-border bg-surface"
                }`}
              >
                <span
                  className="absolute top-0.5 h-4 w-4 rounded-full bg-[color:var(--bg)] transition-[right,left] duration-[var(--dur-base)] ease-[var(--ease-out)]"
                  style={{ right: shapedMarkers ? "calc(100% - 1.25rem)" : "0.125rem" }}
                />
              </button>
            </div>

            <div className="flex items-center justify-between gap-2">
              <div>
                <span className="text-[length:var(--text-sm)] text-text">نوار توقف بعدی</span>
                <p className="text-[length:var(--text-xs)] text-text-faint">
                  توقف بعدی برنامه امروز را پایین نقشه نشان می‌دهد
                </p>
              </div>
              <button
                onClick={() => {
                  const next = !nextStopOn;
                  setNextStopOn(next);
                  localStorage.setItem("coverage_nextstop_off", next ? "0" : "1");
                }}
                role="switch"
                aria-checked={nextStopOn}
                aria-label="نوار توقف بعدی"
                className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] ${
                  nextStopOn ? "border-accent bg-accent" : "border-border bg-surface"
                }`}
              >
                <span
                  className="absolute top-0.5 h-4 w-4 rounded-full bg-[color:var(--bg)] transition-[right,left] duration-[var(--dur-base)] ease-[var(--ease-out)]"
                  style={{ right: nextStopOn ? "calc(100% - 1.25rem)" : "0.125rem" }}
                />
              </button>
            </div>

            <div className="flex items-center justify-between gap-2">
              <div>
                <span className="text-[length:var(--text-sm)] text-text">انتخاب چندتایی مناطق</span>
                <p className="text-[length:var(--text-xs)] text-text-faint">برای ویرایش‌های گروهی روی دسکتاپ</p>
              </div>
              <button
                onClick={() => {
                    /* Leaving bulk mode drops the selection. Said at the click rather
                       than in an effect on [bulkMode]: an effect renders once with the
                       stale selection still highlighted and then again without it, which
                       is what react-hooks/set-state-in-effect is about. This is the only
                       place bulkMode changes. */
                    if (bulkMode) setBulkSelectedIds(new Set());
                    setBulkMode((v) => !v);
                  }}
                role="switch"
                aria-checked={bulkMode}
                aria-label="حالت انتخاب چندتایی مناطق"
                className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] ${
                  bulkMode ? "border-accent bg-accent" : "border-border bg-surface"
                }`}
              >
                <span
                  className="absolute top-0.5 h-4 w-4 rounded-full bg-[color:var(--bg)] transition-[right,left] duration-[var(--dur-base)] ease-[var(--ease-out)]"
                  style={{ right: bulkMode ? "calc(100% - 1.25rem)" : "0.125rem" }}
                />
              </button>
            </div>

            <div>

              {/* Phase 2 moved every notification control — subscribing this device, quiet
                  hours, and the per-type opt-in matrix — to one screen. A toggle here would
                  only ever be a third of that story. */}
              <Link
                href="/settings/notifications"
                className="flex items-center justify-between gap-2 text-[length:var(--text-sm)] text-text hover:text-accent"
              >
                <span>تنظیمات اعلان‌ها</span>
                <Icon name="arrow-up-right" size="sm" />
              </Link>

            </div>

            <NavAppSetting />

            <div>

              <p className="mb-2 font-mono text-[length:var(--text-xs)] uppercase tracking-wide text-text-faint">
                دقت مرز مناطق
              </p>

              <div className="flex gap-1 rounded-[var(--radius-md)] border border-border bg-surface p-1">
                {(
                  [
                    ["auto", "خودکار"],
                    ["low", "سریع"],
                    ["high", "دقیق"],
                  ] as [PrecisionMode, string][]
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    onClick={() => setPrecisionMode(mode)}
                    className={`flex-1 rounded-[var(--radius-sm)] px-0.5 py-1.5 text-[length:var(--text-xs)] transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] ${
                      precisionMode === mode
                        ? "bg-accent font-medium text-accent-ink"
                        : "text-text-muted hover:bg-white/5 hover:text-text"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[length:var(--text-xs)] leading-5 text-text-faint">
                {precisionMode === "auto"
                  ? `خودکار: در بزرگ‌نمایی کم مرزهای ساده‌شده و سبک، از بزرگ‌نمایی ${faNum(PRECISION_AUTO_ZOOM)} به بالا مرزهای کامل. (اکنون: ${activeTier === "high" ? "دقیق" : "سریع"})`
                  : precisionMode === "low"
                    ? "همیشه مرزهای ساده‌شده — سبک‌ترین حالت برای اینترنت ضعیف."
                    : "همیشه مرزهای کامل — دقیق‌تر ولی سنگین‌تر."}
              </p>

            </div>

          </div>
        </CollapsibleSection>

        {/* Last in the panel on purpose: a driver never needs this, and it would be
            competing with the things they do. */}
        <button
          onClick={() => setShowShortcuts(true)}
          className="self-start font-mono text-[length:var(--text-xs)] uppercase tracking-wide text-text-faint transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:text-accent"
        >
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
        <MapContainer
          center={startView ? [startView.lat, startView.lng] : TEHRAN_CENTER}
          zoom={startView?.zoom ?? 11}
          className="h-full w-full"
          ref={mapRef}
          // ~430 district polygons as individual SVG <path> nodes is the single most
          // expensive thing on this page: the browser has to build, lay out and style
          // that many elements before the first frame, then re-transform all of them on
          // every pan. The canvas renderer draws them into one element instead. Tooltips
          // and click handling work the same; only per-path CSS would be lost, and the
          // polygons are styled entirely through Leaflet's own style options.
          preferCanvas
        >
          {/* A vector style draws through MapLibre; everything else is a raster tile
              layer. If MapLibre cannot run -- no WebGL, or the chunk fails -- the style's
              declared raster fallback takes over, so the ground is never empty.

              Keyed on the basemap: react-leaflet updates a TileLayer's url in place, and
              swapping between providers with different subdomain rules leaves the old
              rotation behind. Remounting is cheap and always right. */}
          {vectorStyle ? (
            <VectorBasemap
              key={activeBasemap.id}
              styleUrl={vectorStyle}
              attribution={activeBasemap.attribution}
              onError={handleVectorError}
            />
          ) : (
            <TileLayer
              key={rasterTiles.key}
              attribution={rasterTiles.attribution}
              url={rasterTiles.url}
              subdomains={rasterTiles.subdomains ?? "abc"}
              maxZoom={rasterTiles.maxZoom}
              /* A tone is baked on only for the styles that have no hosted tiles of their
                 own (see globals.css). Hosted styles arrive already designed and must not
                 be recoloured. */
              className={rasterTiles.toneClass}
            />
          )}

          {/* Names go in their own pane above the district fills (overlayPane, 400) and
              below the markers (600). In the tile pane they would be tinted by every
              coverage colour drawn over them, which is most of the city.

              Esri's reference labels, drawn light for a dark ground -- see
              lib/mapLayers.ts. Only satellite still needs them; the other two basemaps
              are OpenStreetMap and carry their own names. */}
          {showLabels && (
            <Pane name="labels" style={{ zIndex: 450, pointerEvents: "none" }}>
              <TileLayer
                url={LABELS_TILE.url}
                attribution={LABELS_TILE.attribution}
                subdomains={LABELS_TILE.subdomains}
                maxZoom={LABELS_TILE.maxZoom}
                className="tiles-labels"
              />
            </Pane>
          )}

          <TrafficZoneLayer
            zones={trafficZones}
            status={zoneStatus}
            show={shownZones}
            ground={activeBasemap.ground}
          />

          {layers.districts && mantagheFeatures && (
            <GeoJSON
              key={`mantaghe-${districtsVersion}-${activeTier}-${corridorOn ? corridorWidthKm : "off"}`}
              data={mantagheFeatures as unknown as GeoJSONProps["data"]}
              style={districtStyle as unknown as GeoJSONProps["style"]}
              onEachFeature={onEachDistrict as unknown as GeoJSONProps["onEachFeature"]}
            />
          )}
          {layers.districts && mahalleFeatures && (
            <GeoJSON
              key={`mahalle-${districtsVersion}-${activeTier}-${corridorOn ? corridorWidthKm : "off"}`}
              data={mahalleFeatures as unknown as GeoJSONProps["data"]}
              style={districtStyle as unknown as GeoJSONProps["style"]}
              onEachFeature={onEachDistrict as unknown as GeoJSONProps["onEachFeature"]}
            />
          )}
          {cityBoundary && (
            <GeoJSON
              data={cityBoundary as unknown as GeoJSONProps["data"]}
              interactive={false}
              style={{ color: ink.boundary, weight: 2, dashArray: "6 5", fill: false, opacity: 0.85 }}
            />
          )}

          {/* Feature 3 + 14b: the band, and the dashed line down its middle that makes it
              read as a route rather than an arbitrary rectangle. Non-interactive so it
              never swallows a click meant for a district underneath. */}
          {corridorOn && corridorEnds && corridorBand.length > 0 && (
            <>
              {/* A 7% fill and a half-opacity edge were tuned against a near-black
                  ground; over a cream basemap the band all but disappears. Same colour,
                  carried harder -- the corridor still reads as one thing on both. */}
              <Polygon
                positions={corridorBand}
                interactive={false}
                pathOptions={{
                  color: FACILITY_COLOR,
                  weight: 1,
                  opacity: activeBasemap.ground === "light" ? 0.75 : 0.5,
                  fillColor: FACILITY_COLOR,
                  fillOpacity: activeBasemap.ground === "light" ? 0.13 : 0.07,
                }}
              />
              <Polyline
                positions={corridorPath.map((p) => [p.lat, p.lng] as [number, number])}
                interactive={false}
                pathOptions={{
                  color: FACILITY_COLOR,
                  weight: 2,
                  opacity: activeBasemap.ground === "light" ? 0.9 : 0.75,
                  dashArray: "8 6",
                }}
              />
            </>
          )}

          {heatmapOn && <HeatmapLayer customers={filteredCustomers} weightByDebt={heatmapByDebt} />}

          {/* Clustering stays switched on at every zoom, which is what makes coincident
              customers reachable at all.

              Nearly half the geocoded customers share their exact coordinates with
              another one -- three catering businesses on a single point, and so on --
              because they were geocoded to an area rather than to a door. Markers like
              that never separate at any zoom, so with clustering disabled above 16 the
              second and third of each stack were simply unclickable: one pin, drawn
              three times. A cluster that cannot be split by zooming spiderfies instead,
              fanning its members out on legs, and that is the only way to reach them.

              The radius tightens at close range so this does not come at the cost of
              bundling genuinely distinct shops: 60px while reading the city, ~15px once
              you are working a street. */}
          <MarkerClusterGroup
            chunkedLoading
            showCoverageOnHover={false}
            maxClusterRadius={(zoom: number) => (zoom >= 16 ? 15 : 60)}
            spiderfyOnMaxZoom
            spiderLegPolylineOptions={{ weight: 1.5, color: ink.strokeMinor, opacity: 0.9 }}
            iconCreateFunction={
            clusterIcon as unknown as ComponentProps<typeof MarkerClusterGroup>["iconCreateFunction"]
          }
          >
            {(layers.customers ? filteredCustomers : [])
              // The selected customer is drawn outside this group, below.
              .filter((c) => c.lat && c.lng && c.id !== selectedCustomer?.id)
              .map((c) => (
                <Marker
                  key={c.id}
                  position={[c.lat as number, c.lng as number]}
                  icon={customerIcon(markerColor(c), false, shapedMarkers)}
                  eventHandlers={{ click: () => openCustomer(c) }}
                />
              ))}
          </MarkerClusterGroup>

          {/* Outside the cluster group on purpose: the customer whose panel is open is
              the one thing on this map that must never be swallowed into a bubble. That
              is exactly what would happen to a customer opened from the sidebar or from a
              ?c= link while the map sits at a zoom where their neighbours cluster.

              Drawn even with the customers layer switched off: whatever you turned off,
              you did not mean the one you are looking at. */}
          {selectedCustomer?.lat && selectedCustomer?.lng && (
            <Marker
              position={[selectedCustomer.lat, selectedCustomer.lng]}
              icon={customerIcon(markerColor(selectedCustomer), true, shapedMarkers)}
              zIndexOffset={900}
              eventHandlers={{ click: () => setSelectedCustomer(selectedCustomer) }}
            />
          )}

          {/* Outside the cluster group and lifted above it: these two are landmarks the
              rest of the map is read against, so they must never be swallowed into a
              customer bubble or hidden behind a blip that happens to overlap them. */}
          {layers.facilities && initialFacilities.map((f) => {
            const rel = otherFacilityDistance(f, initialFacilities);
            return (
              <Marker
                key={f.id}
                position={[f.lat, f.lng]}
                icon={facilityIcon(f.kind)}
                zIndexOffset={1000}
              >
                <Popup>
                  <div dir="rtl" className="text-[length:var(--text-sm)] leading-6">
                    <p className="font-medium text-text">{f.name}</p>
                    <p className="mt-0.5 text-[length:var(--text-xs)] text-text-muted">
                      {FACILITY_LABEL[f.kind]}
                    </p>
                    {f.address && (
                      <p className="mt-1.5 text-[length:var(--text-xs)] text-text-muted">{f.address}</p>
                    )}
                    <p className="mt-1.5 flex items-center gap-2 text-right font-mono text-[length:var(--text-xs)] text-text-faint">
                      <span dir="ltr">{coordText(f.lat, f.lng)}</span>
                      <CopyButton value={coordText(f.lat, f.lng)} what="کپی مختصات" />
                    </p>
                    {rel && (
                      <p className="mt-1 text-[length:var(--text-xs)] text-text-faint">
                        {formatDistanceKm(rel.km)} تا {rel.other.name} (خط مستقیم)
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      <a
                        href={navigateUrl(navAppId, { lat: f.lat, lng: f.lng }, f.name)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[length:var(--text-xs)] text-accent hover:underline"
                      >
                        مسیریابی <Icon name="external-link" size="sm" />
                      </a>
                      <Link
                        href={`/facilities?f=${f.id}`}
                        className="text-[length:var(--text-xs)] text-accent hover:underline"
                      >
                        ویرایش این مکان ←
                      </Link>
                    </div>
                  </div>
                </Popup>
              </Marker>
            );
          })}

          {foundLocation && (
            <Marker
              position={[foundLocation.lat, foundLocation.lng]}
              icon={foundLocationIcon()}
              eventHandlers={{ add: (e) => e.target.openPopup() }}
            >
              <Popup>
                <div dir="rtl" className="text-[length:var(--text-sm)]">
                  <p className="mb-1 font-medium text-text">{foundLocation.label}</p>
                  <p className="flex items-center gap-2 font-mono text-[length:var(--text-xs)] text-text-muted">
                    <span dir="ltr">{coordText(foundLocation.lat, foundLocation.lng)}</span>
                    <CopyButton value={coordText(foundLocation.lat, foundLocation.lng)} what="کپی مختصات" />
                  </p>
                  <button
                    onClick={() => setFoundLocation(null)}
                    className="mt-2 text-[length:var(--text-xs)] text-accent hover:underline"
                  >
                    حذف نشانگر
                  </button>
                </div>
              </Popup>
            </Marker>
          )}

          <FitToCustomers
            customers={customers}
            enabled={!startView && incoming.customerId === undefined && incoming.districtId === undefined}
          />
          <ViewWatcher onView={handleView} />
          <ZoomWatcher onZoom={setZoom} />
          {/* Always drawn, never waiting to be asked for. */}
          <MyLocationMarker />
          <LocateControl />
          <FullscreenControl />
          <LayersControl open={layersOpen} count={changedFromDefault(layers)} onClick={() => setLayersOpen((v) => !v)} />
          <DebugMapExpose />
          <BoundsReporter onBounds={setViewBounds} />
        </MapContainer>

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
            else mapRef.current?.flyTo([lat, lng], 15, { duration: 1 });
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
          <select
            value={bulkStatusChoice}
            onChange={(e) => setBulkStatusChoice(e.target.value as CoverageStatus | "")}
            className="rounded-[var(--radius-sm)] border border-border bg-surface px-2 py-1.5 text-[length:var(--text-sm)] text-text outline-none focus:border-accent"
          >
            <option value="">— بدون تغییر وضعیت —</option>
            {(Object.keys(STATUS_LABEL) as CoverageStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
          {role === "owner" && groups.length > 0 && (
            <select
              value={bulkGroupChoice}
              onChange={(e) => setBulkGroupChoice(e.target.value)}
              className="rounded-[var(--radius-sm)] border border-border bg-surface px-2 py-1.5 text-[length:var(--text-sm)] text-text outline-none focus:border-accent"
            >
              <option value="">— بدون تغییر گروه —</option>
              {groups.map((g) => (
                <option key={g.id} value={String(g.id)}>
                  {g.name}
                </option>
              ))}
              <option value="__ungroup__">— خارج کردن از گروه —</option>
            </select>
          )}
          <div className="mr-auto flex shrink-0 gap-2">
            <button
              onClick={() => setBulkSelectedIds(new Set())}
              className="rounded-[var(--radius-sm)] border border-border px-3 py-1.5 text-[length:var(--text-sm)] text-text-muted hover:border-crit hover:text-crit"
            >
              لغو انتخاب
            </button>
            <button
              onClick={applyBulk}
              disabled={bulkSaving || (!bulkStatusChoice && !bulkGroupChoice)}
              className="rounded-[var(--radius-sm)] border border-accent bg-accent px-3 py-1.5 text-[length:var(--text-sm)] font-medium text-accent-ink transition-[filter,transform] duration-[var(--dur-base)] ease-[var(--ease-out)] hover:enabled:brightness-110 active:enabled:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {bulkSaving ? "در حال اعمال…" : "اعمال روی همه"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
