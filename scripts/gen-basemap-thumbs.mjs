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
    carto:
      process.env.NEXT_PUBLIC_CARTO_BASEMAPS_KEY || out.NEXT_PUBLIC_CARTO_BASEMAPS_KEY || "",
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
/* .tiles-radar has no entry here: «رادار» is a vector style now and renders through
   MapLibre, so the CSS inversion it used to need is only ever the app's no-WebGL
   fallback, never a thumbnail. */
const APPLE = "saturate(0.6) brightness(1.05) contrast(0.9) sepia(0.1) hue-rotate(-8deg)";

const cartoGl = (s, k) =>
  `https://basemaps.cartocdn.com/gl/${s}/style.json${k ? `?key=${k}` : ""}`;

function specs({ maptiler: mt, stadia: st, carto: ck }) {
  const list = [
    { id: "dark", url: OSM, filter: QUIET_DARK },
    // CARTO's vector styles do not require a key yet, so these six render with or without
    // one. The key is passed anyway, to match what the app sends.
    { id: "radar", styleUrl: cartoGl("dark-matter-gl-style", ck) },
    st
      ? { id: "apple", url: stadia("alidade_smooth", st) }
      : mt
        ? { id: "apple", url: maptiler("basic-v2", mt) }
        : { id: "apple", url: OSM, filter: APPLE },
    { id: "positron", styleUrl: cartoGl("positron-gl-style", ck) },
    { id: "voyager", styleUrl: cartoGl("voyager-gl-style", ck) },
    { id: "radar-plain", styleUrl: cartoGl("dark-matter-nolabels-gl-style", ck) },
    { id: "positron-plain", styleUrl: cartoGl("positron-nolabels-gl-style", ck) },
    { id: "voyager-plain", styleUrl: cartoGl("voyager-nolabels-gl-style", ck) },
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

/** The centre of that same 2x2 block, for the vector styles, which are told where to look
 *  rather than which tiles to stitch. A 2x2 block of z13 tiles covers exactly what one
 *  z12 tile does, hence VECTOR_Z -- with Z the vector thumbnails would be framed twice as
 *  close as the raster ones and the picker would not read as one set. */
const CENTER = "51.328,35.669";
const VECTOR_Z = Z - 1;
const MAPLIBRE_JS = join(ROOT, "node_modules", "maplibre-gl", "dist", "maplibre-gl.js");
const MAPLIBRE_CSS = join(ROOT, "node_modules", "maplibre-gl", "dist", "maplibre-gl.css");

async function main() {
  mkdirSync(OUT, { recursive: true });
  const keys = envKeys();
  const list = specs(keys);
  console.log(
    `keys: maptiler=${keys.maptiler ? "set" : "-"} stadia=${keys.stadia ? "set" : "-"} ` +
      `carto=${keys.carto ? "set" : "-"} — ${list.length} thumbnails`,
  );

  const failed = [];
  const browser = await chromium.launch();

  for (const s of list) {
    /* A fresh page per style. Reusing one across MapLibre renders leaves the previous
       WebGL context alive and the browser hands the next map a dead one, which renders
       a blank white canvas with no error -- exactly what a stale-context failure looks
       like. Pages are cheap; silently blank thumbnails are not. */
    const page = await browser.newPage({ viewport: { width: 256, height: 256 } });
    let html;
    if (s.styleUrl) {
      // A vector style has to be rendered by the same engine the app uses. MapLibre is a
      // dependency of this project, so it is served to the page from node_modules rather
      // than a CDN.
      html = `<!doctype html><meta charset=utf8>
        <style>${readFileSync(MAPLIBRE_CSS, "utf8")}</style>
        <style>html,body,#c{margin:0;width:256px;height:256px}</style>
        <div id="c"></div>
        <script>${readFileSync(MAPLIBRE_JS, "utf8")}</script>
        <script>
          window.ready=false;
          const m=new maplibregl.Map({container:'c',style:${JSON.stringify(s.styleUrl)},
            center:[${CENTER}],zoom:${VECTOR_Z},attributionControl:false,interactive:false});
          m.on('idle',()=>{window.ready=true});
        </script>`;
    } else {
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
                  "routeflow basemap-thumbnail generator (+https://github.com/, lightlines.dev@gmail.com)",
              },
            });
            const buf = Buffer.from(await r.arrayBuffer());
            const mime = r.headers.get("content-type") || "image/png";
            return `<div style="background-image:url('data:${mime};base64,${buf.toString("base64")}');background-size:cover"></div>`;
          }),
        )
      ).join("");
      html = `<!doctype html><meta charset=utf8><style>
        html,body{margin:0}
        #c{width:256px;height:256px;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;
           ${s.filter ? `filter:${s.filter};` : ""}}
        #c>div{width:128px;height:128px;background:#1b1b1b}
      </style><div id="c">${cells}</div>`;
    }

    await page.setContent(html, { waitUntil: "load" });
    if (s.styleUrl) {
      await page
        .waitForFunction("window.ready===true", { timeout: 30000 })
        .catch(() => console.log(`  (${s.id}: render timed out, capturing anyway)`));
      // Labels land a frame or two after 'idle'.
      await page.waitForTimeout(800);
    } else {
      await page.waitForTimeout(200);
    }
    const shot = await page.locator("#c").screenshot();
    // The picker renders these ~96px wide; 192 keeps them crisp on retina. A 6-bit
    // palette holds the file to a few KB without a visible hit at this size.
    await sharp(shot)
      .resize(192, 192)
      .png({ palette: true, quality: 70, colours: 64 })
      .toFile(join(OUT, `${s.id}.png`));

    /* A style that renders as one flat colour is a failed render, not a design: even
       Positron, the palest style here, carries roads. Caught rather than committed,
       because a blank thumbnail looks like a deliberate empty swatch in the picker. */
    const { channels } = await sharp(join(OUT, `${s.id}.png`)).stats();
    const flat = channels.every((c) => c.stdev < 2);
    console.log(`  ${s.id}.png${flat ? "   ** BLANK -- render failed **" : ""}`);
    if (flat) failed.push(s.id);

    await page.close();
  }

  await browser.close();

  if (failed.length) {
    console.error(`\n${failed.length} blank thumbnail(s): ${failed.join(", ")}`);
    console.error("Re-run; if it persists the style URL or the renderer is broken.");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
