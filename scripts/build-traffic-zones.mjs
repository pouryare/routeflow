// Turns the two Overpass relations into one GeoJSON file for the app to ship.
// Run by hand when the zones change, which is roughly never -- the boundaries are set by
// Tehran's traffic authority and OSM tracks them.
import fs from "node:fs";

const OUT = "/root/pourya/coverage-map/public/tehran-traffic-zones.geojson";
const QUERY = "[out:json][timeout:120];rel(id:6947428,6950174);out geom;";

/** Overpass is a shared free service and answers "too busy" with an HTML page and a 200,
 *  so a bare res.json() fails with a JSON parse error that says nothing about why. Pass a
 *  previously downloaded response as argv[2] to skip the network entirely. */
async function overpass() {
  const cached = process.argv[2];
  if (cached) return JSON.parse(fs.readFileSync(cached, "utf8"));

  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      body: new URLSearchParams({ data: QUERY }),
    });
    const text = await res.text();
    if (text.trimStart().startsWith("{")) return JSON.parse(text);
    const why = text.match(/Error<\/strong>:([^<]*)/)?.[1]?.trim() ?? `HTTP ${res.status}`;
    console.warn(`attempt ${attempt}: Overpass declined -- ${why}`);
    await new Promise((r) => setTimeout(r, attempt * 15000));
  }
  throw new Error("Overpass would not answer. Retry later, or pass a saved response as argv[2].");
}

const data = await overpass();

const META = {
  6947428: {
    id: "limited_traffic",
    name: "محدوده طرح ترافیک",
    // From the relation's own motor_vehicle:conditional tag. Restricted to permit
    // holders inside these windows; free outside them, and free all day Friday.
    restricted: [
      { days: [6, 0, 1, 2, 3], from: "06:30", to: "17:00" },
      { days: [4], from: "06:30", to: "13:00" },
    ],
  },
  6950174: {
    id: "low_emission",
    name: "محدوده کنترل آلودگی هوا",
    // OSM carries no opening_hours for this one, so the app shows the boundary without
    // claiming to know when it is enforced. Better silent than confidently wrong about
    // something that costs a fine.
    restricted: null,
  },
};

const features = [];
for (const el of data.elements) {
  const meta = META[el.id];
  if (!meta) continue;
  const way = el.members.find((m) => m.type === "way" && m.geometry);
  if (!way) throw new Error(`relation ${el.id} has no way geometry`);

  const ring = way.geometry.map((p) => [Number(p.lon.toFixed(5)), Number(p.lat.toFixed(5))]);
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first);

  features.push({
    type: "Feature",
    properties: {
      id: meta.id,
      name: meta.name,
      name_en: el.tags["name:en"] ?? null,
      restricted: meta.restricted,
      osm_relation: el.id,
      note: el.tags.note ?? null,
    },
    geometry: { type: "Polygon", coordinates: [ring] },
  });
}

if (features.length !== 2) throw new Error(`expected 2 zones, built ${features.length}`);

fs.writeFileSync(
  OUT,
  JSON.stringify(
    {
      type: "FeatureCollection",
      attribution: "© OpenStreetMap contributors (ODbL)",
      source: "OSM relations 6947428 and 6950174, via Overpass",
      built_at: new Date().toISOString().slice(0, 10),
      features,
    },
    null,
    1
  )
);
console.log("wrote", OUT, fs.statSync(OUT).size, "bytes");
for (const f of features) console.log(" ", f.properties.id, f.properties.name, f.geometry.coordinates[0].length, "points");
