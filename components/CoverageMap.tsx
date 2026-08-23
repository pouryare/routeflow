"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { MapContainer, TileLayer, GeoJSON, Marker, Popup, useMap, useMapEvents } from "react-leaflet";
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
  customerStatusColor,
  debtColor,
  salespersonColor,
  inactivityColor,
  daysSinceLastPurchase,
} from "@/lib/types";
import {
  PRECISION_AUTO_ZOOM,
  PrecisionMode,
  PrecisionTier,
  geometryUrl,
  isPrecisionMode,
  resolveTier,
} from "@/lib/precision";
import CollapsibleSection from "./CollapsibleSection";
import CustomerFilters from "./CustomerFilters";
import StatusPill from "./StatusPill";
import SearchBox from "./SearchBox";
import LocateControl from "./LocateControl";
import BasemapToggleControl, { Basemap } from "./BasemapToggleControl";
import GeofenceWatcher from "./GeofenceWatcher";
import NotificationToggle from "./NotificationToggle";
import { useToast } from "./ToastProvider";
import { distanceKm } from "@/lib/geo";
import {
  FACILITIES,
  FACILITY_LABEL,
  Facility,
  FacilityKind,
} from "@/lib/facilities";

// Everything below is reachable only after an interaction -- opening a customer, opening
// a district, expanding the import panel, switching the heatmap on -- or carries a
// library the first paint doesn't need (leaflet.heat, leaflet.fullscreen and their CSS).
// Splitting them out keeps that weight off the chunk that has to arrive before the map
// can draw anything. CoverageMap is itself ssr:false, so none of these need an SSR pass.
const HeatmapLayer = dynamic(() => import("./HeatmapLayer"), { ssr: false });
const FullscreenControl = dynamic(() => import("./FullscreenControl"), { ssr: false });
const CustomerDetailPanel = dynamic(() => import("./CustomerDetailPanel"), { ssr: false });
const DistrictEditor = dynamic(() => import("./DistrictEditor"), { ssr: false });
const ImportPanel = dynamic(() => import("./ImportPanel"), { ssr: false });

function formatDistanceKm(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} متر`;
  return `${km.toFixed(1)} کیلومتر`;
}

const TEHRAN_CENTER: [number, number] = [35.7, 51.55];

const QUICK_LINKS = [
  { href: "/planner", icon: "🧭", label: "برنامه‌ریزی مسیر و پوشش" },
  { href: "/leads", icon: "📍", label: "لیست مکان‌های پیشنهادی" },
  { href: "/gallery", icon: "🖼", label: "گالری تصاویر" },
  { href: "/report", icon: "📊", label: "گزارش پوشش و مشتریان" },
  { href: "/analytics", icon: "📈", label: "داشبورد تحلیل" },
] as const;
const DISTRICT_STROKE = { mantaghe: "#2A3A4C", mahalle: "#546271" };

interface DueReminder {
  id: number;
  entity_type: "district" | "customer";
  entity_id: number;
  due_date: string;
  message: string;
  label: string;
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

function FitToCustomers({ customers }: { customers: CustomerRow[] }) {
  const map = useMap();
  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current) return;
    const pts = customers.filter((c) => c.lat && c.lng).map((c) => [c.lat as number, c.lng as number] as [number, number]);
    if (pts.length === 0) return;
    fitted.current = true;
    if (pts.length === 1) {
      map.setView(pts[0], 13);
    } else {
      const bounds = pts.reduce((b, p) => b.extend(p), new LatLngBounds(pts[0], pts[0]));
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
    }
  }, [customers, map]);
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
function customerIcon(color: string, selected: boolean): DivIcon {
  const key = `${color}|${selected}`;
  const cached = iconCache.get(key);
  if (cached) return cached;

  const pings = selected
    ? `<span class="customer-marker__ping" aria-hidden="true" style="animation-delay:0ms"></span>
      <span class="customer-marker__ping" aria-hidden="true" style="animation-delay:var(--pulse-stagger)"></span>`
    : "";
  const icon = divIcon({
    className: "",
    html: `<div class="customer-marker${selected ? " customer-marker--selected" : ""}" style="--marker-color:${color}">
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
    html: `<div class="cluster-marker" style="width:${size}px;height:${size}px;">${count}</div>`,
    iconSize: [size, size],
  });
}

