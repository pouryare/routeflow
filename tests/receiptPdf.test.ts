import { describe, expect, test } from "vitest";
import { receiptPdf, PAPER_WIDTH_PT, IMAGE_WIDTH_PT } from "@/lib/receiptPdf";
import { DOTS_58MM, BYTES_PER_ROW_58MM } from "@/lib/escpos";

const ROWS = 120;
const packed = new Uint8Array(BYTES_PER_ROW_58MM * ROWS).map((_, i) => (i * 37) % 256);

const text = (bytes: Uint8Array) => new TextDecoder("latin1").decode(bytes);

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

describe("page geometry", () => {
  test("the page is exactly the paper width", () => {
    // 57mm at 72pt/inch. If the page were A4 the receipt would be scaled to fit and
    // come out as a narrow strip down the middle -- the classic failure of printing a
    // PDF to a thermal printer.
    expect(PAPER_WIDTH_PT).toBeCloseTo(161.57, 1);
  });

  test("the image box is the printable width, not the paper width", () => {
    // 384 dots at 203dpi is 48.05mm, narrower than the 57mm paper.
    expect(IMAGE_WIDTH_PT).toBeCloseTo(136.2, 1);
  });
});

describe("receiptPdf", () => {
  test("is a PDF", async () => {
    const pdf = await receiptPdf(packed, DOTS_58MM, ROWS);
    expect(text(pdf).startsWith("%PDF-")).toBe(true);
    expect(text(pdf).trimEnd().endsWith("%%EOF")).toBe(true);
  });

  test("declares the image as one bit of grey per dot", async () => {
    const body = text(await receiptPdf(packed, DOTS_58MM, ROWS));
    expect(body).toContain("/ColorSpace /DeviceGray");
    expect(body).toContain("/BitsPerComponent 1");
  });

  test("flips the polarity with a Decode array rather than a second copy of the image", async () => {
    // ESC/POS says 1 is ink; PDF DeviceGray says 0 is black. /Decode [1 0] inverts it
    // in the page dictionary, so the same packed bytes feed both outputs.
    expect(text(await receiptPdf(packed, DOTS_58MM, ROWS))).toContain("/Decode [1 0]");
  });

  test("compresses the image with Flate", async () => {
    expect(text(await receiptPdf(packed, DOTS_58MM, ROWS))).toContain("/Filter /FlateDecode");
  });

  test("sets the page to the paper size", async () => {
    const body = text(await receiptPdf(packed, DOTS_58MM, ROWS));
    expect(body).toMatch(/\/MediaBox \[0 0 161\.5[0-9]* /);
  });

  test("round-trips the image data exactly", async () => {
    // The strongest check here: pull the stream back out, inflate it, and confirm it is
    // byte-for-byte what went in. A wrong length or a raw-vs-zlib mix-up produces a
    // file that opens and shows nothing.
    const pdf = await receiptPdf(packed, DOTS_58MM, ROWS);
    const body = text(pdf);
    const start = body.indexOf("stream\n", body.indexOf("/FlateDecode")) + "stream\n".length;
    const end = body.indexOf("\nendstream", start);
    const recovered = await inflate(pdf.subarray(start, end));
    expect(Array.from(recovered)).toEqual(Array.from(packed));
  });

  test("is smaller than the raw image, which is the point of compressing it", async () => {
    const blank = new Uint8Array(BYTES_PER_ROW_58MM * ROWS);
    const pdf = await receiptPdf(blank, DOTS_58MM, ROWS);
    expect(pdf.length).toBeLessThan(blank.length);
  });

  test("every xref offset points at the object it claims", async () => {
    // The part of writing a PDF by hand that actually goes wrong. A byte offset that is
    // off by one gives a file some readers open and others refuse, with no clue why.
    const pdf = await receiptPdf(packed, DOTS_58MM, ROWS);
    const body = text(pdf);

    const startxref = Number(/startxref\s+(\d+)/.exec(body)![1]);
    expect(body.slice(startxref, startxref + 4)).toBe("xref");

    const table = body.slice(startxref);
    const offsets = [...table.matchAll(/^(\d{10}) \d{5} n\s*$/gm)].map((m) => Number(m[1]));
    expect(offsets.length).toBeGreaterThan(0);

    offsets.forEach((offset, index) => {
      expect(body.slice(offset)).toMatch(new RegExp(`^${index + 1} 0 obj`));
    });
  });

  test("counts every object in the trailer", async () => {
    const body = text(await receiptPdf(packed, DOTS_58MM, ROWS));
    const size = Number(/\/Size (\d+)/.exec(body)![1]);
    const objects = [...body.matchAll(/^\d+ 0 obj/gm)].length;
    expect(size).toBe(objects + 1); // object 0 is the free head of the chain
  });

  test("scales the page height with the number of rows", async () => {
    const short = await receiptPdf(new Uint8Array(BYTES_PER_ROW_58MM * 50), DOTS_58MM, 50);
    const tall = await receiptPdf(new Uint8Array(BYTES_PER_ROW_58MM * 500), DOTS_58MM, 500);
    const heightOf = (pdf: Uint8Array) =>
      Number(/\/MediaBox \[0 0 [\d.]+ ([\d.]+)\]/.exec(text(pdf))![1]);
    expect(heightOf(tall)).toBeGreaterThan(heightOf(short));
  });

  test("refuses data that does not match the dimensions", async () => {
    await expect(receiptPdf(new Uint8Array(10), DOTS_58MM, ROWS)).rejects.toThrow();
  });
});
