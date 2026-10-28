/* Pre-render the basemap picker thumbnails into public/basemap-thumbs/<id>.png.
 *
 * The picker in components/LayersPanel.tsx shows a static PNG per style rather than a
 * live mini-map, so these are committed to the repo. Re-run this whenever the catalogue
 * in lib/mapLayers.ts or the tile file changes:
 *
 *   npm run dev            # or any running copy of the app with the tile file in place
 *   node --experimental-strip-types scripts/gen-basemap-thumbs.mjs [http://127.0.0.1:3000]
 *
 * Every style is drawn by MapLibre from the app's own tiles, sprites and fonts, the same
 * way the map draws it, and the catalogue and style are imported from lib/ rather than
 * copied, so a thumbnail cannot drift from what the picker switches to.
 */
import { chromium } from "playwright";
import sharp from "sharp";
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public", "basemap-thumbs");
const DIST = join(ROOT, "node_modules", "maplibre-gl", "dist");
const BASE = (process.argv[2] ?? "http://127.0.0.1:3000").replace(/\/$/, "");

const { BASEMAPS } = await import(join(ROOT, "lib", "mapLayers.ts"));
const { protomapsStyle } = await import(join(ROOT, "lib", "mapStyle.ts"));

// Central Tehran, close enough in for streets and their names.
const CENTER = [51.389, 35.7];
const ZOOM = 13;

async function main() {
  mkdirSync(OUT, { recursive: true });
  const failed = [];
  const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });

  for (const b of BASEMAPS) {
    /* A fresh context per style. Reusing one across MapLibre renders leaves the previous
       WebGL context alive and the next map gets a dead one: a blank canvas, no error. */
    const ctx = await browser.newContext({ viewport: { width: 256, height: 256 } });
    // The page is served under the app's own origin, so tiles, sprites and fonts load
    // without CORS, exactly as they do for the map.
    await ctx.route(`${BASE}/__thumb/**`, (route) => {
      const name = new URL(route.request().url()).pathname.slice("/__thumb/".length);
      if (name === "index.html") {
        const style = protomapsStyle(b.flavor, BASE, { labels: b.hasLabels });
        return route.fulfill({
          contentType: "text/html",
          body: `<!doctype html><meta charset=utf8>
            <link rel="stylesheet" href="maplibre-gl.css">
            <style>html,body,#c{margin:0;width:256px;height:256px}</style>
            <div id="c"></div>
            <script type="module">
              import { Map, setWorkerUrl } from "./maplibre-gl.mjs";
              setWorkerUrl(new URL("maplibre-gl-worker.mjs", location.href).href);
              const m = new Map({ container: "c", style: ${JSON.stringify(style)},
                center: ${JSON.stringify(CENTER)}, zoom: ${ZOOM}, attributionControl: false, interactive: false });
              m.on("idle", () => { window.ready = true; });
            </script>`,
        });
      }
      return route.fulfill({
        contentType: name.endsWith(".css") ? "text/css" : "text/javascript",
        body: readFileSync(join(DIST, name)),
      });
    });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/__thumb/index.html`);
    await page
      .waitForFunction("window.ready === true", { timeout: 30000 })
      .catch(() => console.log(`  (${b.id}: render timed out, capturing anyway)`));
    await page.waitForTimeout(800); // labels land a frame or two after 'idle'
    const shot = await page.locator("#c").screenshot();
    // The picker renders these ~96px wide; 192 keeps them crisp on retina.
    await sharp(shot)
      .resize(192, 192)
      .png({ palette: true, quality: 70, colours: 64 })
      .toFile(join(OUT, `${b.id}.png`));

    /* One flat colour is a failed render (no tiles, no WebGL), not a design. */
    const { channels } = await sharp(join(OUT, `${b.id}.png`)).stats();
    const flat = channels.every((c) => c.stdev < 2);
    console.log(`  ${b.id}.png${flat ? "   ** BLANK -- render failed **" : ""}`);
    if (flat) failed.push(b.id);
    await ctx.close();
  }

  await browser.close();
  if (failed.length) {
    console.error(`\n${failed.length} blank thumbnail(s): ${failed.join(", ")}`);
    console.error(`Is the app running at ${BASE} with the tile file in place (docs/map-tiles.md)?`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
