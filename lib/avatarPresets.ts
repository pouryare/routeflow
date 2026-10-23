/** Which canned photographs exist. Split out of `lib/avatarStore.ts` because that module
 *  imports `node:fs`, and the admin users page (a client component) needs the same list —
 *  it used to carry a hand-synced copy, where a mismatch showed only as a 404 thumbnail. */

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
