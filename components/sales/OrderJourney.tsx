import { faJalaliDate } from "@/lib/jalali";
import type { JourneyNode } from "@/lib/orderJourney";
import { Icon } from "@/components/meridian/Icon";

const TONE = ["plum", "sage", "sky", "amber"] as const;

/** One order's lifecycle as four lanes — the artifact's `.lanes`, carrying enough to be
 *  read by someone who did not build the system.
 *
 *  Every lane now says three things instead of one: what the step MEANS, who owns it and
 *  in what role, and the concrete fact it produced or is waiting for. The lane the order
 *  is actually sitting in is marked, because "where is this stuck" is the question this
 *  screen exists to answer and a row of identical pending ticks never answered it.
 *
 *  Read-only, and that is the design: every tick is derived from a column another surface
 *  writes. A tick anyone could toggle here would be a second record of whether the goods
 *  went out, and it would disagree with the invoice the first time it was used.
 */
export default function OrderJourney({ nodes }: { nodes: JourneyNode[] }) {
  return (
    <>
      {nodes.map((n, i) => {
        const tone = TONE[i % TONE.length];
        const initial = n.person?.trim()[0] ?? "—";
        return (
          <div className={`lane2 lane2--${n.state}`} key={n.key}>
            <div className="lh">
              <span className="idx mono">{["۱", "۲", "۳", "۴"][i] ?? String(i + 1)}</span>
              <span className="t">{n.label}</span>
              {n.state === "current" && <span className="now">اینجاست</span>}
            </div>

            <p className="lane2__what">{n.what}</p>

            <div className="node">
              <span
                className="av"
                style={{ background: `var(--${tone}-soft)`, color: `var(--${tone})` }}
                aria-hidden
              >
                {initial}
              </span>
              <span className="nb">
                <b>{n.person ?? "هنوز کسی ثبت نشده"}</b>
                <span>
                  {n.role}
                  {n.at ? ` · ${faJalaliDate(n.at)}` : ""}
                </span>
              </span>
              <span
                className="tick"
                data-done={n.done}
                role="img"
                aria-label={n.done ? "انجام شد" : "انجام نشده"}
              >
                <Icon name="check" size="sm" />
              </span>
            </div>

            {n.note && <p className="lane2__note">{n.note}</p>}
          </div>
        );
      })}
    </>
  );
}
