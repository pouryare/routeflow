import type { Session } from "@/lib/session";
import { yieldToEventLoop } from "@/lib/yieldToEventLoop";
import { stockFor } from "@/lib/repo/dashboardView";
import { faNum, faToman } from "@/lib/format";
import BarChart from "@/components/charts/BarChart";
import CollapsibleSection from "@/components/CollapsibleSection";
import { EMPTY_CHART } from "@/components/dashboard/format";

const empty = EMPTY_CHART;

/** «انبار و تحویل» -- stock position and each driver's fill rate. Not for a فروشنده: cost and
 *  stock value are not theirs to see, so for that role nothing is read at all. */

export default async function StockSection({ session }: { session: Session }) {
  await yieldToEventLoop();
  if (session.role === "phone_sales") return null;
  const { stock, drivers } = await stockFor(session);
  const stockValue = stock.reduce((sum, r) => sum + r.value_toman, 0);
  const negatives = stock.filter((r) => r.negative);

  return (
        <CollapsibleSection title="انبار و تحویل" icon="package" storageKey="dash-stock">
          <div className="grid gap-[var(--space-4)] md:grid-cols-2">
            <BarChart
              title="موجودی انبار"
              subtitle={`ارزش ${faToman(stockValue)}${
                negatives.length ? ` · ${faNum(negatives.length)} کالای منفی` : ""
              }`}
              data={stock.map((r) => ({
                label: r.name,
                value: r.on_hand,
                color: r.negative ? "var(--crit)" : undefined,
              }))}
              formatValue={(v) => faNum(v)}
              empty={empty}
            />
            <BarChart
              title="نرخ تحویل هر راننده"
              subtitle="درصد بسته‌های تحویل‌شده از سفارش‌شده"
              data={drivers.map((r) => ({ label: r.label, value: r.value }))}
              formatValue={(v) => `${faNum(v)}٪`}
              barLabel={(v) => `${faNum(v)}٪`}
              /* Against a fixed 100, not against the best driver: scaled to its own
                 maximum, 95% and 100% draw almost the same bar and the gap disappears. */
              max={100}
              colorful
              empty={empty}
            />
          </div>
        </CollapsibleSection>
  );
}
