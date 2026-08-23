/** Copy to clipboard, with the fallback that makes it work off the HTTPS host.
 *
 *  navigator.clipboard only exists in a secure context. Caddy terminates TLS in front of
 *  this app, so the normal path is available -- but the same server is reachable over
 *  plain http on the LAN, and there the modern API is simply undefined. Rather than have
 *  copy buttons that mysteriously do nothing on the phone that opened the LAN address,
 *  this falls back to the old execCommand route.
 *
 *  Returns whether it worked, so the caller can report failure instead of showing a
 *  cheerful confirmation over an empty clipboard.
 */
export async function copyText(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Permission denied, or the document lost focus mid-write. Fall through -- the
      // legacy path has different failure modes and sometimes succeeds where this didn't.
    }
  }
  return legacyCopy(text);
}

function legacyCopy(text: string): boolean {
  if (typeof document === "undefined") return false;
  const el = document.createElement("textarea");
  el.value = text;
  // Off-screen rather than hidden: execCommand("copy") reads the *selection*, and a
  // display:none element cannot hold one. readOnly keeps the mobile keyboard away.
  el.setAttribute("readonly", "");
  el.style.position = "fixed";
  el.style.top = "-1000px";
  el.style.opacity = "0";
  document.body.appendChild(el);

  try {
    el.select();
    el.setSelectionRange(0, el.value.length);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    el.remove();
  }
}

/** The canonical text form of a coordinate pair: what Google Maps, Waze and every other
 *  app on the phone expect in their search box.
 *
 *  Latin digits, deliberately -- this is the one number in the app that exists to be
 *  pasted somewhere else, and nothing outside this app parses ۳۵٫۷. Six decimals is
 *  ~11 cm, which is more than the source data justifies but is the format those apps
 *  round-trip without complaint. */
export function coordText(lat: number, lng: number): string {
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}
