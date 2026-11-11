import { MAX_LOGO_BYTES, sniffLogo, type LogoType } from "@/lib/repo/companies";

/** A logo sent as a data: URL ("data:image/png;base64,..."). `null` when absent; an error text when it is not
 *  a PNG, JPEG or WebP picture of at most 150 KB (checked by its bytes, not by what the sender called it). */
export function parseLogo(v: unknown): { data: Buffer; type: LogoType } | null | { error: string } {
  if (v === undefined || v === null || v === "") return null;
  const m = typeof v === "string" ? /^data:image\/[a-z]+;base64,([A-Za-z0-9+/=]+)$/.exec(v) : null;
  if (!m) return { error: "لوگو نامعتبر است" };
  const data = Buffer.from(m[1], "base64");
  if (data.length > MAX_LOGO_BYTES) return { error: "لوگو باید کمتر از ۱۵۰ کیلوبایت باشد" };
  const type = sniffLogo(data);
  return type ? { data, type } : { error: "لوگو باید تصویر PNG، JPEG یا WebP باشد" };
}

export const MIN_PASSWORD = 8;
export const USERNAME_RE = /^[A-Za-z0-9._-]{3,40}$/;

/** A first login to offer when a company is made: «taminodis.admin» for app.taminodis.ir. It comes from
 *  the address (the part before the last dot, e.g. «taminodis»), else from the name when that is written
 *  in Latin letters, else «company». The owner can change it. */
export function suggestOwnerUsername(hostname: string, name: string): string {
  const parts = hostname.trim().toLowerCase().split(".").filter(Boolean);
  const fromHost = parts.length >= 2 ? parts[parts.length - 2] : "";
  const fromName = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
  const slug = (fromHost.replace(/[^a-z0-9-]/g, "") || fromName || "company").slice(0, 30);
  return `${slug}.admin`;
}
