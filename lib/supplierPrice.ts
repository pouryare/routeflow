/** D16: what to tell the person typing a purchase line when the supplier has a price row for the product.
 *  Example: row «۱۲۰٬۰۰۰ تومان، حداقل ۱۰» and a line of 6 units → price filled in, warning «کمتر از حداقل سفارش (۱۰)». */
export interface SupplierPriceRow {
  supplier: string;
  product_id: number;
  price_toman: number;
  min_qty: number | null;
  delivery_days: number | null;
  supplier_code: string | null;
}

export function priceRowFor(rows: SupplierPriceRow[], supplier: string, productId: number): SupplierPriceRow | undefined {
  const name = supplier.trim();
  return name === "" ? undefined : rows.find((r) => r.supplier === name && r.product_id === productId);
}

/** A warning line, or null when the quantity reaches the minimum (or there is none). */
export function minQtyWarning(row: SupplierPriceRow | undefined, qty: number): string | null {
  if (!row || row.min_qty === null || !Number.isFinite(qty) || qty >= row.min_qty) return null;
  return `کمتر از حداقل سفارش این تأمین‌کننده است (${row.min_qty.toLocaleString("fa-IR")})`;
}
