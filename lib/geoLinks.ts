// Pure, network-free helpers for /api/geo/decode-link -- kept separate from the route
// so the coordinate-extraction and SSRF guard logic can be unit tested directly,
// without spinning up Next's request/response machinery.

import { OpenLocationCode } from "open-location-code";

const olc = new OpenLocationCode();

// Reference point used to recover the leading digits of a *shortened* Plus Code
// (e.g. "PGVQ+42F", missing its area prefix) -- valid as long as the true location
// is within roughly a degree of this point. Every business address this app deals
// with is in Tehran province, so a Tehran-center reference is always safe here.
const TEHRAN_REF = { lat: 35.7, lng: 51.4 };

export function isValidCoord(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

// Coordinate conventions seen across map-sharing links (Google Maps, and the
// Persian services -- Neshan, Balad -- which mirror Google's own URL shapes closely
// enough that the same patterns catch them too). Checked in order; first match wins.
const PAIR_PATTERNS: RegExp[] = [
  /@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/, // Google "/@lat,lng,zoom" (place/directions pages)
  /[?&]q=(-?\d{1,3}\.\d+)(?:,|%2C)(-?\d{1,3}\.\d+)/i, // Google "?q=lat,lng" -- the format already used in this business's own workbook
  /[?&]ll=(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/,
  /[?&](?:destination|daddr)=(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/,
];

export function extractLatLng(url: string): { lat: number; lng: number } | null {
  for (const re of PAIR_PATTERNS) {
    const m = url.match(re);
    if (!m) continue;
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    if (isValidCoord(lat, lng)) return { lat, lng };
  }

  // lat=/lng= (or latitude=/longitude=) as separate query params, in either order --
  // the generic shape a few Iranian map platforms' own APIs are known to use.
  const latMatch = url.match(/[?&]lat(?:itude)?=(-?\d{1,3}\.\d+)/i);
  const lngMatch = url.match(/[?&](?:lng|lon(?:gitude)?)=(-?\d{1,3}\.\d+)/i);
  if (latMatch && lngMatch) {
    const lat = Number(latMatch[1]);
    const lng = Number(lngMatch[1]);
    if (isValidCoord(lat, lng)) return { lat, lng };
  }

  return null;
}

// Google share links for a *saved place* (as opposed to a bare dropped pin) usually
// carry no lat/lng at all in the URL -- the only coordinate signal is a Plus Code
// (Open Location Code) embedded in the displayed address, e.g. "...,+PGVQ%2B42F+Marina
// palace,+Iran". Most real-world Google Maps share links hit this case, not the
// direct-coordinate one above, so this is a load-bearing fallback, not an edge case.
const PLUS_CODE_RE = /\b([23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,7})\b/i;

export function extractPlusCodeCoords(url: string): { lat: number; lng: number } | null {
  // decodeURIComponent turns the escaped "%2B" the code's own "+" is encoded as (to
  // disambiguate it from the "+"-as-space convention used elsewhere in the path) back
  // into a literal "+" -- a bare "+" elsewhere in the string is left untouched, and
  // the \b-bounded pattern below doesn't care that "+" isn't a word character either
  // way, so no further space normalization is needed.
  const decoded = safeDecodeURIComponent(url);
  const m = decoded.match(PLUS_CODE_RE);
  if (!m) return null;
  const code = m[1].toUpperCase();
  if (!olc.isValid(code)) return null;
  try {
    const full = olc.isFull(code) ? code : olc.recoverNearest(code, TEHRAN_REF.lat, TEHRAN_REF.lng);
    const area = olc.decode(full);
    const lat = area.latitudeCenter;
    const lng = area.longitudeCenter;
    return isValidCoord(lat, lng) ? { lat, lng } : null;
  } catch {
    return null;
  }
}

// Human-readable address pulled from a Google "/maps/place/<address>/data=..." URL --
// shown as the subtitle of an imported location, and the source the venue's own name is
// recovered from (see placeNameFromAddress) when the paste it came from had no name.
const PLACE_SEGMENT_RE = /\/maps\/place\/([^/]+)/;

export function extractPlaceAddress(url: string): string | null {
  const m = url.match(PLACE_SEGMENT_RE);
  if (!m) return null;
  // The slug's word separator is a literal "+", while a Plus Code's own "+" arrives
  // percent-encoded -- so separators are flattened to spaces *before* decoding, which
  // leaves "PGVQ%2B42F" as a readable "PGVQ+42F" instead of blurring the two "+"
  // meanings together into "PGVQ 42F".
  const cleaned = safeDecodeURIComponent(m[1].replace(/\+/g, " "))
    .replace(/[‬‭]/g, "") // bidi marks Google embeds around Persian names
    .trim();
  return cleaned || null;
}

// Segments that show up in nearly every Tehran address slug and are never the venue's
// own name -- the city, the province, the country, a bare administrative district.
const GENERIC_SEGMENT_RE =
  /^(iran|ایران|tehran|تهران|tehran province|استان تهران|district \d+|منطقه [\d۰-۹]+)$/i;

const PLUS_CODE_TOKEN_RE = /\b[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,7}\b/i;

// Recovers the venue's name from a Google place address -- what an imported location is
// called when the paste it came from was a bare link with no name attached to it.
//
// Google writes these slugs in one of two shapes, and which one it picks is readable off
// the first segment: when the place has a name of its own it leads ("تالار میلاد, PHRX+7F5,
// Tehran, ..."), and when the first segment is instead the city or province, the name
// trails the Plus Code inside its own segment ("Tehran, 3rd Square Tehranpars, PGVQ+42F
// Marina palace, Iran"). With no Plus Code to key off, the last non-generic segment (the
// one just before the country) is the name.
export function placeNameFromAddress(address: string): string | null {
  const segments = address
    .split(/[,،]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (segments.length === 0) return null;
  if (!GENERIC_SEGMENT_RE.test(segments[0])) return segments[0];

  const codeSegment = segments.find((s) => PLUS_CODE_TOKEN_RE.test(s));
  if (codeSegment) {
    const afterCode = codeSegment.replace(PLUS_CODE_TOKEN_RE, "").trim();
    if (afterCode && !GENERIC_SEGMENT_RE.test(afterCode)) return afterCode;
  }

  const rest = segments
    .slice(1)
    .filter((s) => !GENERIC_SEGMENT_RE.test(s) && !PLUS_CODE_TOKEN_RE.test(s));
  return rest.length > 0 ? rest[rest.length - 1] : null;
}

function safeDecodeURIComponent(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

// Only these map-sharing services may be the *initial* target of a server-side
// fetch -- decode-link fetches whatever URL the client hands it, so an unrestricted
// version of this endpoint would let a logged-in user make the server issue requests
// to arbitrary hosts (SSRF). Suffix-matched, so a subdomain of an allowed host counts.
const ALLOWED_LINK_HOSTS = [
  "google.com",
  "goo.gl",
  "neshan.org",
  "nshn.ir",
  "balad.ir",
  "balad.app",
];

export function isAllowedLinkHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return ALLOWED_LINK_HOSTS.some((allowed) => h === allowed || h.endsWith(`.${allowed}`));
}

// Guards each hop of a followed redirect: even a host that started in the allowlist
// could (via a compromised or malicious redirect) point at internal infrastructure --
// loopback, RFC1918 private ranges, and link-local (which is also where cloud
// metadata endpoints like 169.254.169.254 live).
export function isPrivateOrLocalHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "::1" || h === "0.0.0.0") return true;

  const ipv4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const a = Number(ipv4[1]);
    const b = Number(ipv4[2]);
    if (a === 127) return true; // loopback
    if (a === 10) return true; // private
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 169 && b === 254) return true; // link-local / cloud metadata
    if (a === 0) return true;
  }
  // IPv6 unique-local (fc00::/7) and link-local (fe80::/10)
  if (/^f[cd][0-9a-f]{2}:/i.test(h) || /^fe[89ab][0-9a-f]:/i.test(h)) return true;

  return false;
}
