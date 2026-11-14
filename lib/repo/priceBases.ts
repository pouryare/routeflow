import { getDb } from "@/lib/db";
import { tehranTodayIso } from "@/lib/jalali";
import { resolvePrice, setPrice } from "@/lib/catalogue";
import { baseProblem, factorProblem, priceFromBase } from "@/lib/priceBases";

export interface BaseLink {
  id: number;
  product_id: number;
  packaging_id: number | null;
  product_name: string;
  packaging_name: string | null;
  factor: number;
  current_toman: number | null;
}
export interface PriceBase {
  id: number;
  name: string;
  value_toman: number;
  updated_at: string;
  links: BaseLink[];
}
export interface MovePreviewRow { link_id: number; product_name: string; packaging_name: string | null; from_toman: number | null; to_toman: number }

export async function listBases(orgId: number): Promise<PriceBase[]> {
  const db = getDb();
  const today = tehranTodayIso();
  const bases = (await db.prepare("SELECT id, name, value_toman, updated_at FROM price_bases WHERE organization_id = ? ORDER BY name").all(orgId)) as unknown as PriceBase[];
  const links = (await db
    .prepare(
      `SELECT l.id, l.base_id, l.product_id, l.packaging_id, p.name AS product_name, k.name AS packaging_name, l.factor
         FROM price_base_links l JOIN products p ON p.id = l.product_id LEFT JOIN packagings k ON k.id = l.packaging_id
        WHERE l.organization_id = ? ORDER BY p.name, l.id`,
    )
    .all(orgId)) as unknown as (Omit<BaseLink, "current_toman"> & { base_id: number })[];
  const out: PriceBase[] = [];
  for (const b of bases) {
    const mine: BaseLink[] = [];
    for (const l of links.filter((x) => Number(x.base_id) === Number(b.id))) {
      const cur = await resolvePrice(db, Number(l.product_id), l.packaging_id === null ? null : Number(l.packaging_id), today);
      mine.push({ id: Number(l.id), product_id: Number(l.product_id), packaging_id: l.packaging_id === null ? null : Number(l.packaging_id), product_name: l.product_name, packaging_name: l.packaging_name, factor: Number(l.factor), current_toman: cur ? Number(cur.price_toman) : null });
    }
    out.push({ id: Number(b.id), name: b.name, value_toman: Number(b.value_toman), updated_at: b.updated_at, links: mine });
  }
  return out;
}

/** Returns the problem in words, or null once saved. */
export async function createBase(orgId: number, name: string, valueToman: number): Promise<string | null> {
  const problem = baseProblem({ name, valueToman });
  if (problem) return problem;
  const db = getDb();
  if (await db.prepare("SELECT 1 FROM price_bases WHERE organization_id = ? AND name = ?").get(orgId, name.trim())) return "قیمت پایه‌ای با این نام هست";
  await db.prepare("INSERT INTO price_bases (organization_id, name, value_toman, updated_at) VALUES (?, ?, ?, ?)").run(orgId, name.trim(), valueToman, new Date().toISOString());
  return null;
}

export async function addLink(orgId: number, baseId: number, productId: number, packagingId: number | null, factor: number): Promise<string | null> {
  const problem = factorProblem(factor);
  if (problem) return problem;
  const db = getDb();
  if (!(await db.prepare("SELECT 1 FROM price_bases WHERE id = ? AND organization_id = ?").get(baseId, orgId))) return "قیمت پایه پیدا نشد";
  if (!(await db.prepare("SELECT 1 FROM products WHERE id = ? AND organization_id = ?").get(productId, orgId))) return "کالا پیدا نشد";
  if (packagingId !== null && !(await db.prepare("SELECT 1 FROM packagings WHERE id = ? AND product_id = ?").get(packagingId, productId))) return "بسته‌بندی پیدا نشد";
  if (await db.prepare("SELECT 1 FROM price_base_links WHERE organization_id = ? AND product_id = ? AND packaging_id IS NOT DISTINCT FROM ?").get(orgId, productId, packagingId)) return "این کالا هم‌اکنون به یک قیمت پایه وصل است";
  await db.prepare("INSERT INTO price_base_links (organization_id, base_id, product_id, packaging_id, factor) VALUES (?, ?, ?, ?, ?)").run(orgId, baseId, productId, packagingId, factor);
  return null;
}

