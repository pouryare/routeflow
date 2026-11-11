import { promises as dns } from "node:dns";
import type { DomainStatus } from "@/lib/repo/companyDomains";

/** The name a company points its address at (CNAME): `domains.` + the main address. MAIN_HOST is set by `routeflow install`. */
export function dnsTarget(): string | null {
  const main = process.env.MAIN_HOST?.trim().toLowerCase();
  return main ? `domains.${main.replace(/^app\./, "")}` : null;
}

/** Private, loopback and link-local addresses: a check must never become a request to our own network. */
export function isPrivateAddress(ip: string): boolean {
  if (ip.includes(":")) return ip === "::1" || /^f[cd]/i.test(ip) || /^fe80/i.test(ip) || ip.startsWith("::ffff:");
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
}

interface DomainCheck {
  status: DomainStatus;
  error: string | null;
}

/** How far an address has got, seen from outside:
 *  - it answers /api/health with this app's answer -> active;
 *  - otherwise DNS already points at us (CNAME to the target, or the same IPs) -> waiting_arvan;
 *  - otherwise -> waiting_dns.
 *  shortcut: an address that reaches the app by any route counts as done, so this works whether or not
 *  Arvan sits in front; tighten it once the Arvan hand-off is confirmed. */
export async function checkDomain(hostname: string): Promise<DomainCheck> {
  let addrs: string[] = [];
  try {
    addrs = await dns.resolve4(hostname);
  } catch {
    /* no A record: handled below */
  }
  if (addrs.some(isPrivateAddress)) return { status: "failed", error: "این نشانی به آدرس داخلی اشاره می‌کند" };

  if (addrs.length) {
    try {
      const res = await fetch(`https://${hostname}/api/health`, { redirect: "manual", signal: AbortSignal.timeout(8000) });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; live?: unknown } | null;
      if (res.ok && body?.ok && body.live !== undefined) return { status: "active", error: null };
    } catch {
      /* not reachable yet: fall through to the DNS story */
    }
  }

  const target = dnsTarget();
  if (!addrs.length) {
    return { status: "waiting_dns", error: target ? `هنوز رکوردی برای این نشانی دیده نمی‌شود. رکورد CNAME را به ${target} بزنید.` : "هنوز رکوردی برای این نشانی دیده نمی‌شود." };
  }
  let pointsAtUs = false;
  if (target) {
    try {
      const cnames = (await dns.resolveCname(hostname)).map((c) => c.toLowerCase().replace(/\.$/, ""));
      const ours = await dns.resolve4(target).catch(() => [] as string[]);
      pointsAtUs = cnames.includes(target) || addrs.some((a) => ours.includes(a));
    } catch {
      /* not a CNAME */
    }
  }
  return pointsAtUs
    ? { status: "waiting_arvan", error: "DNS درست است؛ نشانی را در پنل آروان اضافه کنید و دوباره بررسی کنید." }
    : { status: "waiting_dns", error: target ? `نشانی هنوز به ${target} اشاره نمی‌کند.` : "نشانی هنوز به این سرور اشاره نمی‌کند." };
}
