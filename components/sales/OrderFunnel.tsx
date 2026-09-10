import type { FunnelStage } from "@/lib/orderFunnel";
import { faNum } from "@/lib/format";

const pct = (x: number) => `${faNum(Math.round(x * 100))}٪`;

/** «همه سفارش‌ها» on /sales/journey (item 7, spec D5): where orders stall.
 *
 *  One bar per stage of the main path, as long as the share of orders that reached it.
 *  The gap between two bars is the drop-off, printed on the lower one; «منتظر» is how many
 *  live orders are sitting at that stage right now, which is the number a manager acts on;
 *  «خارج» is how many left the path there (cancelled, returned, failed).
 *
 *  Server component; numbers from lib/orderFunnel.ts, scoped by the page. */
export default function OrderFunnel({ stages }: { stages: FunnelStage[] }) {
  const top = Math.max(1, stages[0]?.reached ?? 0);
  if ((stages[0]?.reached ?? 0) === 0) {
    return <p className="funnel__empty">هنوز سفارشی ثبت نشده که مسیرش شمرده شود.</p>;
  }
  return (
    <ol className="funnel" aria-label="قیف سفارش‌ها">
      {stages.map((s) => (
        <li key={s.key} className="funnel__row">
          <span className="funnel__label">{s.label}</span>
          <span className="funnel__track">
            <span className="funnel__bar" style={{ width: `${(s.reached / top) * 100}%` }} />
          </span>
          <span className="funnel__n">{faNum(s.reached)}</span>
          <span className="funnel__meta">
            {s.drop !== null && s.drop > 0 ? <span className="funnel__drop">افت {pct(s.drop)}</span> : null}
            {s.waiting > 0 ? <span className="funnel__wait">{faNum(s.waiting)} منتظر</span> : null}
            {s.exited > 0 ? <span className="funnel__exit">{faNum(s.exited)} خارج</span> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}
