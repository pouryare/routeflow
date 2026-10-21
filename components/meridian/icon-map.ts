import {
  Truck, MapPin, Bell, User, Info, Search, ChevronLeft, ChevronRight, ChevronDown,
  Plus, Minus, X, Check, TriangleAlert, Package, Calendar, CloudSun, Pencil, Trash2,
  Settings, LogOut, ExternalLink, Filter, Download, Printer, Star, StarOff, Clock,
  Compass, Satellite, Route, Map, Image, Building2, Receipt, FolderTree, Flame, GripVertical,
  ChartColumn, TrendingUp, Mountain, Handshake, Type, Link2, Wallet, Moon, Users,
  Target, Palette, Trees, CloudFog, CircleHelp, Ban, Circle, Menu, Sparkles,
  ArrowUpRight, ArrowLeft, ArrowRight, ArrowDown, ArrowUp, ArrowLeftRight,
  RotateCcw, Layers, Camera, FileText, Waypoints, ClipboardList,
  Radar, Sun, Contrast, Square, Banknote, Flag, Ellipsis, LocateFixed,
  List, LayoutGrid, Repeat, PanelBottom, PanelRight, Phone, Maximize, Minimize,
  type LucideIcon,
} from "lucide-react";

/** The app's icon vocabulary. Add a name here; never import from lucide-react directly
 *  in a feature file — a direct import is how stroke width and pixel size drift back in.
 *  Every glyph is line-only and monochrome (`currentColor`), per MASTER.md.
 *
 *  This list is also the reason no emoji survives as an icon anywhere in the app. An
 *  emoji is a *coloured picture from a font you do not control*: it renders in the
 *  vendor's palette (Apple's 🔔 is amber, Noto's is brown), ignores `color`, ignores
 *  stroke weight, and changes shape between the reader's phone and their desktop. One
 *  🔔 in a panel is enough to make an otherwise monochrome interface look assembled
 *  from parts. Every name below replaced at least one. */
export const ICONS = {
  truck: Truck,
  "map-pin": MapPin,
  bell: Bell,
  user: User,
  phone: Phone,
  info: Info,
  search: Search,
  "chevron-left": ChevronLeft,
  "chevron-right": ChevronRight,
  "chevron-down": ChevronDown,
  plus: Plus,
  minus: Minus,
  x: X,
  check: Check,
  warn: TriangleAlert,
  package: Package,
  calendar: Calendar,
  weather: CloudSun,
  edit: Pencil,
  trash: Trash2,
  settings: Settings,
  logout: LogOut,
  "external-link": ExternalLink,
  filter: Filter,
  download: Download,
  print: Printer,
  star: Star,
  "star-off": StarOff,
  clock: Clock,

  /* Spatial — the map surfaces and their layer switcher. */
  compass: Compass,
  satellite: Satellite,
  route: Route,
  map: Map,
  mountain: Mountain,
  trees: Trees,
  fog: CloudFog,
  moon: Moon,
  waypoints: Waypoints,
  layers: Layers,
  labels: Type,
  radar: Radar,
  sun: Sun,
  contrast: Contrast,
  square: Square,

  /* Records — the CRM nouns. */
  building: Building2,
  receipt: Receipt,
  folders: FolderTree,
  image: Image,
  camera: Camera,
  file: FileText,
  clipboard: ClipboardList,
  users: Users,
  handshake: Handshake,
  wallet: Wallet,
  banknote: Banknote,
  flag: Flag,

  /* Analysis. */
  chart: ChartColumn,
  trend: TrendingUp,
  flame: Flame,
  "grip-vertical": GripVertical,
  target: Target,
  palette: Palette,
  sparkle: Sparkles,

  /* States and directions. */
  help: CircleHelp,
  ban: Ban,
  dot: Circle,
  menu: Menu,
  link: Link2,
  "arrow-up-right": ArrowUpRight,
  "arrow-left": ArrowLeft,
  "arrow-right": ArrowRight,
  "arrow-up": ArrowUp,
  "arrow-down": ArrowDown,
  "arrow-swap": ArrowLeftRight,
  undo: RotateCcw,
  /* «⋯» and «◎» were typed as text glyphs where these belonged. */
  more: Ellipsis,
  locate: LocateFixed,
  maximize: Maximize,
  minimize: Minimize,
  /* «▤ ▥ ▦ ↺ ⌄» were typed as text glyphs where these belonged. */
  list: List,
  grid: LayoutGrid,
  repeat: Repeat,
  "panel-bottom": PanelBottom,
  "panel-side": PanelRight,
} as const satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

/** Tokenised pixel sizes. `sm` sits with body text, `md` is the default control glyph,
 *  `lg` heads a card. */
export const ICON_PX = { sm: 16, md: 20, lg: 24 } as const;
export type IconSize = keyof typeof ICON_PX;

/** The stroke weight every meridian icon is drawn at. One value, one place. */
export const ICON_STROKE = 1.75;

export type ResolvedIcon = {
  Comp: LucideIcon;
  size: number;
  strokeWidth: number;
  "aria-hidden": true | undefined;
  "aria-label": string | undefined;
  role: "img" | undefined;
};

/** Pure resolver — everything the component needs, with no JSX, so it is unit-testable
 *  the way the rest of this codebase tests its logic. An icon with no label is
 *  decorative (`aria-hidden`); one with a label is an image with an accessible name. */
export function resolveIcon(
  name: IconName,
  size: IconSize = "md",
  label?: string,
): ResolvedIcon {
  return {
    Comp: ICONS[name],
    size: ICON_PX[size],
    strokeWidth: ICON_STROKE,
    "aria-hidden": label ? undefined : true,
    "aria-label": label,
    role: label ? "img" : undefined,
  };
}

/** The same `map-pin` glyph as `<Icon name="map-pin" />`, as an HTML string.
 *
 *  Leaflet's `divIcon` takes markup, not a React element, so a marker cannot go through
 *  the `<Icon>` component. Rather than let that one hole justify an emoji, the path is
 *  inlined here — copied from lucide's `map-pin` at ICON_STROKE — and kept beside the
 *  vocabulary it belongs to so it is found when the set is next revised. `currentColor`
 *  still applies: the marker takes its colour from the CSS class Leaflet wraps it in.
 *
 *  If more non-React call sites appear, this becomes a map keyed by IconName. One does
 *  not warrant the indirection.
 */
export const MAP_PIN_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24"',
  ` fill="none" stroke="currentColor" stroke-width="${ICON_STROKE}"`,
  ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">',
  '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/>',
  '<circle cx="12" cy="10" r="3"/>',
  "</svg>",
].join("");
