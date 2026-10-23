/** F23: the price list a salesperson hands to a customer.
 *
 *  Prices are one series per product or packaging (lib/pricing.ts); there is no price per
 *  customer group yet, so this is the one list of the organisation, on one date. A packaging
 *  with no price in force is left off the sheet and counted, because a blank or a zero on a
 *  paper the customer keeps reads as "free" or as a mistake. */
import type { CatalogueProduct } from "@/lib/catalogue";
import { faNum, faToman } from "@/lib/format";

interface PriceListLine {
  product: string;
  packaging: string;
  /** "۱۲ عدد", the contents of one pack in the product's base unit. */
  contents: string;
  priceLabel: string;
}

interface PriceListSection {
  product: string;
  lines: PriceListLine[];
}

export function priceList(catalogue: CatalogueProduct[]): { sections: PriceListSection[]; unpriced: number } {
  let unpriced = 0;
  const sections: PriceListSection[] = [];
  for (const p of catalogue) {
    if (!p.active) continue;
    const lines: PriceListLine[] = [];
    for (const k of p.packagings) {
      if (!k.active) continue;
      if (k.price_toman === null) {
        unpriced += 1;
        continue;
      }
      lines.push({
        product: p.name,
        packaging: k.name,
        contents: `${faNum(k.qty_per_pack)} ${p.base_unit}`,
        priceLabel: faToman(k.price_toman),
      });
    }
    if (lines.length > 0) sections.push({ product: p.name, lines });
  }
  return { sections, unpriced };
}
