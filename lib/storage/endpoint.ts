import dns from "node:dns/promises";
import net from "node:net";
import { devStorageAllowed } from "./local";

/** A company types its own endpoint, so the server would fetch an address a user chose. Refuse
 *  plain http and private, loopback and link-local addresses (after DNS) outside development.
 *  shortcut: checked when the storage is saved and tested, not on every request, so a DNS record
 *  changed afterwards is not caught until the daily check; upgrade by pinning the resolved address. */
export async function checkEndpoint(raw: unknown): Promise<{ ok: true; url: string } | { ok: false; reason: string }> {
  if (typeof raw !== "string" || raw.length > 200) return { ok: false, reason: "نشانی فضای ذخیره‌سازی نامعتبر است" };
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "نشانی فضای ذخیره‌سازی نامعتبر است" };
  }
  if (u.username || u.password || u.search || u.hash || (u.pathname !== "/" && u.pathname !== "")) {
    return { ok: false, reason: "نشانی فقط باید دامنه باشد، مثل https://s3.ir-thr-at1.arvanstorage.ir" };
  }
  const dev = devStorageAllowed();
  if (u.protocol !== "https:" && !(dev && u.protocol === "http:")) return { ok: false, reason: "نشانی باید با https شروع شود" };
  if (!dev) {
    const host = u.hostname.replace(/^\[|\]$/g, "");
    let addrs: string[];
    try {
      addrs = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((a) => a.address);
    } catch {
      return { ok: false, reason: "نشانی فضای ذخیره‌سازی پیدا نشد" };
    }
    if (addrs.length === 0 || addrs.some(isPrivateAddress)) {
      return { ok: false, reason: "این نشانی به شبکهٔ داخلی اشاره می‌کند و پذیرفته نیست" };
    }
  }
  return { ok: true, url: `${u.protocol}//${u.host}` };
}

export function isPrivateAddress(ip: string): boolean {
  const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  if (net.isIPv4(v4)) {
    const [a, b] = v4.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v6 = ip.toLowerCase();
  return v6 === "::" || v6 === "::1" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe8") ||
    v6.startsWith("fe9") || v6.startsWith("fea") || v6.startsWith("feb");
}
