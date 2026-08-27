import { faJalaliDate } from "@/lib/jalali";
import { Avatar } from "@/components/AvatarStack";
import type { JourneyNode } from "@/lib/orderJourney";

/** One order's lifecycle as four lanes (MASTER.md, "Order journey").
 *
 *  Read-only, and that is the design rather than an omission: every tick is derived from
 *  a column that another surface writes -- the confirm action, a delivery_stops row, the
 *  driver's settlement. A tick anyone could toggle here would be a second record of
 *  whether the goods went out, and it would disagree with the invoice the first time
 *  somebody used it.
 *
 *  A server component: there is nothing to interact with.
 */
export default function OrderJourney({ nodes }: { nodes: JourneyNode[] }) {
  return (
    <ol className="journey m-0 list-none p-0">
      {nodes.map((n) => (
        <li key={n.key} className={`jlane${n.done ? "" : " jlane--pending"}`}>
          <div className="jlane__head">
            <span className={`jtick${n.done ? " jtick--done" : ""}`} aria-hidden>
              ✓
            </span>
            <span className="jlane__name">{n.label}</span>
            <span className="sr-only">{n.done ? "انجام شد" : "انجام نشده"}</span>
          </div>

          <div className="jnode">
            <div className="jnode__who">
              {n.person ? (
                <>
                  <Avatar name={n.person} size={26} />
                  <span className="truncate">{n.person}</span>
                </>
              ) : (
                <span className="text-[var(--text-muted)]">هنوز کسی ثبت نشده</span>
              )}
            </div>
            {(n.at || n.note) && (
              <p className="jnode__meta">
                {n.at && <span className="num">{faJalaliDate(n.at)}</span>}
                {n.at && n.note ? " · " : null}
                {n.note}
              </p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
