import { NextRequest, NextResponse } from "next/server";
import { extractLatLng, extractPlusCodeCoords, isAllowedLinkHost, isPrivateOrLocalHost } from "@/lib/geoLinks";
import { requireRole } from "@/lib/session";
import { MANAGE_ROLES } from "@/lib/roles";
import { fetchNoRedirect } from "@/lib/fetchNoRedirect";

const MAX_REDIRECTS = 6;
// A "saved place" share link usually resolves to a URL with no direct @lat,lng at
// all -- the Plus Code embedded in the displayed address is the only fallback signal,
// so it's tried at every hop right alongside the direct pattern, not as an afterthought.
function extractAnyCoords(url: string) {
  return extractLatLng(url) ?? extractPlusCodeCoords(url);
}

// Guard only, no scope: this resolves a map link the caller already holds and reads
// nothing out of the database.
export async function GET(req: NextRequest) {
  const guard = requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;

  const urlParam = req.nextUrl.searchParams.get("url")?.trim();
  if (!urlParam || !/^https?:\/\//i.test(urlParam)) {
    return NextResponse.json({ ok: false, error: "لینک نامعتبر است" }, { status: 400 });
  }

  let current: URL;
  try {
    current = new URL(urlParam);
  } catch {
    return NextResponse.json({ ok: false, error: "لینک نامعتبر است" }, { status: 400 });
  }
  if (!isAllowedLinkHost(current.hostname)) {
    return NextResponse.json(
      { ok: false, error: "این دامنه پشتیبانی نمی‌شود (گوگل‌مپ، نشان، بلد و ویز)" },
      { status: 400 }
    );
  }

  const direct = extractAnyCoords(current.href);
  if (direct) {
    return NextResponse.json({ ok: true, ...direct, resolvedUrl: current.href });
  }

  // Short links (maps.app.goo.gl, nshn.ir, etc.) carry no coordinates in the short
  // URL itself -- only the redirect chain reveals the real one. Followed by hand,
  // one hop at a time, so every intermediate hostname can be checked against
  // isPrivateOrLocalHost before the next request goes out (an auto-following
  // `redirect: "follow"` would happily chase a malicious redirect straight to
  // internal infrastructure with no chance to intervene).
  try {
    for (let hop = 0; hop < MAX_REDIRECTS; hop++) {
      const res = await fetchNoRedirect(current.href);

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        await res.body?.cancel().catch(() => {});
        if (!location) break;

        const next = new URL(location, current);
        if (next.protocol !== "http:" && next.protocol !== "https:") break;
        if (isPrivateOrLocalHost(next.hostname)) {
          return NextResponse.json(
            { ok: false, error: "این لینک به یک آدرس داخلی هدایت می‌شود" },
            { status: 400 }
          );
        }

        const foundInRedirect = extractAnyCoords(next.href);
        current = next;
        if (foundInRedirect) {
          return NextResponse.json({ ok: true, ...foundInRedirect, resolvedUrl: next.href });
        }
        continue;
      }

      await res.body?.cancel().catch(() => {});
      const resolved = extractAnyCoords(res.url || current.href);
      if (resolved) {
        return NextResponse.json({ ok: true, ...resolved, resolvedUrl: res.url || current.href });
      }
      return NextResponse.json({ ok: false, error: "مختصات از این لینک قابل استخراج نبود" }, { status: 422 });
    }
    return NextResponse.json({ ok: false, error: "تعداد هدایت‌های این لینک بیش از حد مجاز بود" }, { status: 422 });
  } catch {
    return NextResponse.json({ ok: false, error: "خطا در باز کردن لینک" }, { status: 502 });
  }
}
