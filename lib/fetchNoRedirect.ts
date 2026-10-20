/** One-hop fetch for following map-link redirects by hand.
 *
 *  `redirect: "manual"` so the caller can vet every hop's host (SSRF) before following it.
 *  Shared by the batch resolver and the single-link decode route; its own module because
 *  `resolveMapsLink` pulls in Playwright and the route has no business bundling that. */
export const FETCH_TIMEOUT_MS = 8000;

export async function fetchNoRedirect(url: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      redirect: "manual",
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; CoverageMapBot/1.0)" },
    });
  } finally {
    clearTimeout(timeout);
  }
}
