#!/usr/bin/env node
/**
 * Re-encode the five committed presets through the app's own image pipeline.
 *
 * `public/avatars/*.jpg` are raw originals that nothing referenced. Leaving them raw means
 * the app has exactly one image surface that skips the resize/avif+webp step every other
 * image goes through, which is the inconsistency this removes. Run once:
 *
 *   node scripts/seed-avatars.mjs
 *
 * Idempotent: it rewrites the same five stems each time. The originals stay in `public/`
 * as the seed source — deleting them would make a fresh clone unable to produce presets.
 *
 * The resize/avif+webp block below is duplicated from `encodeImage` in lib/imagePipeline.ts
 * on purpose, for the same reason scripts/gen-basemap-thumbs.mjs duplicates its catalogue:
 * this project carries no TS loader, so a one-off `.mjs` generator cannot import a `.ts`
 * module. If you change one, change both — `MAX_EDGE` here must stay equal to
 * `AVATAR_MAX_EDGE` there.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "public", "avatars");
const OUT = process.env.ROUTEFLOW_AVATAR_DIR ?? path.join(ROOT, "data", "photos", "avatars");
const MAX_EDGE = 512; // === AVATAR_MAX_EDGE in lib/imagePipeline.ts
const AVIF_QUALITY = 60;
const WEBP_QUALITY = 78;

await fs.mkdir(OUT, { recursive: true });

const files = (await fs.readdir(SRC)).filter((f) => /\.(jpe?g|png)$/i.test(f));
if (files.length === 0) {
  console.error(`no presets found in ${SRC}`);
  process.exit(1);
}

for (const file of files) {
  // `driver.hossein.jpg` seeds the preset keyed `hossein`; the prefix is stripped so the
  // stem is the same string lib/avatarPresets.ts publishes in AVATAR_PRESETS.
  const stem = path.basename(file).replace(/\.[^.]+$/, "").replace(/^driver\./, "");
  const input = await fs.readFile(path.join(SRC, file));

  const pipeline = sharp(input)
    .rotate() // auto-orient from EXIF, then strip it
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true });

  const [avif, webp] = await Promise.all([
    pipeline.clone().avif({ quality: AVIF_QUALITY }).toBuffer(),
    pipeline.clone().webp({ quality: WEBP_QUALITY }).toBuffer(),
  ]);

  await fs.writeFile(path.join(OUT, `${stem}.avif`), avif);
  await fs.writeFile(path.join(OUT, `${stem}.webp`), webp);
  console.log(`${stem}: ${avif.length}b avif, ${webp.length}b webp`);
}

console.log(`\nseeded ${files.length} preset avatars into ${OUT}`);