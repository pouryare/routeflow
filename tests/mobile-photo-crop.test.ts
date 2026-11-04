import { describe, expect, it } from "vitest";
import { cropRect, photoProblem, MAX_PHOTO_BYTES } from "@/lib/photoCrop";

// PhotoCropSheet (components/mobile/PhotoCropSheet.tsx) frames a photo with these.
describe("photo crop", () => {
  it("keeps the whole picture when no ratio is chosen", () => {
    expect(cropRect(4000, 3000, null)).toEqual({ x: 0, y: 0, w: 4000, h: 3000 });
  });
  it("crops a landscape photo to a centred square", () => {
    expect(cropRect(4000, 3000, 1)).toEqual({ x: 500, y: 0, w: 3000, h: 3000 });
  });
  it("crops a landscape photo to 3:4 portrait", () => {
    const r = cropRect(4000, 3000, 3 / 4);
    expect(r.h).toBe(3000);
    expect(r.w).toBe(2250);
    expect(r.x).toBe(875);
  });
  it("never goes outside the picture", () => {
    const r = cropRect(300, 1000, 4 / 3);
    expect(r.x + r.w).toBeLessThanOrEqual(300);
    expect(r.y + r.h).toBeLessThanOrEqual(1000);
  });
  it("refuses non-images and files over the ceiling", () => {
    expect(photoProblem({ type: "application/pdf", size: 10 })).not.toBeNull();
    expect(photoProblem({ type: "image/jpeg", size: MAX_PHOTO_BYTES + 1 })).not.toBeNull();
    expect(photoProblem({ type: "image/jpeg", size: 1000 })).toBeNull();
  });
});
