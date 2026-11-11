/** Arvan CDN API (https://napi.arvancloud.ir/cdn/4.0), used for company addresses: add the customer's domain,
 *  point the address at our server, turn HTTPS on, purge the cache.
 *  shortcut: paths and field names come from client libraries and search results, not from Arvan's reference
 *  (unreachable when this was written); a failed call returns Arvan's own message, so the first real run shows
 *  what to fix. Needs ARVAN_API_KEY on the server (a key with CDN permission). */

const BASE = "https://napi.arvancloud.ir/cdn/4.0";

export const arvanConfigured = (): boolean => !!process.env.ARVAN_API_KEY;

export interface ArvanState {
  /** Nameservers Arvan gave for the customer's domain (empty if none yet). */
  ns: string[];
  /** Arvan reports the domain as active, i.e. the customer's nameservers already point at it. */
  active: boolean;
}

/** Second-level public suffixes in use here, so `x.co.ir` has root `x.co.ir` and not `co.ir`.
 *  shortcut: a short fixed list, not the public suffix list; add a suffix here if a customer needs one. */
const SECOND_LEVEL = new Set(["co", "ac", "gov", "org", "net", "sch", "id"]);

/** `app.taminodis.ir` -> { root: "taminodis.ir", name: "app" }; the root itself -> name "@". */
export function splitHost(hostname: string): { root: string; name: string } {
  const labels = hostname.toLowerCase().split(".");
  const keep = labels.length > 2 && SECOND_LEVEL.has(labels[labels.length - 2]) && labels[labels.length - 1].length === 2 ? 3 : 2;
  const root = labels.slice(-keep).join(".");
  const name = labels.slice(0, -keep).join(".");
  return { root, name: name || "@" };
}

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; data: unknown }> {
  const key = process.env.ARVAN_API_KEY ?? "";
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: /^apikey /i.test(key) ? key : `Apikey ${key}`, "Content-Type": "application/json", Accept: "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const json = (await res.json().catch(() => ({}))) as { data?: unknown; message?: string };
  if (!res.ok && res.status !== 404) throw new Error(`آروان: ${json.message ?? "پاسخ ناموفق"}`);
  return { status: res.status, data: json.data };
}

function stateOf(data: unknown): ArvanState {
  const d = (data ?? {}) as { ns_keys?: unknown; name_servers?: unknown; status?: unknown };
  const list = [d.ns_keys, d.name_servers].find((v) => Array.isArray(v)) as unknown[] | undefined;
  return { ns: (list ?? []).filter((x): x is string => typeof x === "string"), active: d.status === "active" };
}

/** The domain's state in Arvan, or null when it is not added there yet. */
export async function arvanState(hostname: string): Promise<ArvanState | null> {
  const r = await call("GET", `/domains/${splitHost(hostname).root}`);
  return r.status === 404 ? null : stateOf(r.data);
}

const recordBody = (name: string, ip: string) => ({
  type: "a",
  name,
  value: [{ ip, port: null, weight: null, country: "" }],
  ttl: 120,
  cloud: true,
  upstream_https: "default",
  ip_filter_mode: { count: "single", order: "none", geo_filter: "none" },
});

/** Makes the address's A record point at `ip` with the cloud on (creates it, or changes the one that is there). */
export async function arvanPointAt(hostname: string, ip: string): Promise<void> {
  const { root, name } = splitHost(hostname);
  const list = await call("GET", `/domains/${root}/dns-records?search=${encodeURIComponent(name)}`);
  const found = (Array.isArray(list.data) ? list.data : []).find(
    (r: { id?: string; type?: string; name?: string }) => r.type?.toLowerCase() === "a" && r.name === name
  ) as { id?: string } | undefined;
  if (found?.id) await call("PUT", `/domains/${root}/dns-records/${found.id}`, recordBody(name, ip));
  else await call("POST", `/domains/${root}/dns-records`, recordBody(name, ip));
}

/** The whole set-up for one address: domain added, A record pointing at the server, HTTPS on. Returns the state
 *  (nameservers for the customer). HTTPS is best effort: Arvan refuses it until the customer's nameservers are live. */
export async function arvanSetup(hostname: string, ip: string): Promise<ArvanState> {
  const { root } = splitHost(hostname);
  let state = await arvanState(hostname);
  if (!state) {
    await call("POST", "/domains/dns-service", { domain: root, domain_type: "full" });
    state = (await arvanState(hostname)) ?? { ns: [], active: false };
  }
  await arvanPointAt(hostname, ip);
  await call("PATCH", `/domains/${root}/ssl`, { ssl_status: true, certificate: "managed" }).catch(() => undefined);
  return state;
}

export async function arvanPurge(hostname: string): Promise<void> {
  await call("POST", `/domains/${splitHost(hostname).root}/caching/purge`, { purge: "all" });
}
