/** The same receipt, as a PDF.
 *
 *  A different job from the Bluetooth path, not a fallback for it: this is the copy the
 *  customer gets on WhatsApp, the one that goes in a folder, and the one that prints on
 *  an ordinary A4 printer when there is no thermal roll.
 *
 *  Written by hand, with no library. jsPDF is roughly 300KB of client bundle for one
 *  image on one page, and this has to run in the browser -- the driver may have no
 *  signal, so it cannot be generated on the server.
 *
 *  Three details make it small and exact:
 *
 *  - The image is the **same packed 1-bit raster the ESC/POS path already produced**.
 *    48 bytes a row, so a 500-row receipt is 24KB before compression and a few after.
 *  - ESC/POS says 1 is ink; PDF DeviceGray says 0 is black. `/Decode [1 0]` inverts it
 *    in the dictionary, so there is no second copy of the bitmap and no inversion pass.
 *  - `/FlateDecode` is exactly what `CompressionStream("deflate")` produces (zlib, RFC
 *    1950 -- not "deflate-raw", which would open as a blank page). Both the browser and
 *    Node have it built in, so there is no zlib dependency.
 *
 *  The page is the size of the paper. That is the detail that decides whether printing
 *  it through a print service works: an A4 page gets scaled to fit 57mm and the receipt
 *  arrives as an unreadable strip down the middle.
 */

const MM_PER_INCH = 25.4;
const PT_PER_INCH = 72;
const DPI = 203;

/** 57mm of paper, in points. */
export const PAPER_WIDTH_PT = (57 / MM_PER_INCH) * PT_PER_INCH;

/** The 384 printable dots, in points -- narrower than the paper. */
export const IMAGE_WIDTH_PT = (384 / DPI) * PT_PER_INCH;

/** Breathing room top and bottom so the first line is not against the tear edge. */
const MARGIN_PT = 8;

const latin1 = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function receiptPdf(
  packed: Uint8Array,
  width: number,
  height: number
): Promise<Uint8Array> {
  const bytesPerRow = Math.ceil(width / 8);
  if (packed.length !== bytesPerRow * height) {
    throw new RangeError(
      `داده تصویر ${packed.length} بایت است، انتظار ${bytesPerRow * height} بایت بود`
    );
  }

  const imageHeightPt = (height / DPI) * PT_PER_INCH;
  const pageHeightPt = imageHeightPt + MARGIN_PT * 2;
  const imageX = (PAPER_WIDTH_PT - IMAGE_WIDTH_PT) / 2;

  const compressed = await deflate(packed);
  const content = `q ${IMAGE_WIDTH_PT.toFixed(2)} 0 0 ${imageHeightPt.toFixed(
    2
  )} ${imageX.toFixed(2)} ${MARGIN_PT} cm /Im0 Do Q\n`;

  const objects: (string | { head: string; body: Uint8Array })[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAPER_WIDTH_PT.toFixed(
      2
    )} ${pageHeightPt.toFixed(2)}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`,
    {
      head:
        `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height}` +
        ` /ColorSpace /DeviceGray /BitsPerComponent 1 /Decode [1 0]` +
        ` /Filter /FlateDecode /Length ${compressed.length} >>`,
      body: compressed,
    },
    { head: `<< /Length ${content.length} >>`, body: latin1(content) },
  ];

  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let cursor = 0;

  const push = (bytes: Uint8Array) => {
    parts.push(bytes);
    cursor += bytes.length;
  };

  push(latin1("%PDF-1.4\n"));
  // A comment of high bytes, which tells any tool moving the file that it is binary and
  // must not be line-ending translated. Skipping it is how a PDF survives a copy and
  // arrives corrupt.
  push(Uint8Array.from([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  objects.forEach((object, index) => {
    offsets.push(cursor);
    const number = index + 1;
    if (typeof object === "string") {
      push(latin1(`${number} 0 obj\n${object}\nendobj\n`));
      return;
    }
    push(latin1(`${number} 0 obj\n${object.head}\nstream\n`));
    push(object.body);
    push(latin1("\nendstream\nendobj\n"));
  });

  const xrefOffset = cursor;
  const xref =
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  push(latin1(xref));
  push(
    latin1(
      `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
    )
  );

  const out = new Uint8Array(cursor);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
