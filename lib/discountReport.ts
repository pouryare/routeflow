/** A11 «تخفیف‌های داده‌شده»: toman given as discount, grouped. Pure, so the rules are tested without a database.
 *  Example: rep Ali gave 300,000 on an order of two products worth 600,000 and 400,000 →
 *  the product split is 180,000 and 120,000 (the order's discount shared by line value). */

export interface DiscountFact {
  amount: number;
  rep: string;
  customer: string;
  /** auto: passed without a decision by someone else; approved: a manager said yes. */
  how: "auto" | "approved";
  /** The order's lines: product name and line value, to share the discount among products. */
  lines: { product: string; value: number }[];
}

export interface DiscountReport {
  total: number;
  autoCount: number;
  approvedCount: number;
  byRep: { name: string; amount: number }[];
  byCustomer: { name: string; amount: number }[];
  byProduct: { name: string; amount: number }[];
}

function ranked(m: Map<string, number>): { name: string; amount: number }[] {
  return [...m].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount);
}

export function discountReport(facts: DiscountFact[]): DiscountReport {
  const rep = new Map<string, number>();
  const customer = new Map<string, number>();
  const product = new Map<string, number>();
  let total = 0, autoCount = 0, approvedCount = 0;
  for (const f of facts) {
    total += f.amount;
    if (f.how === "auto") autoCount++; else approvedCount++;
    rep.set(f.rep, (rep.get(f.rep) ?? 0) + f.amount);
    customer.set(f.customer, (customer.get(f.customer) ?? 0) + f.amount);
    const gross = f.lines.reduce((t, l) => t + l.value, 0);
    for (const l of f.lines) {
      if (gross <= 0) break;
      product.set(l.product, (product.get(l.product) ?? 0) + Math.round((f.amount * l.value) / gross));
    }
  }
  return { total, autoCount, approvedCount, byRep: ranked(rep), byCustomer: ranked(customer), byProduct: ranked(product) };
}
