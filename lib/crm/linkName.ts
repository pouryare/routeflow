/** "…/maps/place/<name>/@…" → the name. Google encodes spaces as "+". */
export function placeNameFromUrl(url: string): string | null {
  const m = /\/maps\/place\/([^/@?]+)/.exec(url);
  if (!m) return null;
  try {
    const name = decodeURIComponent(m[1].replace(/\+/g, " ")).trim();
    return name || null;
  } catch {
    return null;
  }
}
