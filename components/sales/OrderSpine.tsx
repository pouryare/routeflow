import { Icon, type IconName } from "@/components/meridian/Icon";
import type { JourneyKey, JourneyNode } from "@/lib/orderJourney";
import type { OrderEventRow } from "@/lib/orderEvents";
import { ORDER_STATUS_LABEL, type OrderStatus } from "@/lib/orderStateMachine";
import { faJalaliDate, faJalaliDateTime } from "@/lib/jalali";

const STEP_ICON: Record<JourneyKey, IconName> = {
  placed: "receipt",
  confirmed: "handshake",
  loaded: "truck",
  settled: "wallet",
};

/** «این سفارش» on /sales/journey (item 7): one order's life as a vertical timeline.
 *
 *  Replaces four side-by-side lanes that read as a board, not as a story, and broke into
 *  a 2×2 grid below 1080px. A spine reads top to bottom at any width. Each milestone has
 *  its own icon, the order's current step is ringed in the accent, steps not reached are
 *  quiet, and the status log (lib/orderEvents.ts) hangs under the milestone it belongs to.
 *
 *  Server component: the page hands over nodes and events already scoped to the viewer. */
export default function OrderSpine({
  nodes,
  events,
}: {
  nodes: JourneyNode[];
  events: Record<JourneyKey, OrderEventRow[]>;
}) {
  return (
    <ol className="spine">
      {nodes.map((n) => (
        <li key={n.key} className={`spine__step spine__step--${n.state}`}>
          <span className="spine__dot" aria-hidden="true">
            <Icon name={n.state === "done" ? "check" : STEP_ICON[n.key]} size="sm" />
          </span>
          <div className="spine__body">
            <div className="spine__head">
              <span className="spine__icon" aria-hidden="true">
                <Icon name={STEP_ICON[n.key]} size="sm" />
              </span>
              <span className="spine__label">{n.label}</span>
              {n.state === "current" ? <span className="spine__now">اینجاست</span> : null}
              {n.at ? <time className="spine__at" dateTime={n.at}>{faJalaliDate(n.at)}</time> : null}
            </div>
            <p className="spine__what">{n.what}</p>
            {n.person ? (
              <p className="spine__who">
                <Icon name="user" size="sm" />
                <span>{n.person}</span>
                <span className="spine__role">· {n.role}</span>
              </p>
            ) : null}
            {n.note ? <p className="spine__note">{n.note}</p> : null}
            {events[n.key].length > 0 ? (
              <ul className="spine__events" aria-label={`رویدادهای «${n.label}»`}>
                {events[n.key].map((e) => (
                  <li key={e.id}>
                    <span className="spine__evstatus">
                      {ORDER_STATUS_LABEL[e.to_status as OrderStatus] ?? "وضعیت نامشخص"}
                    </span>
                    {e.actor_name ? <span> · {e.actor_name}</span> : null}
                    <time className="spine__evat" dateTime={e.at}>{faJalaliDateTime(e.at)}</time>
                    {e.note ? <span className="spine__evnote">{e.note}</span> : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
