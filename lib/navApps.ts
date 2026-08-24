/** Which app a "navigate there" link opens.
 *
 *  Every such link in this app used to be hardcoded to Google Maps, which in Iran is
 *  frequently the wrong choice: Neshan and Balad have the local road data and the live
 *  traffic that actually matter here.
 *
 *  ## On the URL formats below
 *
 *  Google Maps and Waze are built from their vendors' own published URL APIs.
 *
 *  Neshan's was wrong until it was tested in the field. It used to be
 *  `neshan.org/maps/@lat,lng,16z`, guessed from the shape of what the link *parser*
 *  handles -- which is evidence about what Neshan emits, not about what it accepts, and
 *  in this case the app opened without going anywhere. Neshan's own service settles it:
 *  `nshn.ir/?lat=..&lng=..` redirects to `neshan.org/maps/share/lat,lng`, and the
 *  routing form redirects to a `/routing/destination/` path. All three of neshan.org,
 *  maps.neshan.org and nshn.ir publish assetlinks.json declaring
 *  `delegate_permission/common.handle_all_urls` for the Neshan package, so those links
 *  open the app rather than a browser tab.
 *
 *  Balad's was confirmed by opening it on a phone.
 *
 *  Two things stay, and both are deliberate:
 *
 *  1. `system` exists, and it is the honest fallback. A geo: URI is the OS-level
 *     standard (RFC 5870); on Android it opens the app chooser listing every navigation
 *     app actually installed. It cannot be wrong about a format because it does not
 *     encode one.
 *
 *  2. Each provider is testable from the settings screen against a known coordinate, so
 *     a format that turns out to be wrong is found in five seconds on the sofa rather
 *     than at a junction. That is how this one was found.
 */

export type NavAppId = "google" | "waze" | "neshan" | "balad" | "system";

export interface LatLngPoint {
  lat: number;
  lng: number;
}

export interface NavApp {
  id: NavAppId;
  label: string;
  /** Shown under the label in settings. Says what the option actually does, including
   *  where it is weaker than the others. */
  note: string;
  /** True when the provider can take a whole ordered run in one link. Only Google's URL
   *  API supports intermediate waypoints; the others take a single destination, so a
   *  multi-stop route has to be driven one leg at a time. */
  supportsWaypoints: boolean;
  /** Whether this app's format is confirmed against vendor documentation. Surfaced in
   *  the UI rather than hidden, so an unverified one is not presented as a sure thing. */
  verified: boolean;
}

export const NAV_APPS: NavApp[] = [
  {
    id: "google",
    label: "گوگل مپ",
    note: "تنها گزینه‌ای که می‌تواند کل مسیر چندتوقفی را در یک لینک باز کند.",
    supportsWaypoints: true,
    verified: true,
  },
  {
    id: "neshan",
    label: "نشان",
    note: "مسیریابی را در نشان شروع می‌کند. هر بار یک مقصد.",
    supportsWaypoints: false,
    verified: true,
  },
  {
    id: "balad",
    label: "بلد",
    note: "نقطه را در بلد باز می‌کند. هر بار یک مقصد.",
    supportsWaypoints: false,
    verified: true,
  },
  {
    id: "waze",
    label: "ویز",
    note: "مستقیم مسیریابی را شروع می‌کند. هر بار یک مقصد.",
    supportsWaypoints: false,
    verified: true,
  },
  {
    id: "system",
    label: "انتخاب توسط گوشی",
    note: "گوشی خودش فهرست برنامه‌های نقشه نصب‌شده را نشان می‌دهد. اگر گزینه‌های بالا درست باز نشدند، این همیشه کار می‌کند.",
    supportsWaypoints: false,
    verified: true,
  },
];

export const DEFAULT_NAV_APP: NavAppId = "google";

export function isNavAppId(v: unknown): v is NavAppId {
  return typeof v === "string" && NAV_APPS.some((a) => a.id === v);
}

export function navApp(id: NavAppId): NavApp {
  return NAV_APPS.find((a) => a.id === id) ?? (NAV_APPS[0] as NavApp);
}

