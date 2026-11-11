import { promises as dns } from "node:dns";
import type { DomainStatus } from "@/lib/repo/companyDomains";

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
 *  - otherwise the customer's CNAME already points at the value Arvan gave -> waiting_arvan (Arvan is not serving it yet);
 *  - otherwise -> waiting_dns (no Arvan value stored yet, or the CNAME is not set).
 *  shortcut: an address that reaches the app by any route counts as done; tighten it once the Arvan hand-off is seen live. */
export async function checkDomain(hostname: string, arvanCname: string | null): Promise<DomainCheck> {
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

  if (!arvanCname) return { status: "waiting_dns", error: "نشانی هنوز به برنامه نمی‌رسد. نیم‌سرورهای دامنه باید روی آروان باشد و رکورد A نشانی با ابر روشن ساخته شده باشد." };
  let pointsAtArvan = false;
  try {
    pointsAtArvan = (await dns.resolveCname(hostname)).some((c) => c.toLowerCase().replace(/\.$/, "") === arvanCname);
  } catch {
    /* no CNAME record */
  }
  return pointsAtArvan
    ? { status: "waiting_arvan", error: "DNS درست است. در پنل آروان HTTPS نشانی را فعال کنید و دوباره بررسی کنید." }
    : { status: "waiting_dns", error: `مشتری باید رکورد CNAME نشانی را به ${arvanCname} بزند.` };
}
