/** Twenty dairy products, each with a packaging and TWO price points.
 *
 *  Two price points matter: `lib/pricing.ts` keeps price history in its own table rather
 *  than a column on the product, precisely so editing today's price does not rewrite last
 *  month's revenue. With one price row the تاریخچه قیمت‌ها chart has a single dot and
 *  proves nothing.
 */

import type { SeedContext } from "../context";

interface Product {
  name: string; sku: string; kg: number; cost: number;
  pack: string; per: number; price: number;
}

/** Whole Toman. Costs were set so the catalogue's blended gross margin lands at **26.9%**
 *  (range 23%-32% across the twenty lines).
 *
 *  Two reasons for that specific figure rather than something rounder:
 *    - The invariants assert 12%-35% org-wide. At 34.5% this catalogue cleared it by half a
 *      percentage point, which is not a margin — it is a coin flip. Phase 06 drifts purchase
 *      cost per product and phase 07 recognises COGS off these costs, so the final number is
 *      not this one, and it needs headroom on both sides.
 *    - 34.5% is unrealistically fat for dairy distribution anyway. 27% is a number a Tehran
 *      distributor would recognise.
 *
 *  The spread matters as much as the mean: uniformly-priced lines make every margin report
 *  read identically, which is the giveaway of invented data. The thinnest line here is 23%
 *  (خامه قنادی) and the fattest 32% (خامه گیاهی). */
const CATALOGUE: Product[] = [
  { name: "پنیر سفید ۴۰۰ گرمی", sku: "DEMO-PN400", kg: 0.4, cost: 134_000, pack: "کارتن ۲۴ عددی", per: 24, price: 185_000 },
  { name: "پنیر سفید ۹۰۰ گرمی", sku: "DEMO-PN900", kg: 0.9, cost: 273_000, pack: "کارتن ۱۲ عددی", per: 12, price: 372_000 },
  { name: "پنیر مثلثی ۱۵۰ گرمی", sku: "DEMO-PN150", kg: 0.15, cost: 58_000, pack: "کارتن ۳۰ عددی", per: 30, price: 84_000 },
  { name: "پنیر لیوانی ۱۵۰ گرمی", sku: "DEMO-PNL", kg: 0.15, cost: 55_000, pack: "کارتن ۳۰ عددی", per: 30, price: 79_000 },
  { name: "پنیر چدار ۲۰۰ گرمی", sku: "DEMO-CH200", kg: 0.2, cost: 83_000, pack: "کارتن ۲۴ عددی", per: 24, price: 115_000 },
  { name: "ماست پرچرب ۲ کیلویی", sku: "DEMO-MS2K", kg: 2, cost: 69_000, pack: "شرینک ۶ عددی", per: 6, price: 98_000 },
  { name: "ماست کم‌چرب ۹۰۰ گرمی", sku: "DEMO-MS900", kg: 0.9, cost: 38_000, pack: "کارتن ۱۲ عددی", per: 12, price: 56_000 },
  { name: "ماست موسیر زیتون", sku: "DEMO-MSV", kg: 0.4, cost: 107_000, pack: "ظرف ۶ عددی", per: 6, price: 148_000 },
  { name: "خامه صبحانه ۲۰۰ گرمی", sku: "DEMO-KH200", kg: 0.2, cost: 54_000, pack: "کارتن ۳۶ عددی", per: 36, price: 76_000 },
  { name: "خامه گیاهی ۲۵۰ گرمی", sku: "DEMO-KHV", kg: 0.25, cost: 46_000, pack: "کارتن ۲۴ عددی", per: 24, price: 68_000 },
  { name: "خامه قنادی ۱ لیتری", sku: "DEMO-KHQ", kg: 1, cost: 184_000, pack: "شرینک ۶ عددی", per: 6, price: 238_000 },
  { name: "کره حیوانی ۲۵۰ گرمی", sku: "DEMO-KR250", kg: 0.25, cost: 234_000, pack: "کارتن ۲۰ عددی", per: 20, price: 310_000 },
  { name: "کره بادام‌زمینی ۳۴۰ گرمی", sku: "DEMO-KRB", kg: 0.34, cost: 143_000, pack: "کارتن ۲۴ عددی", per: 24, price: 189_000 },
  { name: "دوغ گازدار ۱٫۵ لیتری", sku: "DEMO-DG15", kg: 1.5, cost: 29_000, pack: "شرینک ۶ عددی", per: 6, price: 42_000 },
  { name: "دوغ بدون گاز ۱ لیتری", sku: "DEMO-DG1L", kg: 1, cost: 21_000, pack: "شرینک ۱۲ عددی", per: 12, price: 31_000 },
  { name: "شیر پرچرب ۱ لیتری", sku: "DEMO-SH1L", kg: 1, cost: 35_000, pack: "شرینک ۱۲ عددی", per: 12, price: 47_000 },
  { name: "شیر کم‌چرب ۱ لیتری", sku: "DEMO-SH1L0", kg: 1, cost: 32_000, pack: "شرینک ۱۲ عددی", per: 12, price: 44_000 },
  { name: "شیر شیرین ۱ لیتری", sku: "DEMO-SHSW", kg: 1, cost: 42_000, pack: "شرینک ۱۲ عددی", per: 12, price: 58_000 },
  { name: "دسر پنیر ۱۰۰ گرمی", sku: "DEMO-DS100", kg: 0.1, cost: 25_000, pack: "کارتن ۴۸ عددی", per: 48, price: 36_000 },
  { name: "کشک پرچرب ۴۰۰ گرمی", sku: "DEMO-KSH400", kg: 0.4, cost: 98_000, pack: "کارتن ۱۲ عددی", per: 12, price: 132_000 },
];

