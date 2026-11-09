export const CROP_ASPECTS = [
  { id: "orig", label: "اصلی", ratio: null },
  { id: "4:3", label: "۴:۳", ratio: 4 / 3 },
  { id: "1:1", label: "۱:۱", ratio: 1 },
  { id: "3:4", label: "۳:۴", ratio: 3 / 4 },
] as const;

export const MAX_PHOTO_BYTES = 20 * 1024 * 1024; // the same ceiling app/api/photos enforces (lib/photos.ts)

/** Why a file cannot be uploaded as a photo, in words for the person, or null when it can. */
export function photoProblem(file: { type: string; size: number }): string | null {
  if (!file.type.startsWith("image/")) return "این فایل عکس نیست.";
  if (file.size > MAX_PHOTO_BYTES) return "حجم عکس بیش از ۲۰ مگابایت است؛ عکس کوچک‌تری انتخاب کنید.";
  return null;
}

/** The centred rectangle of a w×h picture that has the given width/height ratio; the whole picture when
 *  `ratio` is null. Whole pixels, never outside the picture. */
export function cropRect(w: number, h: number, ratio: number | null): { x: number; y: number; w: number; h: number } {
  if (ratio === null || w <= 0 || h <= 0) return { x: 0, y: 0, w, h };
  const cw = Math.min(w, Math.round(h * ratio));
  const ch = Math.min(h, Math.round(cw / ratio));
  return { x: Math.floor((w - cw) / 2), y: Math.floor((h - ch) / 2), w: cw, h: ch };
}

/** The size a w×h picture is drawn at so its long edge is at most `maxEdge`; never larger than it is. */
export function fitInside(w: number, h: number, maxEdge: number): { w: number; h: number } {
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}
