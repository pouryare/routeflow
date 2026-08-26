import { describe, expect, test } from "vitest";
import {
  DOTS_58MM,
  BYTES_PER_ROW_58MM,
  packRaster,
  rasterCommand,
  chunk,
  initPrinter,
  feedAndCut,
  receiptBytes,
} from "@/lib/escpos";

/** Builds RGBA pixel data the way a canvas hands it over. */
function rgba(width: number, height: number, pixel: (x: number, y: number) => number[]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixel(x, y);
      const i = (y * width + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  return data;
}

const BLACK = [0, 0, 0, 255];
const WHITE = [255, 255, 255, 255];

describe("the 58mm paper", () => {
  test("is 384 dots across, which is 48 bytes a row", () => {
    expect(DOTS_58MM).toBe(384);
    expect(BYTES_PER_ROW_58MM).toBe(48);
  });
});

describe("packRaster", () => {
  test("packs eight black pixels into one full byte", () => {
    const packed = packRaster(rgba(8, 1, () => BLACK), 8, 1);
    expect(Array.from(packed)).toEqual([0b11111111]);
  });

  test("packs eight white pixels into one empty byte", () => {
    const packed = packRaster(rgba(8, 1, () => WHITE), 8, 1);
    expect(Array.from(packed)).toEqual([0b00000000]);
  });

  test("puts the leftmost pixel in the most significant bit", () => {
    // ESC/POS reads a row left to right from the high bit down. Getting this backwards
    // mirrors every glyph, which on Persian text is not obviously wrong at a glance.
    const packed = packRaster(rgba(8, 1, (x) => (x === 0 ? BLACK : WHITE)), 8, 1);
    expect(Array.from(packed)).toEqual([0b10000000]);
  });

  test("packs alternating pixels", () => {
    const packed = packRaster(rgba(8, 1, (x) => (x % 2 === 0 ? BLACK : WHITE)), 8, 1);
    expect(Array.from(packed)).toEqual([0b10101010]);
  });

  test("treats a fully transparent pixel as paper, not ink", () => {
    // A canvas starts transparent. Without this, every receipt prints as a solid black
    // rectangle and empties the roll.
    const packed = packRaster(rgba(8, 1, () => [0, 0, 0, 0]), 8, 1);
    expect(Array.from(packed)).toEqual([0b00000000]);
  });

  test("thresholds mid greys to ink or paper", () => {
    const dark = packRaster(rgba(8, 1, () => [60, 60, 60, 255]), 8, 1);
    const light = packRaster(rgba(8, 1, () => [200, 200, 200, 255]), 8, 1);
    expect(dark[0]).toBe(0b11111111);
    expect(light[0]).toBe(0b00000000);
  });

  test("pads a width that is not a whole number of bytes", () => {
    const packed = packRaster(rgba(4, 1, () => BLACK), 4, 1);
    expect(packed).toHaveLength(1);
    expect(Array.from(packed)).toEqual([0b11110000]);
  });

  test("emits one row of bytes per row of pixels", () => {
    const packed = packRaster(rgba(16, 3, () => BLACK), 16, 3);
    expect(packed).toHaveLength(6);
  });

  test("keeps rows separate rather than running them together", () => {
    const packed = packRaster(rgba(8, 2, (_x, y) => (y === 0 ? BLACK : WHITE)), 8, 2);
    expect(Array.from(packed)).toEqual([0b11111111, 0b00000000]);
  });
});

describe("rasterCommand", () => {
  const packed = new Uint8Array(48 * 2).fill(0xff);

  test("starts with GS v 0 and mode zero", () => {
    const cmd = rasterCommand(packed, 384, 2);
    expect(Array.from(cmd.slice(0, 4))).toEqual([0x1d, 0x76, 0x30, 0x00]);
  });

  test("carries the width in bytes, little endian", () => {
    const cmd = rasterCommand(packed, 384, 2);
    expect(Array.from(cmd.slice(4, 6))).toEqual([48, 0]);
  });

  test("carries the height in rows, little endian", () => {
    const cmd = rasterCommand(new Uint8Array(48 * 300).fill(0), 384, 300);
    expect(Array.from(cmd.slice(6, 8))).toEqual([300 % 256, Math.floor(300 / 256)]);
  });

  test("appends the pixel data after the eight header bytes", () => {
    const cmd = rasterCommand(packed, 384, 2);
    expect(cmd).toHaveLength(8 + packed.length);
    expect(cmd[8]).toBe(0xff);
  });

  test("refuses data that does not match the dimensions", () => {
    // A mismatch here does not error on the printer, it prints shredded output and
    // keeps feeding paper until the buffer drains.
    expect(() => rasterCommand(new Uint8Array(10), 384, 2)).toThrow();
  });
});

describe("chunk", () => {
  test("splits into pieces of the requested size", () => {
    const pieces = chunk(new Uint8Array(50), 20);
    expect(pieces.map((p) => p.length)).toEqual([20, 20, 10]);
  });

  test("returns one piece when it already fits", () => {
    expect(chunk(new Uint8Array(10), 20)).toHaveLength(1);
  });

  test("returns nothing for no bytes", () => {
    expect(chunk(new Uint8Array(0), 20)).toEqual([]);
  });

  test("preserves the bytes in order", () => {
    const source = Uint8Array.from([1, 2, 3, 4, 5]);
    const rejoined = chunk(source, 2).flatMap((p) => Array.from(p));
    expect(rejoined).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("initPrinter and feedAndCut", () => {
  test("initialise is ESC @", () => {
    expect(Array.from(initPrinter())).toEqual([0x1b, 0x40]);
  });

  test("feed and cut ends with a cut command", () => {
    const bytes = Array.from(feedAndCut());
    expect(bytes.slice(-3)).toEqual([0x1d, 0x56, 0x01]);
  });

  test("feeds before cutting, so the last line clears the blade", () => {
    const bytes = Array.from(feedAndCut());
    expect(bytes.slice(0, 2)).toEqual([0x1b, 0x64]);
  });
});

describe("receiptBytes", () => {
  test("is initialise, then image, then feed and cut", () => {
    const pixels = rgba(384, 2, () => BLACK);
    const bytes = receiptBytes(pixels, 384, 2);

    expect(Array.from(bytes.slice(0, 2))).toEqual([0x1b, 0x40]);
    expect(Array.from(bytes.slice(2, 5))).toEqual([0x1d, 0x76, 0x30]);
    expect(Array.from(bytes.slice(-3))).toEqual([0x1d, 0x56, 0x01]);
  });

  test("is one buffer the caller can chunk and write", () => {
    const pixels = rgba(384, 10, () => WHITE);
    expect(receiptBytes(pixels, 384, 10)).toBeInstanceOf(Uint8Array);
  });
});