function foundLocationIcon() {
  return divIcon({
    className: "",
    html: `<div class="found-location-marker">📍</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 26],
  });
}

// Our own sites are drawn as inline SVG silhouettes rather than emoji (MASTER.md's
// anti-pattern list) or a status-colored diamond: they carry no coverage reading, so
// reusing the customer marker's shape would invite the map to be misread.
//
// The warehouse's inner glyph is a stack of crates, not a building. A roof-and-door
// glyph was tried first and, at the 26px the marker actually renders at, read as a
// second little house sitting inside a hexagon -- indistinguishable at a glance from
// the home-base marker beside it in the legend, which defeats the whole point of
// separating the two by silhouette. Every fill
// lives in globals.css against --facility/--bg, so no color is duplicated here.
//
// The warehouse anchors at its center (a footprint, like the customer diamond); the
// house anchors at its base, because a house silhouette that floats above the point it
// marks reads as hovering next to the address rather than standing on it.
const FACILITY_ART: Record<FacilityKind, { html: string; size: [number, number]; anchor: [number, number] }> = {
  warehouse: {
    html: `<svg width="26" height="29" viewBox="0 0 26 29" aria-hidden="true">
        <path class="facility-marker__body" d="M13 1.2 24.2 7.7v13L13 27.2 1.8 20.7v-13z"/>
        <rect class="facility-marker__glyph" x="10.4" y="9.6" width="5.2" height="4.6" rx="0.6"/>
        <rect class="facility-marker__glyph" x="7.1" y="15.2" width="5.2" height="4.6" rx="0.6"/>
        <rect class="facility-marker__glyph" x="13.7" y="15.2" width="5.2" height="4.6" rx="0.6"/>
      </svg>`,
    size: [26, 29],
    anchor: [13, 15],
  },
  home_base: {
    html: `<svg width="24" height="26" viewBox="0 0 24 26" aria-hidden="true">
        <path class="facility-marker__body" d="M12 1.8 22 9.4v12.4a1.6 1.6 0 0 1-1.6 1.6H3.6A1.6 1.6 0 0 1 2 21.8V9.4z"/>
        <rect class="facility-marker__glyph" x="9.4" y="13.6" width="5.2" height="7.2" rx="0.6"/>
      </svg>`,
    size: [24, 26],
    anchor: [12, 24],
  },
};

function facilityIcon(kind: FacilityKind): DivIcon {
  const key = `facility|${kind}`;
  const cached = iconCache.get(key);
  if (cached) return cached;
  const art = FACILITY_ART[kind];
  const icon = divIcon({
    className: "",
    html: `<div class="facility-marker${kind === "home_base" ? " facility-marker--home" : ""}">${art.html}</div>`,
    iconSize: art.size,
    iconAnchor: art.anchor,
  });
  iconCache.set(key, icon);
  return icon;
}

/** Straight-line distance from one facility to every other, precomputed once -- the
 *  popup's "N km from the warehouse" line, and the sidebar's site list, both read it. */
function otherFacilityDistance(f: Facility): { other: Facility; km: number } | null {
  const other = FACILITIES.find((x) => x.id !== f.id);
  if (!other) return null;
  return { other, km: distanceKm(f, other) };
}

const SATELLITE_TILE = {
  url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  attribution: "Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
};
const DARK_TILE = {
  url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
};

export default function CoverageMap({
  initialDistricts,
  initialCustomers,
  geometryVersion,
}: {
  initialDistricts: DistrictProperties[];
  initialCustomers: CustomerRow[];
  geometryVersion: string;
}) {
  const [districtProps, setDistrictProps] = useState<DistrictProperties[]>(initialDistricts);
  const [geomVersion, setGeomVersion] = useState(geometryVersion);
  const [geometry, setGeometry] = useState<DistrictGeometryMap | null>(null);
  const [precisionMode, setPrecisionMode] = useState<PrecisionMode>("auto");
  const [zoom, setZoom] = useState(11);
  const [customers, setCustomers] = useState<CustomerRow[]>(initialCustomers);
  const [selectedDistrict, setSelectedDistrict] = useState<DistrictFeature | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerRow | null>(null);
  const [colorMode, setColorMode] = useState<CustomerColorMode>("status");
  const [salespersonFilter, setSalespersonFilter] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cityBoundary, setCityBoundary] = useState<GeoJSON.Feature | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [myPosition, setMyPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [dueReminders, setDueReminders] = useState<DueReminder[]>([]);
  const [heatmapOn, setHeatmapOn] = useState(false);
  const [heatmapByDebt, setHeatmapByDebt] = useState(false);
  const [basemap, setBasemap] = useState<Basemap>("dark");
  const [nearbyRadiusKm, setNearbyRadiusKm] = useState(2);
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkSelectedIds, setBulkSelectedIds] = useState<Set<number>>(new Set());
  const [bulkStatusChoice, setBulkStatusChoice] = useState<CoverageStatus | "">("");
  const [bulkAssignChoice, setBulkAssignChoice] = useState("");
  const [bulkSaving, setBulkSaving] = useState(false);
  const [foundLocation, setFoundLocation] = useState<{ lat: number; lng: number; label: string } | null>(null);
  const [geofenceOn, setGeofenceOn] = useState(false);
  const bulkModeRef = useRef(bulkMode);
  bulkModeRef.current = bulkMode;
  const districtLayersRef = useRef(new Map<number, Layer>());
  const mapRef = useRef<LeafletMap | null>(null);
  const salesIndexRef = useRef(new Map<string, number>());
  const asideRef = useRef<HTMLElement>(null);
  const toast = useToast();

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

  // Keeps customer data live without a manual reload -- not just for this tab's own
  // Excel import (ImportPanel's onImported already refreshes that instantly), but for
  // any update made elsewhere: a coworker importing from a different session, or this
  // same tab left open from an earlier visit. /api/customers is always-revalidate
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
    loadReminders();
  }, [loadReminders]);

  useEffect(() => {
    setGeofenceOn(localStorage.getItem("coverage_geofence_on") === "1");
  }, []);
  useEffect(() => {
    localStorage.setItem("coverage_geofence_on", geofenceOn ? "1" : "0");
  }, [geofenceOn]);

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

  const dormantCustomers = useMemo(() => {
    const now = new Date();
    return customers
      .filter((c) => c.status?.includes("فعال") && !c.status?.includes("غیرفعال"))
      .map((c) => ({ customer: c, days: daysSinceLastPurchase(c, now) }))
      .filter((x): x is { customer: CustomerRow; days: number } => x.days !== null && x.days > 30)
      .sort((a, b) => b.days - a.days)
      .slice(0, 20);
  }, [customers]);

  const noCoordCustomers = useMemo(() => {
    return customers
      .filter((c) => c.status?.includes("فعال") && !c.status?.includes("غیرفعال") && (!c.lat || !c.lng))
      .slice(0, 30);
  }, [customers]);

  const salespeople = useMemo(() => {
    const s = new Set<string>();
    customers.forEach((c) => c.salesperson && s.add(c.salesperson));
    return Array.from(s).sort();
  }, [customers]);

  function districtStyle(feature?: DistrictFeature) {
    const status = (feature?.properties.coverage_status ?? "unknown") as CoverageStatus;
    const level = feature?.properties.level === "mantaghe" ? "mantaghe" : "mahalle";
    const selected = !!feature && bulkSelectedIds.has(feature.properties.id);
    return {
      color: selected ? "#2DE0E6" : DISTRICT_STROKE[level],
      weight: selected ? 3 : level === "mantaghe" ? 1.5 : 1,
      fillColor: STATUS_COLOR[status],
      fillOpacity: selected ? 0.55 : level === "mantaghe" ? 0.08 : 0.35,
      opacity: selected ? 1 : level === "mantaghe" ? 0.5 : 0.8,
      dashArray: selected ? "4 3" : undefined,
    };
  }

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bulkSelectedIds]);

  useEffect(() => {
    if (!bulkMode) setBulkSelectedIds(new Set());
  }, [bulkMode]);

  async function applyBulk() {
    if (bulkSelectedIds.size === 0 || (!bulkStatusChoice && !bulkAssignChoice)) return;
    setBulkSaving(true);
    const count = bulkSelectedIds.size;
    const body: { ids: number[]; coverage_status?: CoverageStatus; assigned_to?: string } = {
      ids: Array.from(bulkSelectedIds),
    };
    if (bulkStatusChoice) body.coverage_status = bulkStatusChoice;
    if (bulkAssignChoice) body.assigned_to = bulkAssignChoice === "__unassign__" ? "" : bulkAssignChoice;
    try {
      const res = await fetch("/api/districts/bulk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
      toast(`${count} منطقه به‌روزرسانی شد.`, "success");
    } catch {
      toast("خطا در به‌روزرسانی گروهی مناطق", "error");
    } finally {
      setBulkSaving(false);
      setBulkSelectedIds(new Set());
      setBulkStatusChoice("");
      setBulkAssignChoice("");
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

  function flyToCustomer(c: CustomerRow) {
    setSelectedCustomer(c);
    if (c.lat && c.lng && mapRef.current) {
      mapRef.current.flyTo([c.lat, c.lng], 15, { duration: 1 });
    }
  }

  function flyToFacility(f: Facility) {
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

  return (
    <div className="relative h-screen w-full overflow-hidden bg-bg">
      <button
        onClick={() => setSidebarOpen((v) => !v)}
        aria-label={sidebarOpen ? "بستن پنل" : "باز کردن پنل"}
        aria-expanded={sidebarOpen}
        className="absolute right-4 top-4 z-[1001] flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)] border border-border bg-surface-raised text-[length:var(--text-md)] text-text elevate-accent transition-[transform,border-color] duration-[var(--dur-base)] ease-[var(--ease-out)] hover:scale-[1.03] hover:border-accent active:scale-[0.98]"
      >
        {sidebarOpen ? "✕" : "☰"}
        {!sidebarOpen && dueReminders.length > 0 && (
          <span className="absolute -left-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-crit px-1 font-mono text-[10px] font-bold text-white">
            {dueReminders.length}
          </span>
        )}
      </button>

      <SearchBox
        customers={customers}
        districts={districts?.features ?? []}
        onSelectCustomer={flyToCustomer}
        onSelectDistrict={flyToDistrict}
        onLocationFound={handleLocationFound}
      />

      <GeofenceWatcher enabled={geofenceOn} customers={filteredCustomers} onPosition={(lat, lng) => setMyPosition({ lat, lng })} />

      <aside
        ref={asideRef}
        className={`absolute inset-y-0 right-0 z-[1000] flex w-80 flex-col gap-5 overflow-y-auto border-l border-border bg-surface/95 p-4 pt-16 backdrop-blur transition-transform duration-[var(--dur-slow)] ease-[var(--ease-out)] ${
          sidebarOpen ? "sidebar-stagger translate-x-0" : "translate-x-full"
        }`}
      >
        <div>
          <div className="font-mono text-[length:var(--text-xs)] uppercase tracking-[0.12em] text-accent">
            Coverage Map
          </div>
          <h1 className="text-[length:var(--text-xl)] font-bold text-text">نقشه پوشش مشتریان</h1>
        </div>

        {dueReminders.length > 0 && (
          <section>
            <h2 className="mb-2 font-mono text-[length:var(--text-xs)] uppercase tracking-wide text-crit">
              یادآوری‌های امروز ({dueReminders.length})
            </h2>
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
                    ✓
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {myPosition && (
          <section>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="font-mono text-[length:var(--text-xs)] uppercase tracking-wide text-text-muted">
                مشتریان نزدیک ({nearbyCustomers.length})
              </h2>
              <select
                value={nearbyRadiusKm}
                onChange={(e) => setNearbyRadiusKm(Number(e.target.value))}
                className="rounded-[var(--radius-sm)] border border-border bg-surface px-1.5 py-0.5 text-[length:var(--text-xs)] text-text-muted outline-none focus:border-accent"
              >
                <option value={1}>۱ کیلومتر</option>
                <option value={2}>۲ کیلومتر</option>
                <option value={5}>۵ کیلومتر</option>
              </select>
            </div>
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
          </section>
        )}

        {dormantCustomers.length > 0 && (
          <CollapsibleSection title="مشتریان راکد" count={dormantCustomers.length} titleClassName="text-warn">
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
                    {days.toLocaleString("fa-IR")} روز
                  </span>
                </button>
              ))}
            </div>
          </CollapsibleSection>
        )}

        {noCoordCustomers.length > 0 && (
          <CollapsibleSection title="بدون مختصات" count={noCoordCustomers.length}>
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
            </div>
            <p className="mt-1.5 text-[length:var(--text-xs)] leading-5 text-text-faint">
              روی نام کلیک کنید تا جزئیات مشتری باز شود و بتوانید مختصات را بررسی کنید.
            </p>
          </CollapsibleSection>
        )}

        <section>
          <h2 className="mb-2 font-mono text-[length:var(--text-xs)] uppercase tracking-wide text-text-muted">
            رنگ‌بندی مشتریان
          </h2>
          <div className="flex gap-1 rounded-[var(--radius-md)] border border-border bg-surface p-1">
            {(
              [
                ["status", "وضعیت"],
                ["debt", "بدهی"],
                ["salesperson", "فروشنده"],
                ["inactivity", "رکود"],
              ] as [CustomerColorMode, string][]
            ).map(([mode, label]) => (
              <button
                key={mode}
                onClick={() => setColorMode(mode)}
                className={`flex-1 rounded-[var(--radius-sm)] px-0.5 py-1.5 text-[length:var(--text-xs)] transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] ${
                  colorMode === mode
                    ? "bg-accent font-medium text-[#04191c]"
                    : "text-text-muted hover:bg-white/5 hover:text-text"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </section>

        <section>
          <h2 className="mb-2 font-mono text-[length:var(--text-xs)] uppercase tracking-wide text-text-muted">
            دقت مرز مناطق
          </h2>
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
                    ? "bg-accent font-medium text-[#04191c]"
                    : "text-text-muted hover:bg-white/5 hover:text-text"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[length:var(--text-xs)] leading-5 text-text-faint">
            {precisionMode === "auto"
              ? `خودکار: در بزرگ‌نمایی کم مرزهای ساده‌شده و سبک، از بزرگ‌نمایی ${PRECISION_AUTO_ZOOM.toLocaleString("fa-IR")} به بالا مرزهای کامل. (اکنون: ${activeTier === "high" ? "دقیق" : "سریع"})`
              : precisionMode === "low"
                ? "همیشه مرزهای ساده‌شده — سبک‌ترین حالت برای اینترنت ضعیف."
                : "همیشه مرزهای کامل — دقیق‌تر ولی سنگین‌تر."}
          </p>
        </section>

        <section>
          <h2 className="mb-2 font-mono text-[length:var(--text-xs)] uppercase tracking-wide text-text-muted">
            نقشه حرارتی
          </h2>
          <div className="flex items-center justify-between">
            <span className="text-[length:var(--text-sm)] text-text">نمایش تراکم مشتریان</span>
            <button
              onClick={() => setHeatmapOn((v) => !v)}
              role="switch"
              aria-checked={heatmapOn}
              aria-label="نمایش نقشه حرارتی"
              className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] ${
                heatmapOn ? "border-accent bg-accent" : "border-border bg-surface"
              }`}
            >
              <span
                className="absolute top-0.5 h-4 w-4 rounded-full bg-[color:var(--bg)] transition-[right,left] duration-[var(--dur-base)] ease-[var(--ease-out)]"
                style={{ right: heatmapOn ? "calc(100% - 1.25rem)" : "0.125rem" }}
              />
            </button>
          </div>
          {heatmapOn && (
            <label className="mt-2 flex items-center gap-2 text-[length:var(--text-xs)] text-text-muted">
              <input
                type="checkbox"
                checked={heatmapByDebt}
                onChange={(e) => setHeatmapByDebt(e.target.checked)}
                className="accent-[color:var(--accent)]"
              />
              وزن‌دهی بر اساس شدت بدهی
            </label>
          )}
        </section>

        <section>
          <h2 className="mb-2 font-mono text-[length:var(--text-xs)] uppercase tracking-wide text-text-muted">
            راهنمای رنگ مناطق
          </h2>
          <div className="flex flex-col gap-1.5">
            {(Object.keys(STATUS_LABEL) as CoverageStatus[]).map((s) => (
              <StatusPill key={s} color={STATUS_COLOR[s]} label={STATUS_LABEL[s]} />
            ))}
          </div>
          <p className="mt-2 text-[length:var(--text-xs)] leading-5 text-text-faint">
            {bulkMode
              ? "روی چند منطقه کلیک کنید تا انتخاب شوند، سپس از نوار پایین صفحه تغییر را روی همه اعمال کنید."
              : "برای تغییر وضعیت یک منطقه، روی آن در نقشه کلیک کنید."}
          </p>
        </section>

        {/* The two silhouettes are repeated here at marker size, not described in words:
            the legend's job is to teach the shape the user will actually look for. */}
        <section>
          <h2 className="mb-2 font-mono text-[length:var(--text-xs)] uppercase tracking-wide text-text-muted">
            تأسیسات ما
          </h2>
          <div className="flex flex-col gap-1">
            {FACILITIES.map((f) => (
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
                  {f.note && (
                    <span className="block truncate text-[length:var(--text-xs)] text-text-faint">{f.note}</span>
                  )}
                </span>
              </button>
            ))}
          </div>
          {FACILITIES.length === 2 && (
            <p className="mt-2 font-mono text-[length:var(--text-xs)] leading-5 text-text-faint">
              {formatDistanceKm(distanceKm(FACILITIES[0], FACILITIES[1]))} فاصله مستقیم بین دو انبار
            </p>
          )}
        </section>

        <section>
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
        </section>

        <section>
          <h2 className="mb-2 font-mono text-[length:var(--text-xs)] uppercase tracking-wide text-text-muted">
            اعلان‌ها
          </h2>
          <NotificationToggle />
        </section>

        <section>
          <div className="flex items-center justify-between gap-2">
            <div>
              <span className="text-[length:var(--text-sm)] text-text">انتخاب چندتایی مناطق</span>
              <p className="text-[length:var(--text-xs)] text-text-faint">برای ویرایش‌های گروهی روی دسکتاپ</p>
            </div>
            <button
              onClick={() => setBulkMode((v) => !v)}
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
        </section>

        <CustomerFilters
          salespeople={salespeople}
          salespersonFilter={salespersonFilter}
          onSalespersonFilterChange={setSalespersonFilter}
          totalCount={customers.length}
          filteredCount={filteredCustomers.length}
        />

        <ImportPanel onImported={loadCustomers} />

        <section>
          <h2 className="mb-2 font-mono text-[length:var(--text-xs)] uppercase tracking-wide text-text-muted">
            لینک‌های سریع
          </h2>
          <div className="flex flex-col gap-1.5">
            {QUICK_LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="group flex items-center gap-3 rounded-[var(--radius-md)] border border-border bg-surface py-2 pe-3 ps-2 transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:border-accent focus-visible:border-accent"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-white/5 text-[length:var(--text-md)] transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] group-hover:bg-accent/15 group-focus-visible:bg-accent/15">
                  {l.icon}
                </span>
                <span className="flex-1 text-[length:var(--text-sm)] text-text transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] group-hover:text-accent group-focus-visible:text-accent">
                  {l.label}
                </span>
                <span
                  aria-hidden
                  className="shrink-0 text-text-faint transition-[transform,color] duration-[var(--dur-base)] ease-[var(--ease-out)] group-hover:-translate-x-0.5 group-hover:text-accent group-focus-visible:-translate-x-0.5 group-focus-visible:text-accent"
                >
                  ‹
                </span>
              </Link>
            ))}
          </div>
        </section>

        {error && (
          <p className="flex items-center gap-1.5 text-[length:var(--text-sm)] text-crit">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-crit" />
            {error}
          </p>
        )}
        {loading && <p className="text-[length:var(--text-sm)] text-text-muted">در حال بارگذاری…</p>}
      </aside>

      <div className="absolute inset-0">
        <MapContainer
          center={TEHRAN_CENTER}
          zoom={11}
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
          <TileLayer
            attribution={basemap === "satellite" ? SATELLITE_TILE.attribution : DARK_TILE.attribution}
            url={basemap === "satellite" ? SATELLITE_TILE.url : DARK_TILE.url}
            subdomains={basemap === "satellite" ? undefined : "abcd"}
            maxZoom={20}
          />

          {mantagheFeatures && (
            <GeoJSON
              key={`mantaghe-${districtsVersion}-${activeTier}`}
              data={mantagheFeatures as any}
              style={districtStyle as any}
              onEachFeature={onEachDistrict as any}
            />
          )}
          {mahalleFeatures && (
            <GeoJSON
              key={`mahalle-${districtsVersion}-${activeTier}`}
              data={mahalleFeatures as any}
              style={districtStyle as any}
              onEachFeature={onEachDistrict as any}
            />
          )}
          {cityBoundary && (
            <GeoJSON
              data={cityBoundary as any}
              interactive={false}
              style={{ color: "#8697A8", weight: 2, dashArray: "6 5", fill: false, opacity: 0.85 }}
            />
          )}

          {heatmapOn && <HeatmapLayer customers={filteredCustomers} weightByDebt={heatmapByDebt} />}

          <MarkerClusterGroup
            chunkedLoading
            showCoverageOnHover={false}
            maxClusterRadius={60}
            disableClusteringAtZoom={16}
            iconCreateFunction={clusterIcon as any}
          >
            {filteredCustomers
              .filter((c) => c.lat && c.lng)
              .map((c) => {
                const color =
                  colorMode === "debt"
                    ? debtColor(c)
                    : colorMode === "salesperson"
                      ? salespersonColor(c.salesperson, salesIndexRef.current)
                      : colorMode === "inactivity"
                        ? inactivityColor(c)
                        : customerStatusColor(c.status);
                return (
                  <Marker
                    key={c.id}
                    position={[c.lat as number, c.lng as number]}
                    icon={customerIcon(color, selectedCustomer?.id === c.id)}
                    eventHandlers={{ click: () => setSelectedCustomer(c) }}
                  />
                );
              })}
          </MarkerClusterGroup>

          {/* Outside the cluster group and lifted above it: these two are landmarks the
              rest of the map is read against, so they must never be swallowed into a
              customer bubble or hidden behind a blip that happens to overlap them. */}
          {FACILITIES.map((f) => {
            const rel = otherFacilityDistance(f);
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
                    <p dir="ltr" className="mt-1.5 text-right font-mono text-[length:var(--text-xs)] text-text-faint">
                      {f.lat.toFixed(6)}, {f.lng.toFixed(6)}
                    </p>
                    {rel && (
                      <p className="mt-1 text-[length:var(--text-xs)] text-text-faint">
                        {formatDistanceKm(rel.km)} تا {rel.other.name} (خط مستقیم)
                      </p>
                    )}
                    <a
                      href={f.mapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-block text-[length:var(--text-xs)] text-accent hover:underline"
                    >
                      مسیریابی در گوگل مپ ↗
                    </a>
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
                  <p dir="ltr" className="font-mono text-[length:var(--text-xs)] text-text-muted">
                    {foundLocation.lat.toFixed(6)}, {foundLocation.lng.toFixed(6)}
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

          <FitToCustomers customers={customers} />
          <ZoomWatcher onZoom={setZoom} />
          <LocateControl onPosition={(lat, lng) => setMyPosition({ lat, lng })} />
          <FullscreenControl />
          <BasemapToggleControl mode={basemap} onToggle={() => setBasemap((m) => (m === "dark" ? "satellite" : "dark"))} />
          <DebugMapExpose />
        </MapContainer>

        {selectedCustomer && (
          <CustomerDetailPanel
            customer={selectedCustomer}
            onClose={() => setSelectedCustomer(null)}
            onReminderAdded={loadReminders}
          />
        )}
      </div>

      {selectedDistrict && (
        <DistrictEditor
          district={selectedDistrict}
          salespeople={salespeople}
          onClose={() => setSelectedDistrict(null)}
          onReminderAdded={loadReminders}
          onSaved={() => {
            setSelectedDistrict(null);
            loadDistricts();
          }}
        />
      )}

      {bulkMode && bulkSelectedIds.size > 0 && (
        <div
          dir="rtl"
          className="absolute bottom-4 left-1/2 z-[1050] flex w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 flex-wrap items-center gap-2 rounded-[var(--radius-lg)] border border-accent bg-surface-raised p-3 elevate-accent"
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
          <select
            value={bulkAssignChoice}
            onChange={(e) => setBulkAssignChoice(e.target.value)}
            className="rounded-[var(--radius-sm)] border border-border bg-surface px-2 py-1.5 text-[length:var(--text-sm)] text-text outline-none focus:border-accent"
          >
            <option value="">— بدون تغییر مسئول —</option>
            <option value="__unassign__">— حذف مسئول —</option>
            {salespeople.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <div className="mr-auto flex shrink-0 gap-2">
            <button
              onClick={() => setBulkSelectedIds(new Set())}
              className="rounded-[var(--radius-sm)] border border-border px-3 py-1.5 text-[length:var(--text-sm)] text-text-muted hover:border-crit hover:text-crit"
            >
              لغو انتخاب
            </button>
            <button
              onClick={applyBulk}
              disabled={bulkSaving || (!bulkStatusChoice && !bulkAssignChoice)}
              className="rounded-[var(--radius-sm)] border border-accent bg-accent px-3 py-1.5 text-[length:var(--text-sm)] font-medium text-[#04191c] transition-[filter,transform] duration-[var(--dur-base)] ease-[var(--ease-out)] hover:enabled:brightness-110 active:enabled:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {bulkSaving ? "در حال اعمال…" : "اعمال روی همه"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
