/** F62: which products to show first when taking an order for one customer.
 *
 *  The usual basket (F58) comes first, then everything else the shop has bought, most money
 *  first (the order the product mix already arrives in). Nothing is hidden: the rest of the
 *  catalogue stays one search away. Capped so the shortcut row stays a shortcut. */
export function customerProductIds(
  usual: { product_id: number }[],
  mix: { product_id: number }[],
  limit = 8,
): string[] {
  const ids: string[] = [];
  for (const { product_id } of [...usual, ...mix]) {
    const id = String(product_id);
    if (!ids.includes(id)) ids.push(id);
    if (ids.length === limit) break;
  }
  return ids;
}