export async function removeLink(orgId: number, linkId: number): Promise<void> {
  await getDb().prepare("DELETE FROM price_base_links WHERE id = ? AND organization_id = ?").run(linkId, orgId);
}

/** What each linked price would become if the number moved to `newValue`, without writing anything. */
export async function previewMove(orgId: number, baseId: number, newValue: number): Promise<MovePreviewRow[] | string> {
  const base = (await listBases(orgId)).find((b) => b.id === baseId);
  if (!base) return "قیمت پایه پیدا نشد";
  const problem = baseProblem({ name: base.name, valueToman: newValue });
  if (problem) return problem;
  return base.links.map((l) => ({ link_id: l.id, product_name: l.product_name, packaging_name: l.packaging_name, from_toman: l.current_toman, to_toman: priceFromBase(newValue, l.factor) }));
}

/** Moves the number and writes one dated price row per link whose price changes. Returns how many prices changed, or the problem. */
export async function applyMove(orgId: number, baseId: number, newValue: number, validFrom: string, by: number): Promise<number | string> {
  const today = tehranTodayIso();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(validFrom) || validFrom < today) return "تاریخ شروع باید امروز یا بعد از آن باشد";
  const preview = await previewMove(orgId, baseId, newValue);
  if (typeof preview === "string") return preview;
  const db = getDb();
  const links = (await listBases(orgId)).find((b) => b.id === baseId)!.links;
  let changed = 0;
  await db.tx(async () => {
    for (const row of preview) {
      if (row.from_toman === row.to_toman) continue;
      const l = links.find((x) => x.id === row.link_id)!;
      await setPrice(db, { product_id: l.product_id, packaging_id: l.packaging_id, price_toman: row.to_toman, valid_from: validFrom, created_by: by });
      changed++;
    }
    await db.prepare("UPDATE price_bases SET value_toman = ?, updated_at = ? WHERE id = ? AND organization_id = ?").run(newValue, new Date().toISOString(), baseId, orgId);
  });
  return changed;
}

/** F56: prices already scheduled for a future day, with the price in force now and the packs sold in the last 30 days as a size of the change. */
export interface ScheduledPrice { product_name: string; packaging_name: string | null; valid_from: string; price_toman: number; current_toman: number | null; packs_30d: number }
export async function scheduledPrices(orgId: number, today = tehranTodayIso()): Promise<ScheduledPrice[]> {
  const db = getDb();
  const rows = (await db
    .prepare(
      `SELECT pp.product_id, pp.packaging_id, p.name AS product_name, k.name AS packaging_name, pp.valid_from, pp.price_toman
         FROM product_prices pp JOIN products p ON p.id = pp.product_id LEFT JOIN packagings k ON k.id = pp.packaging_id
        WHERE p.organization_id = ? AND pp.valid_from > ? ORDER BY pp.valid_from, p.name LIMIT 50`,
    )
    .all(orgId, today)) as unknown as { product_id: number; packaging_id: number | null; product_name: string; packaging_name: string | null; valid_from: string; price_toman: number }[];
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - 30 * 86_400_000).toISOString().slice(0, 10);
  const out: ScheduledPrice[] = [];
  for (const r of rows) {
    const cur = await resolvePrice(db, Number(r.product_id), r.packaging_id === null ? null : Number(r.packaging_id), today);
    const vol = (await db
      .prepare(
        `SELECT COALESCE(SUM(l.packs_ordered), 0) AS n FROM order_lines l JOIN orders o ON o.id = l.order_id
          WHERE o.organization_id = ? AND o.order_date >= ? AND o.status <> 'CANCELLED' AND l.is_reversal = 0 AND l.product_id = ? AND l.packaging_id IS NOT DISTINCT FROM ?`,
      )
      .get(orgId, since, Number(r.product_id), r.packaging_id)) as { n: number };
    out.push({ product_name: r.product_name, packaging_name: r.packaging_name, valid_from: r.valid_from, price_toman: Number(r.price_toman), current_toman: cur ? Number(cur.price_toman) : null, packs_30d: Number(vol.n) });
  }
  return out;
}
