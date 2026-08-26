/** Turning a rendered receipt into bytes a thermal printer understands.
 *
 *  The receipt is printed as an **image**, not as text, and that is the whole design.
 *  ESC/POS printers render text from built-in code pages, and none of them do Persian
 *  properly: even where CP1256 exists, the printer emits isolated letterforms in
 *  left-to-right order, so «ماست موسیر» comes out as disconnected glyphs in the wrong
 *  order. Unreadable, on every printer, with no setting that fixes it.
 *
 *  So the page is drawn on a canvas at the printer's exact dot width, thresholded to one
 *  bit, and sent as a raster image. The browser does the shaping, joining and bidi --
 *  the thing it is genuinely good at -- and we get font control, a logo and a preview
 *  that is pixel-identical to the output for free, because it is the same canvas.
 *
 *  Everything here is pure. The only parts that need real hardware are the GATT
 *  characteristic UUID and the write timing, which live in the transport.
 */

/** A 58mm printer (the class that takes 57mm paper) prints 384 dots at 203 dpi. */
export const DOTS_58MM = 384;
export const BYTES_PER_ROW_58MM = DOTS_58MM / 8;

/** Below this luminance a pixel is ink. No dithering: dithered text on a thermal head
 *  reads as grey mush, and a receipt is text. */
const INK_THRESHOLD = 128;

/** Packs RGBA canvas pixels into one bit per dot, 1 meaning ink.
 *
 *  The leftmost pixel of each group of eight goes in the most significant bit, which is
 *  the order ESC/POS reads a row. Reversing it mirrors every glyph -- and mirrored
 *  Persian is not obviously wrong at a glance, which is what makes it worth a test.
 *
 *  A fully transparent pixel is paper. A canvas starts transparent, so without that the
 *  first receipt prints as a solid black rectangle and empties the roll.
 */
export function packRaster(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  threshold = INK_THRESHOLD
): Uint8Array {
  const bytesPerRow = Math.ceil(width / 8);
  const out = new Uint8Array(bytesPerRow * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const alpha = pixels[i + 3];
      if (alpha === 0) continue;

      // Rec. 601 luma, weighted the way the eye reads brightness.
      const luma = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
      // Composite against white: a half-transparent grey is lighter than it looks.
      const effective = luma * (alpha / 255) + 255 * (1 - alpha / 255);
      if (effective >= threshold) continue;

      out[y * bytesPerRow + (x >> 3)] |= 0b10000000 >> (x & 7);
    }
  }

  return out;
}

/** `GS v 0` -- print a raster bit image.
 *
 *  Both dimensions are little-endian pairs, which is why a receipt taller than 255 rows
 *  needs the high byte and a naive implementation silently prints the first inch.
 */
export function rasterCommand(packed: Uint8Array, width: number, height: number): Uint8Array {
  const bytesPerRow = Math.ceil(width / 8);
  const expected = bytesPerRow * height;
  if (packed.length !== expected) {
    // Worth throwing rather than padding: a mismatch does not error on the printer, it
    // prints shredded output and keeps feeding paper until the buffer drains.
    throw new RangeError(`داده تصویر ${packed.length} بایت است، انتظار ${expected} بایت بود`);
  }

  const out = new Uint8Array(8 + packed.length);
  out.set([
    0x1d,
    0x76,
    0x30,
    0x00, // GS v 0, mode 0 (normal density)
    bytesPerRow & 0xff,
    (bytesPerRow >> 8) & 0xff,
    height & 0xff,
    (height >> 8) & 0xff,
  ]);
  out.set(packed, 8);
  return out;
}

/** ESC @ -- reset the printer to a known state. */
export function initPrinter(): Uint8Array {
  return Uint8Array.from([0x1b, 0x40]);
}

/** Feed clear of the head, then cut.
 *
 *  The feed is not decoration: the cutter sits some millimetres past the print head, so
 *  cutting without feeding first slices through the last few lines of the receipt.
 */
export function feedAndCut(lines = 4): Uint8Array {
  return Uint8Array.from([0x1b, 0x64, lines, 0x1d, 0x56, 0x01]);
}

/** The whole job, in order, as one buffer for the transport to chunk and write. */
export function receiptBytes(
  pixels: Uint8ClampedArray,
  width: number,
  height: number
): Uint8Array {
  const image = rasterCommand(packRaster(pixels, width, height), width, height);
  const init = initPrinter();
  const tail = feedAndCut();

  const out = new Uint8Array(init.length + image.length + tail.length);
  out.set(init, 0);
  out.set(image, init.length);
  out.set(tail, init.length + image.length);
  return out;
}

/** Splits a job into writes the BLE stack will accept.
 *
 *  Bluetooth Low Energy has a small MTU -- often 20 bytes, sometimes a few hundred --
 *  and a printer's own buffer is smaller than a receipt. Writing the whole job in one
 *  go overruns it and prints garbage from halfway down, so the transport writes these
 *  in sequence with a pause between them.
 */
export function chunk(bytes: Uint8Array, size: number): Uint8Array[] {
  const pieces: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.length; offset += size) {
    pieces.push(bytes.subarray(offset, Math.min(offset + size, bytes.length)));
  }
  return pieces;
}
