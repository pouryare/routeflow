# Map tiles: our own basemap

Every map in RouteFlow draws its background from this server. No map request goes to a foreign tile host (owner's decision, 2026-10-28; `docs/roadmap.md` 10.1).

## How it fits together

| Piece | Where | What it does |
|---|---|---|
| Tile file | `data/map/basemap.pmtiles` (or `ROUTEFLOW_MAP_TILES`) | One Protomaps PMTiles file holding Tehran province's vector tiles, zoom 0 to 15. Not in git. |
| Tile route | `app/api/map/tiles/[z]/[x]/[y]/route.ts`, `lib/mapTiles.ts` | Reads one tile out of the file and answers it gzipped, `Cache-Control: public, max-age=604800`. 204 where the file has no tile, 503 when the file is missing. Public and cookie-free, so a CDN can cache it. |
| Style | `lib/mapStyle.ts` | Protomaps' style (`@protomaps/basemaps`) with Persian names (`name:fa`) in the app's Peyda font. Seven looks in `lib/mapLayers.ts`. |
| Fonts | `public/fonts/PeydaFaNumWeb-*.woff2` | Read by MapLibre through the style's `font-faces`; no glyph server. |
| Sprites | `public/map/sprites/` | Protomaps' v4 icon sheets (light and dark), from `protomaps/basemaps-assets`. |
| Picker thumbnails | `public/basemap-thumbs/` | Drawn by `scripts/gen-basemap-thumbs.mjs` from the running app. |

The phone never downloads the PMTiles file. It asks for small `/z/x/y` tiles like any web map, and the service worker keeps the ones it has seen (`public/sw.js`, cache `map-tiles-v4`).

## Making the file

The extract is cut from the Protomaps daily planet build, which is a foreign host, so do this once on a machine that can reach it, then copy the result to the server.

1. Install the `pmtiles` command (one Go binary, BSD licence) from <https://github.com/protomaps/go-pmtiles/releases>.
2. Pick a build date from <https://maps.protomaps.com/builds/> and cut Tehran province:

   ```bash
   pmtiles extract https://build.protomaps.com/20261027.pmtiles basemap.pmtiles \
     --bbox=50.3,34.8,53.2,36.4 --maxzoom=15
   ```

   The box is Tehran province with a margin. Only the needed byte ranges are downloaded, not the whole planet.
3. Check it: `pmtiles show basemap.pmtiles` should report zoom 0 to 15 and the box above. Write the file size into this page the first time (it has not been measured yet).

## Putting it on the server

1. Copy the file to the server, for example `scp basemap.pmtiles server:/srv/routeflow/data/map/basemap.pmtiles`.
2. If it lives anywhere other than `data/map/basemap.pmtiles` under the app's folder, set `ROUTEFLOW_MAP_TILES=/full/path/basemap.pmtiles` in the app's environment.
3. Restart the app. The file is held open for the life of the process, so a replaced file is only seen after a restart.
4. Check: `curl -sI https://<host>/api/map/tiles/15/21064/12900` answers 200 with `content-type: application/x-protobuf`.
5. Redraw the picker thumbnails from the real file and commit them: `node --experimental-strip-types scripts/gen-basemap-thumbs.mjs https://<host>` (or against `npm run dev`). The ones in the repo were drawn from a test file.

## Arvan CDN

- Cache `/api/map/tiles/*` and `/map/sprites/*` by path. The route sets `Cache-Control: public, max-age=604800` and sends no cookie, and Arvan caches it like any static file.
- Each tile is a few kilobytes, far under Arvan's 100 MB cache limit per file. That limit is why the tiles are cut out on the server instead of the phone reading the PMTiles file by byte range through the CDN.
- The response varies by `Accept-Encoding` (gzip or not). Keep that header in the cache key, or let Arvan store the gzip copy only.
- After replacing the file, purge `/api/map/tiles/*` on the CDN, or wait out the 7 days.

## Refreshing

OpenStreetMap changes slowly for our purposes. Refresh every few months, or when a rep reports a missing street: cut a new file, copy it, restart, purge the CDN. Phones pick the new tiles up as their cached ones age out; bump `TILE_CACHE` in `public/sw.js` to force it.

## Credit

The data is © OpenStreetMap contributors under the ODbL, and the style is Protomaps'. Both are credited in the map's corner (`OSM_ATTRIBUTION` in `lib/mapStyle.ts`). Keep that credit when changing the map.

## Still foreign

Routes (`lib/osrm.ts`, `router.project-osrm.org`) and address search (`components/searchbox/searchBoxStore.ts`, `nominatim.openstreetmap.org`) still call public foreign servers. Self-hosting OSRM and Nominatim on the same Tehran extract is the next step (`docs/roadmap.md` 10.2).
