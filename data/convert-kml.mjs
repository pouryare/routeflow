// One-off conversion: Tehran mahalle-level KML -> our districts seed GeoJSON.
// Run once during setup (not at app runtime): node data/convert-kml.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DOMParser } from "@xmldom/xmldom";
import { kml } from "@tmcw/togeojson";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const kmlPath = path.join(__dirname, "tehran-map-src", "tehran_districts-Final.kml");
const kmlText = fs.readFileSync(kmlPath, "utf8");
const dom = new DOMParser().parseFromString(kmlText, "text/xml");
const geojson = kml(dom);

// The KML nests folders per منطقه; togeojson flattens to a FeatureCollection where
// each mahalle feature inherits its folder's name via a "styleUrl"/description in some
// exports, but not reliably the folder name. We instead walk the KML DOM ourselves to
// capture the folder (mantaghe) each placemark belongs to, then re-attach it.
function walkFolders(node, mantagheName, out) {
  const children = Array.from(node.childNodes || []);
  for (const child of children) {
    if (child.nodeName === "Folder") {
      const nameEl = Array.from(child.childNodes).find((c) => c.nodeName === "name");
      const folderName = nameEl ? nameEl.textContent.trim() : mantagheName;
      walkFolders(child, folderName, out);
    } else if (child.nodeName === "Placemark") {
      const nameEl = Array.from(child.childNodes).find((c) => c.nodeName === "name");
      const mahalleName = nameEl ? nameEl.textContent.trim() : null;
      if (mahalleName) out.set(mahalleName, mantagheName);
    } else if (child.childNodes && child.childNodes.length) {
      walkFolders(child, mantagheName, out);
    }
  }
}

const mahalleToMantaghe = new Map();
walkFolders(dom.documentElement, null, mahalleToMantaghe);

let matched = 0;
let unmatched = [];
for (const feature of geojson.features) {
  const name = feature.properties?.name;
  const mantaghe = name ? mahalleToMantaghe.get(name) : null;
  if (mantaghe) {
    feature.properties.mantaghe = mantaghe;
    matched++;
  } else {
    unmatched.push(name);
  }
}

console.log(`total features: ${geojson.features.length}, matched to a منطقه: ${matched}`);
if (unmatched.length) {
  console.log(`unmatched (likely منطقه header placemarks themselves, will be filtered):`, unmatched.slice(0, 10));
}

// Drop features that are just the top-level "منطقه N" header placemark duplicated as
// its own polygon (we get district-level polygons from the separate districts.json file).
const mahalleFeatures = geojson.features.filter(
  (f) => f.properties?.mantaghe && !/^منطقه\s/.test(f.properties?.name || "")
);

const out = { type: "FeatureCollection", features: mahalleFeatures };
const outPath = path.join(__dirname, "mahalle.geojson");
fs.writeFileSync(outPath, JSON.stringify(out));
console.log(`wrote ${mahalleFeatures.length} mahalle features to ${outPath}`);
