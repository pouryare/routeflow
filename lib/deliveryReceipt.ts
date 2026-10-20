import type { RunStop } from "@/lib/delivery";
import { faNum, faToman } from "@/lib/format";
import { faJalaliDate } from "@/lib/jalali";
import { roundToman } from "@/lib/money";
import type { ReceiptData } from "@/lib/receiptLayout";

/** The paper handed over at the door.
 *
 *  Shared by the delivery flow's «چاپ رسید» button and the «نمایش رسید» button on a stop that is
 *  already done, so both draw the same receipt from the same numbers. `packs` is what was
 *  delivered per line id; a line with none is left off the paper. */
export function buildReceipt(opts: {
  stop: RunStop;
  packs: Record<number, number>;
  collectedToman: number;
  runDate: string;
  driverName: string;
  businessName: string;
}): ReceiptData {
  const { stop, packs, collectedToman } = opts;
  const rows = stop.lines.map((line) => ({ line, n: packs[line.id] ?? 0 }));
  const total = rows.reduce((sum, r) => sum + roundToman(r.n * r.line.unit_price_toman), 0);
  return {
    businessName: opts.businessName,
    orderNo: stop.order_no,
    dateLabel: faJalaliDate(opts.runDate),
    customerName: stop.customer_name,
    address: stop.address,
    phone: stop.phone,
    lines: rows
      .filter((r) => r.n > 0)
      .map((r) => ({
        name: `${r.line.product_name} · ${r.line.packaging_name}`,
        detail: `${faNum(r.n)} بسته × ${faToman(r.line.unit_price_toman)}`,
        amount: faToman(roundToman(r.n * r.line.unit_price_toman)),
      })),
    totalLabel: faToman(total),
    paidLabel: faToman(collectedToman),
    dueLabel: collectedToman < total ? faToman(total - collectedToman) : null,
    driverName: opts.driverName,
    footer: "با تشکر از خرید شما",
  };
}
