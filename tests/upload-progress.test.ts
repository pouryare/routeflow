// UploadTile (components/UploadTile.tsx) shows lib/uploadProgress.ts's percent on the photo.
import { describe, it, expect } from "vitest";
import { uploadPercent } from "@/lib/uploadProgress";

describe("upload ring percent", () => {
  it("rounds to whole percent", () => expect(uploadPercent(1, 3)).toBe(33));
  it("stays in 0..100", () => {
    expect(uploadPercent(5, 4)).toBe(100);
    expect(uploadPercent(-1, 4)).toBe(0);
  });
  it("an unknown total reads 0", () => expect(uploadPercent(50, 0)).toBe(0));
});
