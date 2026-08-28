/* Pre-render the basemap picker thumbnails into public/basemap-thumbs/<id>.png.
 *
 * The picker in components/LayersPanel.tsx shows a static PNG per style rather than a
 * live mini-map, so these are committed to the repo. Re-run this whenever the catalogue
 * in lib/mapLayers.ts changes or a provider restyles:
 *
 *   node scripts/gen-basemap-thumbs.mjs
 *
 * Keys are read from .env.local. A style whose key is missing is rendered from its raw
 * OpenStreetMap fallback with the same CSS tone the app would apply, so the thumbnail
 * still matches what that visitor sees.
 *
 * The spec below mirrors buildBasemaps() in lib/mapLayers.ts. It is duplicated on
 * purpose: this is a one-off generator and importing the TS catalogue would need a
 * loader the project does not carry.
 */
import { chromium } from "playwright";
import sharp from "sharp";
import { readFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public", "basemap-thumbs");

function envKeys() {
  const out = {};
  const path = join(ROOT, ".env.local");
  if (existsSync(path)) {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) out[m[1]] = m[2];
    }
  }
  return {
    maptiler: process.env.NEXT_PUBLIC_MAPTILER_KEY || out.NEXT_PUBLIC_MAPTILER_KEY || "",
    stadia: process.env.NEXT_PUBLIC_STADIA_KEY || out.NEXT_PUBLIC_STADIA_KEY || "",
  };
}

const OSM = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const stadia = (s, k, ext = "png") =>
  `https://tiles.stadiamaps.com/tiles/${s}/{z}/{x}/{y}.${ext}?api_key=${k}`;
const maptiler = (s, k, ext = "png") =>
  `https://api.maptiler.com/maps/${s}/256/{z}/{x}/{y}.${ext}?key=${k}`;

// The CSS tones from app/globals.css, dark skin (the app's default).
const QUIET_DARK =
  "invert(1) hue-rotate(180deg) saturate(0.3) brightness(0.62) contrast(1.05) sepia(0.22)";
const RADAR = "invert(1) hue-rotate(198deg) saturate(0.55) brightness(0.52) contrast(1.2)";
const APPLE = "saturate(0.6) brightness(1.05) contrast(0.9) sepia(0.1) hue-rotate(-8deg)";

function specs({ maptiler: mt, stadia: st }) {
  const list = [
    { id: "dark", url: OSM, filter: QUIET_DARK },
    st
      ? { id: "radar", url: stadia("alidade_smooth_dark", st) }
      : mt
        ? { id: "radar", url: maptiler("dataviz-dark", mt) }
        : { id: "radar", url: OSM, filter: RADAR },
    st
      ? { id: "apple", url: stadia("alidade_smooth", st) }
      : mt
        ? { id: "apple", url: maptiler("basic-v2", mt) }
        : { id: "apple", url: OSM, filter: APPLE },
    { id: "streets", url: OSM },
    {
      id: "satellite",
      url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    },
    {
      id: "topo",
      url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
    },
    { id: "hot", url: "https://a.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png" },
  ];
  if (st) {
    list.push(
      { id: "toner", url: stadia("stamen_toner", st) },
      { id: "terrain", url: stadia("stamen_terrain", st) },
      { id: "watercolor", url: stadia("stamen_watercolor", st, "jpg") },
    );
  }
  if (mt) {
    list.push(
      { id: "mt-basic", url: maptiler("basic-v2", mt) },
      { id: "mt-streets", url: maptiler("streets-v2", mt) },
      { id: "mt-outdoor", url: maptiler("outdoor-v2", mt) },
      { id: "mt-satellite", url: maptiler("satellite", mt, "jpg") },
    );
  }
  return list;
}

// z13 over north-central Tehran: a 2x2 block around Punak/Sadeghieh. Chosen a little off
// the exact centre so none of the four tiles is the one a provider stamps its
// attribution strip onto.
const Z = 13;
const TILES = [
  [5263, 3222],
  [5264, 3222],
  [5263, 3223],
  [5264, 3223],
];
const fill = (tpl, x, y) =>
  tpl.replace("{z}", Z).replace("{x}", x).replace("{y}", y).replace("{s}", "a");

async function main() {
  mkdirSync(OUT, { recursive: true });
  const keys = envKeys();
  const list = specs(keys);
  console.log(
    `keys: maptiler=${keys.maptiler ? "set" : "-"} stadia=${keys.stadia ? "set" : "-"} — ${list.length} thumbnails`,
  );

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 256, height: 256 } });

  for (const s of list) {
    // Fetch tiles here rather than letting the page request them: a browser page served
    // from about:blank has a null Origin, and some providers (Stadia) answer that with a
    // faintly watermarked tile. A plain server fetch gets the clean tile.
    const cells = (
      await Promise.all(
        TILES.map(async ([x, y]) => {
          // A real User-Agent with a contact: OSM's tile servers 403 anything that looks
          // like an unattended library client.
          const r = await fetch(fill(s.url, x, y), {
            headers: {
              "User-Agent":
                "coverage-map basemap-thumbnail generator (+https://github.com/, lightlines.dev@gmail.com)",
            },
          });
          const buf = Buffer.from(await r.arrayBuffer());
          const mime = r.headers.get("content-type") || "image/png";
          return `<div style="background-image:url('data:${mime};base64,${buf.toString("base64")}');background-size:cover"></div>`;
        }),
      )
    ).join("");
    const html = `<!doctype html><meta charset=utf8><style>
      html,body{margin:0}
      #c{width:256px;height:256px;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;
         ${s.filter ? `filter:${s.filter};` : ""}}
      #c>div{width:128px;height:128px;background:#1b1b1b}
    </style><div id="c">${cells}</div>`;
    await page.setContent(html, { waitUntil: "load" });
    await page.waitForTimeout(200);
    const shot = await page.locator("#c").screenshot();
    // The picker renders these ~96px wide; 192 keeps them crisp on retina. A 6-bit
    // palette holds the file to a few KB without a visible hit at this size.
    await sharp(shot)
      .resize(192, 192)
      .png({ palette: true, quality: 70, colours: 64 })
      .toFile(join(OUT, `${s.id}.png`));
    console.log(`  ${s.id}.png`);
  }

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