/** Coordinates for a URL. Six decimals is ~11cm -- more than the source data justifies,
 *  but it is the precision every one of these services round-trips without complaint. */
function pair(p: LatLngPoint): string {
  return `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
}

/** A link that navigates to one destination in the chosen app. */
export function navigateUrl(app: NavAppId, dest: LatLngPoint, label?: string): string {
  switch (app) {
    case "waze":
      // Documented by Waze: https://developers.google.com/waze/deeplinks
      return `https://waze.com/ul?ll=${pair(dest)}&navigate=yes`;

    case "neshan":
      // Sets the destination as well as centring the map, which is what the Google and
      // Waze links here do and what "navigate there" is asked for. The bare
      // `/@lat,lng,16z` view URL this used to emit centred nothing: Neshan's router
      // wants the full `<zoom>z` segment followed by a `/routing/destination/` path,
      // and silently opened the app at wherever it was left otherwise.
      return `https://neshan.org/maps/@${pair(dest)},15.3z/routing/destination/${pair(dest)}`;

    case "balad":
      // The separate latitude=/longitude= query shape, likewise taken from what the
      // parser handles for real Balad links.
      return `https://balad.ir/location?latitude=${dest.lat.toFixed(6)}&longitude=${dest.lng.toFixed(6)}&zoom=16`;

    case "system": {
      // RFC 5870. The `q=` repeat is what makes Android show a labelled pin rather than
      // just centring the map, and it is ignored harmlessly by handlers that do not want
      // it. The label is bracketed per the de-facto Android convention.
      const q = label ? `${pair(dest)}(${encodeURIComponent(label)})` : pair(dest);
      return `geo:${pair(dest)}?q=${q}`;
    }

    case "google":
    default:
      // Google Maps URLs API: https://developers.google.com/maps/documentation/urls
      return `https://www.google.com/maps/dir/?api=1&destination=${pair(dest)}&travelmode=driving`;
  }
}

/** A link for a whole ordered run.
 *
 *  Only Google can express this. For every other app this falls back to navigating to
 *  the *first* remaining stop, which is the honest reduction: the alternative would be
 *  silently dropping the rest of the day's stops from a link that looks like it contains
 *  them. Callers should tell the user which they got -- see `routeIsSingleLeg`.
 */
export function routeUrl(app: NavAppId, stops: LatLngPoint[], origin?: LatLngPoint | null): string | null {
  if (stops.length === 0) return null;

  if (app !== "google") return navigateUrl(app, stops[0]);

  const destination = stops[stops.length - 1];
  const waypoints = stops.slice(0, -1);
  const params = new URLSearchParams({
    api: "1",
    destination: pair(destination),
    travelmode: "driving",
  });
  if (origin) params.set("origin", pair(origin));
  // Google's URL API accepts at most 10 intermediate waypoints (plus origin and
  // destination). Callers warn about the overflow; truncating here keeps the link valid
  // rather than letting Google reject the whole thing.
  if (waypoints.length) {
    params.set("waypoints", waypoints.slice(0, 10).map(pair).join("|"));
  }
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

/** Whether a whole-run link actually contains the whole run. */
export function routeIsSingleLeg(app: NavAppId, stopCount: number): boolean {
  return stopCount > 1 && !navApp(app).supportsWaypoints;
}

/** How many stops a Google route link had to drop. Zero for every other app, which never
 *  claimed to carry more than one. */
export function droppedWaypoints(app: NavAppId, stopCount: number): number {
  if (app !== "google") return 0;
  const waypoints = Math.max(0, stopCount - 1);
  return Math.max(0, waypoints - 10);
}

export const NAV_APP_KEY = "coverage_nav_app";

/** A fixed, recognisable point for the "does this actually work" button in settings:
 *  Azadi Tower. Somewhere the user can identify at a glance, so a provider that opens
 *  the wrong place is obvious rather than plausible. */
export const NAV_TEST_POINT: LatLngPoint = { lat: 35.699739, lng: 51.338097 };
export const NAV_TEST_LABEL = "برج آزادی";
