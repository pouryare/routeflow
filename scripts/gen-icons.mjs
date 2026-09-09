// One-off generator for the RouteFlow brand mark's raster deliverables, run once and
// checked in (not part of the build) -- see docs/superpowers/plans/2026-09-09-brand-mark.md.
// Renders app/icon.svg via sharp (already a project dependency, links librsvg) to:
//   - app/apple-icon.png (180x180, iOS home screen)
//   - a maskable 512x512 PNG for the PWA manifest, from a separate safe-zone SVG
//   - app/favicon.ico (16x16 + 32x32, hand-assembled -- modern .ico embeds PNG data
//     directly per entry, which needs no third-party ICO encoder)
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(import.meta.dirname, "..");
const MASTER_SVG = fs.readFileSync(path.join(ROOT, "app/icon.svg"));

// Maskable variant: full-bleed square (the OS applies its own corner/circle mask, so
// this file must not pre-round its own corners) with the mark scaled into the W3C
// maskable-icon safe zone (content confined to the inner ~80%, i.e. the "important"
// content sits within a centred circle of 80% of the icon's diameter).
const MASKABLE_SVG = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" fill="#101216"/>
  <g transform="translate(50 50) scale(0.7) translate(-50 -50)">
    <path d="M15,72 Q50,15 85,58" stroke="#FFFFFF" stroke-width="4.5" stroke-linecap="round" fill="none" opacity=".55"/>
    <circle cx="15" cy="72" r="3" fill="#FFFFFF" opacity=".55"/>
    <circle cx="85" cy="58" r="3" fill="#FFFFFF" opacity=".55"/>
    <circle cx="50" cy="40" r="13" fill="none" stroke="#FFFFFF" stroke-width="1.6" opacity=".4"/>
    <circle cx="50" cy="40" r="8" fill="#FFFFFF"/>
  </g>
</svg>
`);

async function renderPng(svgBuffer, size) {
  return sharp(svgBuffer, { density: 384 }).resize(size, size).png().toBuffer();
}

/** Assembles a minimal Vista+ .ico: an ICONDIR header, one ICONDIRENTRY per image, then
 *  the PNG blobs themselves back to back -- every modern OS/browser accepts a PNG-typed
 *  ICO entry directly, so this needs no BMP/DIB encoding. */
function buildIco(pngBuffers) {
  const count = pngBuffers.length;
  const headerSize = 6 + count * 16;
  let offset = headerSize;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(count, 4);

  const entries = [];
  for (const png of pngBuffers) {
    const entry = Buffer.alloc(16);
    // sharp always renders our square icons, so width == height for every buffer here.
    const dim = png.__size >= 256 ? 0 : png.__size; // 0 means 256 in the ICO format
    entry.writeUInt8(dim, 0); // width
    entry.writeUInt8(dim, 1); // height
    entry.writeUInt8(0, 2); // color count (0 = no palette)
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8); // bytes in resource
    entry.writeUInt32LE(offset, 12); // offset from start of file
    offset += png.length;
    entries.push(entry);
  }

  return Buffer.concat([header, ...entries, ...pngBuffers]);
}

async function main() {
  const appleIcon = await renderPng(MASTER_SVG, 180);
  fs.writeFileSync(path.join(ROOT, "app/apple-icon.png"), appleIcon);
  console.log("wrote app/apple-icon.png (180x180)");

  const maskable = await renderPng(MASKABLE_SVG, 512);
  fs.mkdirSync(path.join(ROOT, "public/icons"), { recursive: true });
  fs.writeFileSync(path.join(ROOT, "public/icons/maskable-512.png"), maskable);
  console.log("wrote public/icons/maskable-512.png (512x512, maskable)");

  const png16 = await renderPng(MASTER_SVG, 16);
  png16.__size = 16;
  const png32 = await renderPng(MASTER_SVG, 32);
  png32.__size = 32;
  const ico = buildIco([png16, png32]);
  fs.writeFileSync(path.join(ROOT, "app/favicon.ico"), ico);
  console.log("wrote app/favicon.ico (16x16 + 32x32)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
