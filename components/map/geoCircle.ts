/** A circle of `metres` around a point, as a GeoJSON polygon MapLibre can fill. MapLibre
 *  has no metre-radius circle of its own (circle layers are sized in pixels). */
export function geoCircle(lat: number, lng: number, metres: number, steps = 48): GeoJSON.Feature<GeoJSON.Polygon> {
  const dLat = metres / 111_320;
  const dLng = dLat / Math.cos((lat * Math.PI) / 180);
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    ring.push([lng + dLng * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } };
}
