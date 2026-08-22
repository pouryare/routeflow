// Fetches the bytes of a file shared via a consumer OneDrive "share" link (1drv.ms /
// onedrive.live.com), for an anonymous "Anyone with the link" share -- no OAuth, no
// app registration.
//
// The straightforward-looking API tricks (api.onedrive.com/v1.0/shares/u!<token>/root/content,
// or the modern graph.microsoft.com equivalent) both always demand a bearer token, even
// for a link anyone can open in a browser -- verified directly, not assumed. What a real
// browser does instead: the share link redirects through a "redeem" step that sets an
// anonymous-access session cookie (a tenant-scoped FedAuth cookie), and every request
// after that point must carry it. A plain `fetch(url, { redirect: "follow" })` drops
// that cookie on the floor -- Node's fetch has no browser-style cookie jar, even across
// redirects within one call -- so the redeem never "sticks" and the last hop lands on a
// sign-in wall. Following redirects by hand while carrying a small cookie jar forward
// fixes it; appending `download=1` to the share URL also short-circuits past the Office
// Online SPA (Doc.aspx) straight to the raw file bytes, which is what's actually wanted
// here.
const MAX_REDIRECTS = 15;

function mergeCookies(jar: Map<string, string>, setCookies: string[]): void {
  for (const sc of setCookies) {
    const first = sc.split(";")[0];
    const eq = first.indexOf("=");
    if (eq === -1) continue;
    jar.set(first.slice(0, eq).trim(), first.slice(eq + 1).trim());
  }
}

function cookieHeader(jar: Map<string, string>): string {
  return Array.from(jar.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

export async function fetchOneDriveFile(shareUrl: string): Promise<Buffer> {
  let start: URL;
  try {
    start = new URL(shareUrl);
  } catch {
    throw new Error("لینک OneDrive نامعتبر است.");
  }
  start.searchParams.set("download", "1");

  const jar = new Map<string, string>();
  let current = start;
  let res: Response;

  try {
    for (let hop = 0; hop < MAX_REDIRECTS; hop++) {
      const headers: Record<string, string> = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      };
      const cookieStr = cookieHeader(jar);
      if (cookieStr) headers["Cookie"] = cookieStr;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        res = await fetch(current.href, { redirect: "manual", headers, signal: controller.signal });
      } finally {
        clearTimeout(timeout);
      }
      console.log(`[oneDriveFetch] hop ${hop}: ${res.status} ${current.href.slice(0, 90)}`);
      mergeCookies(jar, res.headers.getSetCookie());

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        await res.body?.cancel().catch(() => {});
        if (!location) throw new Error("زنجیره لینک OneDrive ناقص بود.");
        current = new URL(location, current);
        continue;
      }
      break;
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes("OneDrive")) throw e;
    throw new Error("اتصال به OneDrive برقرار نشد.");
  }

  const finalRes = res!;
  if (finalRes.url.includes("login.live.com") || finalRes.url.includes("/Authenticate.aspx")) {
    throw new Error(
      "این لینک OneDrive نیاز به ورود به حساب مایکروسافت دارد. مطمئن شوید حالت اشتراک‌گذاری روی «Anyone with the link» است."
    );
  }
  if (!finalRes.ok) {
    throw new Error(`خطا در دریافت فایل از OneDrive (کد ${finalRes.status})`);
  }
  const contentType = finalRes.headers.get("content-type") ?? "";
  if (!contentType.includes("spreadsheetml") && !contentType.includes("application/octet-stream")) {
    throw new Error("محتوای دریافتی از OneDrive یک فایل اکسل نبود. لینک را بررسی کنید.");
  }
  return Buffer.from(await finalRes.arrayBuffer());
}
