import Link from "next/link";
import type { ReactNode } from "react";

export type OrderDoc = "receipt" | "delivery";

const DOC_LABEL: Record<OrderDoc, string> = {
  receipt: "فاکتور",
  delivery: "برگهٔ تحویل",
};

/** An order card that shows what is attached to it.
 *
 *  The card is a pocket: each document the order actually has peeks a few millimetres
 *  above its top edge, fanned and slightly rotated. It answers "has this been invoiced,
 *  has it been loaded" before the card is opened, which is otherwise two clicks away.
 *
 *  Only real documents appear. A draft has no invoice, and an order not on a run has no
 *  delivery note, so those papers are absent rather than greyed -- a placeholder for a
 *  document that does not exist is how an interface starts lying quietly.
 *
 *  There is deliberately no commission paper. `commission_payments` is keyed by
 *  salesperson and period, not by order, so a commission statement is a document about a
 *  month rather than about this record, and filing it here would invent a relationship
 *  the schema does not have.
 */
export default function OrderPocketCard({
  href,
  docs,
  tone,
  children,
}: {
  href: string;
  docs: OrderDoc[];
  /** The order's status colour. Washes up through the card behind the papers. */
  tone: string;
  children: ReactNode;
}) {
  return (
    <div className="pocket" style={{ ["--pocket-tone" as string]: tone }}>
      {docs.length > 0 && (
        <span aria-hidden="true" className="pocket__papers">
          {docs.map((d, i) => (
            <span
              key={d}
              className="pocket__paper"
              style={{
                // Fanned by index. Alternating the sign keeps a two-paper fan symmetrical
                // instead of leaning, which reads as a stack rather than as a slip.
                ["--paper-i" as string]: String(i),
                transform: `translateX(${i * 26}px) rotate(${i % 2 === 0 ? -4 : 3}deg)`,
                zIndex: docs.length - i,
              }}
            />
          ))}
        </span>
      )}

      <Link href={href} className="pocket__card">
        {children}
      </Link>

      {/* Named for a screen reader, which gets no benefit from the fan itself. */}
      {docs.length > 0 && (
        <span className="sr-only">
          پیوست‌ها: {docs.map((d) => DOC_LABEL[d]).join("، ")}
        </span>
      )}
    </div>
  );
}
