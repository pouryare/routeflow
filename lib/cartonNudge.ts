/* F114 first slice: «7 more units complete the carton of 24». Only when the order is within `percent` below a bigger pack
 * of the same product; 0 = off. Example: 17 units, carton 24, 30% -> 7 missing (17 >= 16.8); 10 units -> no nudge. */
export interface PackSize { name: string; qtyPerPack: number }
export interface CartonNudge { pack: string; missingUnits: number; addPacks: number }

export function cartonNudge(line: { packs: number; qtyPerPack: number }, others: PackSize[], percent: number): CartonNudge | null {
  if (!(percent > 0) || !(line.packs > 0) || !(line.qtyPerPack > 0)) return null;
  const units = line.packs * line.qtyPerPack;
  const bigger = others.filter((o) => o.qtyPerPack > units).sort((a, b) => a.qtyPerPack - b.qtyPerPack)[0];
  if (!bigger || units < bigger.qtyPerPack * (1 - percent / 100)) return null;
  const missingUnits = bigger.qtyPerPack - units;
  return { pack: bigger.name, missingUnits, addPacks: Math.ceil(missingUnits / line.qtyPerPack) };
}
