import {
  Truck, MapPin, Bell, User, Info, Search, ChevronLeft, ChevronRight, ChevronDown,
  Plus, X, Check, TriangleAlert, Package, Calendar, CloudSun, Pencil, Trash2,
  Settings, LogOut, ExternalLink, Filter, Download, Printer, Star, Clock,
  type LucideIcon,
} from "lucide-react";

/** The app's icon vocabulary. Add a name here; never import from lucide-react directly
 *  in a feature file — a direct import is how stroke width and pixel size drift back in.
 *  Every glyph is line-only and monochrome (`currentColor`), per MASTER.md. */
export const ICONS = {
  truck: Truck,
  "map-pin": MapPin,
  bell: Bell,
  user: User,
  info: Info,
  search: Search,
  "chevron-left": ChevronLeft,
  "chevron-right": ChevronRight,
  "chevron-down": ChevronDown,
  plus: Plus,
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
  clock: Clock,
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
