import sharp from "sharp";

/** The long edge, in pixels, that a stored image is capped at.
 *
 *  A photo is looked at in a lightbox, possibly on a 4K monitor, so 1600 keeps it sharp
 *  without storing a 12-megapixel original nobody will see. An avatar is a face in a
 *  circle a few dozen pixels across: 512 is already far more than any screen needs, and
 *  storing 1600 of a face is 10x the bytes for zero visible gain.
 *
 *  Both are hard ceilings rather than targets -- `withoutEnlargement` means a small
 *  image is stored at its own size, never blown up to fill the budget. */
export const PHOTO_MAX_EDGE = 1600;
export const AVATAR_MAX_EDGE = 512;

/** The two formats every stored image is written in.
 *
 *  AVIF first, WebP second, and `<picture>` on the rendering side picks whichever it can
 *  decode. Both have been in every major browser since 2021 (AVIF: Chrome 85, Firefox 93,
 *  Safari 16.4), so this is a genuine "best available" ladder and not a user-agent
 *  guess -- a UA string would be both wrong and a privacy leak. */
export const AVIF_QUALITY = 60;
export const WEBP_QUALITY = 78;

/** One encoded image, in the two formats the app serves. */
export interface EncodedImage {
  avif: Buffer;
  webp: Buffer;
}

/**
 * Decode, cap, and re-encode one uploaded image.
 *
 * This exists as a module rather than inline in the photos route because avatars need
 * exactly the same treatment. Two copies of a resize-and-encode block drift: someone
 * raises the photo cap and forgets the avatar, or the two quietly disagree about which
 * formats to write, and every `<picture>` in the app has to care about it.
 *
 * **The original is never returned or written.** Whatever the uploader sent is decoded
 * once and discarded; only these two buffers leave this function. That is the property
 * worth keeping, because an EXIF-laden original served straight from `public/` is both a
 * size problem and a location leak.
 *
 * `.rotate()` with no argument auto-orients from the EXIF orientation tag and then
 * strips it. Without it, a phone photo taken in portrait arrives sideways, and the
 * coordinates embedded in the file travel with it.
 *
 * Rejects if the input is not an image sharp can decode -- the caller turns that into a
 * 422 rather than a 500, since "you sent me a PDF" is the caller's mistake.
 */
export async function encodeImage(input: Buffer, maxEdge: number): Promise<EncodedImage> {
  const pipeline = sharp(input)
    .rotate()
    .resize({ width: maxEdge, height: maxEdge, fit: "inside", withoutEnlargement: true });

  const [avif, webp] = await Promise.all([
    pipeline.clone().avif({ quality: AVIF_QUALITY }).toBuffer(),
    pipeline.clone().webp({ quality: WEBP_QUALITY }).toBuffer(),
  ]);

  return { avif, webp };
}
