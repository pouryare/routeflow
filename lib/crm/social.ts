import { normalisePersian } from "@/lib/persian";

const RESERVED = new Set(["p", "reel", "reels", "stories", "explore", "tv", "accounts"]);

/** An Instagram page as its bare handle. "@Kababi.Nayeb", "instagram.com/kababi.nayeb/?hl=fa"
 *  and "https://www.instagram.com/kababi.nayeb" all give "kababi.nayeb" -- so the same page
 *  typed three ways is one duplicate key, which matters for phone-less leads. Handles are
 *  1-30 of a-z 0-9 . _ ; URLs must be instagram.com pages (any subdomain, not a lookalike
 *  host or userinfo trick) and a post / reel / story path is not a page. */
export function normInstagram(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s0 = normalisePersian(raw).trim().toLowerCase();
  if (!s0) return null;
  let s = s0;
  if (/^https?:\/\//.test(s) || /^[a-z0-9.-]+\//.test(s)) {
    try {
      const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//.test(s) ? s : `https://${s}`);
      if (!/(^|\.)instagram\.com$/.test(u.hostname)) return null;
      const parts = u.pathname.split("/").filter(Boolean);
      if (parts.some((p) => RESERVED.has(p))) return null;
      s = parts[0] ?? "";
    } catch {
      return null;
    }
  } else {
    s = s.replace(/^@/, "");
  }
  return /^[a-z0-9._]{1,30}$/.test(s) && !RESERVED.has(s) ? s : null;
}

export const instagramUrl = (handle: string): string => `https://instagram.com/${handle}`;
