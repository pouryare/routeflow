import path from "node:path";
import fs from "node:fs";

export const PHOTOS_DIR = path.join(process.cwd(), "data", "photos");

export function ensurePhotosDir(): void {
  fs.mkdirSync(PHOTOS_DIR, { recursive: true });
}

export function photoFilePath(stem: string, format: "avif" | "webp"): string {
  return path.join(PHOTOS_DIR, `${stem}.${format}`);
}
