import { faJalaliDate } from "@/lib/jalali";
import type { JourneyNode } from "@/lib/orderJourney";

/* The artifact's avatar tones, in its own order. */
const TONE = ["plum", "sage", "sky", "amber"] as const;

/** One order's lifecycle as four lanes — the artifact's `.lanes`.
 *
 *  Read-only, and that is the design rather than an omission: every tick is derived from
 *  a column another surface writes — the confirm action, a delivery_stops row, the
 *  driver's settlement. A tick anyone could toggle here would be a second record of
 *  whether the goods went out, and it would disagree with the invoice the first time it
 *  was used. So the tick shows state; it does not take input.
 */
export default function OrderJourney({ nodes }: { nodes: JourneyNode[] }) {
  return (
    <>
      {nodes.map((n, i) => {
        const tone = TONE[i % TONE.length];
        const initial = n.person?.trim()[0] ?? "—";
        return (
          <div className="lane2" key={n.key}>
            <div className="lh">
              <span className="idx mono">{["۱", "۲", "۳", "۴"][i] ?? String(i + 1)}</span>
              <span className="t">{n.label}</span>
            </div>
            <div className={`node${n.done ? " done" : ""}`}>
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
                  {n.at ? faJalaliDate(n.at) : ""}
                  {n.at && n.note ? " · " : ""}
                  {n.note}
                </span>
              </span>
              {/* A span, not a button: this reports state, it does not accept it. */}
              <span
                className="tick"
                data-done={n.done}
                role="img"
                aria-label={n.done ? "انجام شد" : "انجام نشده"}
              >
                ✓
              </span>
            </div>
          </div>
        );
      })}
    </>
  );
}
