/** Jaro-Winkler similarity coefficient.
 *
 *  Returns a value in [0, 1] where 1 means identical strings.
 *  The prefix bonus (default prefix length 4) rewards strings that share
 *  a common start — useful for Persian names that often share roots.
 */
export function jaroWinkler(a: string, b: string, prefixWeight = 0.1): number {
  const s1 = a.toLowerCase();
  const s2 = b.toLowerCase();
  if (s1 === s2) return 1;
  if (s1.length === 0 || s2.length === 0) return 0;

  const matchDistance = Math.max(s1.length, s2.length) / 2 - 1;
  const s1Matches = new Array(s1.length).fill(false);
  const s2Matches = new Array(s2.length).fill(false);

  let matches = 0;
  for (let i = 0; i < s1.length; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, s2.length);
    for (let j = start; j < end; j++) {
      if (!s2Matches[j] && s1[i] === s2[j]) {
        s1Matches[i] = true;
        s2Matches[j] = true;
        matches++;
        break;
      }
    }
  }

  if (matches === 0) return 0;

  let t = 0;
  let k = 0;
  for (let i = 0; i < s1.length; i++) {
    if (s1Matches[i]) {
      while (!s2Matches[k]) k++;
      if (s1[i] !== s2[k]) t++;
      k++;
    }
  }

  const halfT = t / 2;
  const jaro = (matches / s1.length + matches / s2.length + (matches - halfT) / matches) / 3;

  let prefixLen = 0;
  const maxPrefix = Math.min(4, Math.min(s1.length, s2.length));
  while (prefixLen < maxPrefix && s1[prefixLen] === s2[prefixLen]) prefixLen++;

  return jaro + prefixWeight * prefixLen * (1 - jaro);
}

export function normalizeAddress(addr: string | null): string {
  if (!addr) return "";
  return addr
    .toLowerCase()
    .replace(/[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFC]/g, (ch) => {
      const map: Record<string, string> = {
        "\u0622": "\u0627",
        "\u0623": "\u0627",
        "\u0625": "\u0627",
        "\u0624": "\u0648",
        "\u0626": "\u064a",
        "\u0649": "\u064a",
      };
      return map[ch] ?? ch;
    })
    .replace(/[^\w\s\u0600-\u06FF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export interface DuplicatePool {
  name: string;
  lat: number | null;
  lng: number | null;
  address: string | null;
  kind: "location" | "customer";
  id: number;
}

export interface DuplicateMatch {
  existingId: number;
  existingName: string;
  existingKind: "location" | "customer";
  score: number;
  reason: string;
}

const NAME_SIMILARITY_THRESHOLD = 0.85;
const ADDRESS_SIMILARITY_THRESHOLD = 0.9;

function addressSimilarity(a: string | null, b: string | null): number {
  if (!a || !b) return 0;
  const na = normalizeAddress(a);
  const nb = normalizeAddress(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  return jaroWinkler(na, nb);
}

export function findDuplicate(
  name: string,
  address: string | null,
  lat: number | null,
  lng: number | null,
  pools: DuplicatePool[],
): DuplicateMatch | null {
  const normalizedName = normalizeName(name);

  for (const candidate of pools) {
    if (candidate.id === 0) continue;

    let score = 0;
    let reasons: string[] = [];

    const candidateNorm = normalizeName(candidate.name);
    const nameSim = normalizedName && candidateNorm
      ? jaroWinkler(normalizedName, candidateNorm)
      : 0;

    if (nameSim >= NAME_SIMILARITY_THRESHOLD) {
      score += 0.5;
      reasons.push("name");
    }

    const addrSim = addressSimilarity(address, candidate.address);
    if (addrSim >= ADDRESS_SIMILARITY_THRESHOLD && addrSim > 0) {
      score += 0.3;
      reasons.push("address");
    }

    let distSim = 0;
    if (lat !== null && lng !== null && candidate.lat !== null && candidate.lng !== null) {
      const dist = haversineDistance(lat, lng, candidate.lat, candidate.lng);
      if (dist <= 0.15) {
        distSim = 1;
      } else if (dist <= 0.5) {
        distSim = 1 - (dist - 0.15) / 0.35;
      }
      if (distSim > 0) {
        score += 0.2 * distSim;
        reasons.push("distance");
      }
    }

    if (score >= 0.7) {
      return {
        existingId: candidate.id,
        existingName: candidate.name,
        existingKind: candidate.kind,
        score,
        reason: reasons.join(", "),
      };
    }
  }

  return null;
}

export function findBatchDuplicates(
  items: Array<{ key: string; name: string; address: string | null; lat: number | null; lng: number | null }>,
): Map<string, string[]> {
  const duplicates = new Map<string, string[]>();

  for (let i = 0; i < items.length; i++) {
    const a = items[i];
    if (!a.name || a.name === "مکان بدون نام") continue;

    for (let j = i + 1; j < items.length; j++) {
      const b = items[j];
      if (!b.name || b.name === "مکان بدون نام") continue;

      const nameSim = jaroWinkler(normalizeName(a.name), normalizeName(b.name));
      const addrSim = addressSimilarity(a.address, b.address);
      let distSim = 0;

      if (a.lat !== null && a.lng !== null && b.lat !== null && b.lng !== null) {
        const dist = haversineDistance(a.lat, a.lng, b.lat, b.lng);
        if (dist <= 0.15) distSim = 1;
        else if (dist <= 0.5) distSim = 1 - (dist - 0.15) / 0.35;
      }

      const totalScore = (nameSim >= 0.85 ? 0.5 : 0) + (addrSim >= 0.9 ? 0.3 : 0) + (distSim > 0 ? 0.2 * distSim : 0);

      if (totalScore >= 0.7) {
        if (!duplicates.has(a.key)) duplicates.set(a.key, []);
        if (!duplicates.has(b.key)) duplicates.set(b.key, []);
        duplicates.get(a.key)!.push(b.key);
        duplicates.get(b.key)!.push(a.key);
      }
    }
  }

  return duplicates;
}

function normalizeName(s: string): string {
  return s.replace(/[\s‌‌]+/g, " ").trim().toLowerCase();
}

function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371.0088;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}
