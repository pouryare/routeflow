/** Where a person's photograph lives, and which canned ones exist.
 *
 *  Under `data/photos/avatars/`, NOT `public/`. `public/` is committed, so an upload
 *  written there is a real person's photograph in the next `git add -A` — and this app
 *  stores photographs of identifiable people who did not choose to be online.
 *  `data/photos` is already gitignored.
 *
 *  `ROUTEFLOW_AVATAR_DIR` exists so a test can point this at a tmp directory; it is read
 *  once at module load, exactly like `PHOTOS_DIR` in `lib/photos.ts`.
 */

import path from "node:path";
import fs from "node:fs/promises";

export const AVATAR_DIR =
  process.env.ROUTEFLOW_AVATAR_DIR ?? path.join(process.cwd(), "data", "photos", "avatars");

export type AvatarFormat = "avif" | "webp";

export interface AvatarPreset {
  /** Bare token, no separators. This is the only part that ever reaches the filesystem. */
  key: string;
  label_fa: string;
}

/** The five files already committed under `public/avatars/`, which nothing referenced. They
 *  were made for exactly this and never wired up. `scripts/seed-avatars.mjs` re-encodes
 *  them through the app's own pipeline, so a preset is the same bytes an upload would be. */
export const AVATAR_PRESETS: AvatarPreset[] = [
  { key: "hossein", label_fa: "حسین" },
  { key: "maryam", label_fa: "مریم" },
  { key: "reza", label_fa: "رضا" },
  { key: "saeed", label_fa: "سعید" },
  { key: "zahra", label_fa: "زهرا" },
];

/** `null` for anything that is not exactly one bare token. This is a security boundary, not
 *  a tidy-up: the key reaches a filesystem path, and `../../../etc/passwd` looks like a
 *  preset to every caller that forgot to check. Percent-encoding is refused too —
 *  `re%2Fza` survives one decode pass. */
export function safePresetKey(key: unknown): string | null {
  if (typeof key !== "string") return null;
  return /^[a-z0-9-]{1,40}$/.test(key) ? key : null;
}

export function avatarPaths(stem: string, format: AvatarFormat): string {
  return path.join(AVATAR_DIR, `${stem}.${format}`);
}

export async function ensureAvatarDir(): Promise<void> {
  await fs.mkdir(AVATAR_DIR, { recursive: true });
}

/** `null` rather than a throw: a missing avatar is the normal state for most users, and
 *  the renderer's answer is the initials fallback, not a 500. */
export async function readAvatarBytes(stem: string, format: AvatarFormat): Promise<Buffer | null> {
  try {
    return await fs.readFile(avatarPaths(stem, format));
  } catch {
    return null;
  }
}