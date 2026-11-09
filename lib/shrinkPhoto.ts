import { cropRect, fitInside } from "@/lib/photoCrop";

/** The same long edge the server stores a photo at (PHOTO_MAX_EDGE in lib/imagePipeline.ts, which pulls in
 *  sharp and so cannot be imported here). An avatar passes 512, as the server does. */
const UPLOAD_MAX_EDGE = 1600;
const UPLOAD_QUALITY = 0.8;

/** A smaller copy of a photo to send over a slow line: centre-cropped to `ratio` when given, scaled so the
 *  long edge is at most `maxEdge`, saved as JPEG (a 4 MB camera file becomes about 300 KB; the server shrinks
 *  to this size anyway, so nothing visible is lost). Returns the original file when the browser cannot decode
 *  it, or when the copy would not be smaller and no crop was asked for. Never throws. */
export async function shrinkPhoto(file: File, opts: { maxEdge?: number; ratio?: number | null } = {}): Promise<File> {
  const ratio = opts.ratio ?? null;
  try {
    // from-image: apply the camera's rotation, because the canvas copy carries no EXIF.
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const r = cropRect(bmp.width, bmp.height, ratio);
    const to = fitInside(r.w, r.h, opts.maxEdge ?? UPLOAD_MAX_EDGE);
    const canvas = document.createElement("canvas");
    canvas.width = to.w;
    canvas.height = to.h;
    canvas.getContext("2d")?.drawImage(bmp, r.x, r.y, r.w, r.h, 0, 0, to.w, to.h);
    bmp.close();
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", UPLOAD_QUALITY));
    if (!blob || (ratio === null && blob.size >= file.size)) return file;
    return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file; // cannot decode here (an odd format): send it as it is and let the server handle it
  }
}