export async function run(ctx: SeedContext): Promise<void> {
  const { db } = ctx;
  const now = ctx.stamp(0);
  const owner = ctx.staff.owner;
  const productIds: number[] = [];

  const insProduct = db.prepare(
    `INSERT INTO products (name, sku, base_unit, kg_per_base_unit, avg_cost_toman,
                           active, created_at, updated_at, reorder_point, target_stock,
                           shelf_life_days, organization_id)
     VALUES (?, ?, 'عدد', ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
  );
  const insPack = db.prepare(
    `INSERT INTO packagings (product_id, name, qty_per_pack, active, created_at)
     VALUES (?, ?, ?, 1, ?)`,
  );
  const insPrice = db.prepare(
    `INSERT INTO product_prices (product_id, packaging_id, price_toman, valid_from,
                                 created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );

  for (const p of CATALOGUE) {
    const productId = Number(
      (await insProduct.run(
        p.name,
        p.sku,
        p.kg,
        p.cost,
        now,
        now,
        /* Reorder policy, so /sales/stock shows a real reorder suggestion rather than
           blank cells. Roughly three weeks of cover at the reorder point, twelve at target. */
        Math.round(p.per * 3),
        Math.round(p.per * 12),
        /* Fresh dairy, in days — this is what the batch-expiry alert reads. */
        ctx.rng.int(20, 60),
        ctx.orgId,
      )).lastInsertRowid,
    );
    const packId = Number((await insPack.run(productId, p.pack, p.per, now)).lastInsertRowid);

    /* TWO price points spanning the whole order window. Phase 05 walks back
       `scale.months * 30` days, so an older price dated a fixed 420 days would leave every
       order before that with NO price — and `createOrder` refuses outright:
       «کره حیوانی ۲۵۰ گرمی» در این تاریخ قیمت ندارد.
       The first is dated one day before the window opens; the second halfway through it.
       Rounded to the nearest 1000 Toman because that is how prices are actually quoted. */
    const window = ctx.scale.months * 30;
    await insPrice.run(
      productId, packId, Math.round((p.price * 0.88) / 1000) * 1000,
      ctx.iso(window + 1), owner, now,
    );
    await insPrice.run(productId, packId, p.price, ctx.iso(Math.round(window / 2)), owner, now);

    productIds.push(productId);
  }

  ctx.ids.productIds = productIds;
  ctx.progress(`${productIds.length} products, ${productIds.length * 2} price points`);
}
