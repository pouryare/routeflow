import type { MarkerShape } from "@/lib/types";

/** Customer marker shapes as signed-distance images, so one MapLibre symbol layer can draw
 *  every customer on the GPU and tint each by its own colour (`icon-color`) with a rim
 *  (`icon-halo-color`). Hundreds of DOM markers were the slowest thing on a low-end phone.
 *
 *  Each shape is an exact distance function, encoded the way MapLibre reads an SDF
 *  image: 0.75 of full alpha on the edge, falling off by 1/8 per pixel outside. */
const SIZE = 48; // canvas px at pixelRatio 2: room for the diamond's corners and the rim
const HALF = 7 * 2; // the marker's half-size in canvas px

function distance(shape: MarkerShape, x: number, y: number): number {
  const ax = Math.abs(x), ay = Math.abs(y);
  switch (shape) {
    case "circle":
      return Math.hypot(x, y) - HALF;
    case "square":
      return Math.max(ax, ay) - HALF;
    case "diamond":
      // A square turned 45°, as the CSS marker is.
      return (ax + ay) / Math.SQRT2 - HALF;
    case "triangle":
      // Apex up, base on the box's bottom edge, as the CSS clip-path draws it: the
      // slanted sides have outward normal (±2, -1)/√5.
      return Math.max(y - HALF, (2 * ax - (y + HALF)) / Math.sqrt(5));
  }
}

export function markerImage(shape: MarkerShape): { width: number; height: number; data: Uint8Array } {
  const data = new Uint8Array(SIZE * SIZE * 4);
  for (let py = 0; py < SIZE; py++) {
    for (let px = 0; px < SIZE; px++) {
      const d = distance(shape, px + 0.5 - SIZE / 2, py + 0.5 - SIZE / 2);
      const a = Math.max(0, Math.min(1, 0.75 - d / 16));
      data[(py * SIZE + px) * 4 + 3] = Math.round(a * 255);
    }
  }
  return { width: SIZE, height: SIZE, data };
}

export const MARKER_SHAPES: MarkerShape[] = ["diamond", "circle", "square", "triangle"];
