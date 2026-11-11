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
