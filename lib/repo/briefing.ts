import { canSnooze } from "@/lib/taskSnooze";
import { getDb } from "@/lib/db";
import type { Session } from "@/lib/session";
import { scopeGroupIds } from "@/lib/session";
import { tehranTodayIso, jalaliMonthKey } from "@/lib/jalali";
import { listTasks } from "./tasks";
import { listAlerts } from "./alerts";
import { targetProgress } from "./targets";
import { SEVERITY_FA } from "@/lib/repo/actionCenter";
import { REP_STAGE_LABEL, type RepStage } from "@/lib/repStages";
import { ORDER_STATUS_LABEL, type OrderStatus } from "@/lib/orderStateMachine";
import { taskPriorityLabel } from "@/lib/tasks/labels";
import { faNum, faToman } from "@/lib/format";
import { customerHref } from "@/lib/deepLink";
import { isVanRole } from "../roles";
import { stopCountsByRun, remainingByRun } from "./runStops";
import { reorderSignals } from "./suggestions";
import { dueToday, orderHref } from "@/lib/briefingSuggestions";
import { daysBetween } from "@/lib/database/dialect";

export interface BriefingItem {
  label: string;
  sub?: string;
  href?: string;
  tone?: "good" | "warn" | "crit" | "info";
  action?: { kind: "task_outcome"; task_id: number; customer_id?: number; snoozable?: boolean } | { kind: "link"; href: string };
}
export interface BriefingPanel {
  key: string;
  title: string;
  /** Rendered in the panel's header, ABOVE the list — a breakdown of what the list contains.
   *
   *  Separate from `items` because "five confirmed orders" and "these five orders" are two
   *  different statements, and stacking both as rows makes the panel say the same thing twice
   *  (once as a count, once per order). Carries no `tone`, so it can never inflate the
   *  "needs attention" count in briefingCards — a summary is not a demand. */
  summary?: BriefingItem[];
  items: BriefingItem[];
  more?: number;
}
/** Who the reader is, so the page does not re-derive identity from the session.
 *
 *  Carries `userId` and NOT a rendered avatar, on purpose. The face belongs to the PERSON
 *  and never changes with the active role: a rep holding two roles taps the role picker, the
 *  role line under the name updates, and the photo stays put. A face that swaps on a role tap
 *  reads as a bug, and the role is already spelled out in the text beneath the name. */
export interface BriefingHero {
  userId: number;
  displayName: string;
  /** Null when nobody has set a photo — Avatar's initials fallback is the honest answer, and
   *  in a 96px hero circle it is also the weakest-looking. See plan B. */
  avatarUrl: string | null;
  role: string;
}

export interface Briefing {
  role: string;
  panels: BriefingPanel[];
  hero: BriefingHero;
}

const CAP = 5;
const cap = (items: BriefingItem[]): { items: BriefingItem[]; more?: number } =>
  items.length > CAP ? { items: items.slice(0, CAP), more: items.length - CAP } : { items };

/** `summary` is optional so that every panel which has no breakdown to show keeps calling
 *  this with three arguments — a panel is not obliged to have a header. */
function panel(
  key: string,
  title: string,
  items: BriefingItem[],
  summary?: BriefingItem[]
): BriefingPanel | null {
  if (items.length === 0) return null;
  return summary ? { key, title, summary, ...cap(items) } : { key, title, ...cap(items) };
}

function currentPeriod(): string {
  return jalaliMonthKey(new Date().toISOString());
}

export async function todayFor(session: Session): Promise<Briefing> {
  const db = getDb();
  const org = session.organizationId;
  /* Tehran, not UTC. `toISOString().slice(0,10)` is yesterday for the last 3.5 hours of
     every evening, which made this panel return nothing — or yesterday's orders — under a
     heading that says «امروز». See tehranTodayIso. */
  const today = tehranTodayIso();
  const panels: (BriefingPanel | null)[] = [];

  if (session.role === "phone_sales") {
    const tasks = (await listTasks(org, { assignee: session.user.id })).concat(
      (await listTasks(org, { role: "phone_sales" })).filter((t) => t.assignee_user_id === null)
    );
    panels.push(
      panel(
        "open_tasks",
        "کارهای باز",
        tasks.map((t) => ({
          label: t.title,
          /* taskPriorityLabel, never `t.priority`. The raw column is an UPPERCASE enum and
             this panel put it straight under a Persian heading. */
          sub: taskPriorityLabel(t.priority),
          action: t.entity_type === "customer" && t.entity_id
            ? { kind: "task_outcome", task_id: t.id, customer_id: t.entity_id, snoozable: canSnooze(t) }
            : { kind: "task_outcome", task_id: t.id, snoozable: canSnooze(t) },
        }))
      )
    );

    /* F8: who is due to order today by their own rhythm, each opening the quick order flow on
       that customer. A customer with an order already open is left out. */
    const open = new Set(
      (await db
        .prepare(
          `SELECT DISTINCT customer_id FROM orders WHERE organization_id = ? AND salesperson_user_id = ?
              AND status IN ('DRAFT', 'PENDING_REVIEW', 'PENDING_CREDIT', 'ON_HOLD', 'CONFIRMED', 'PLANNED', 'READY', 'OUT_FOR_DELIVERY')`
        )
        .all(org, session.user.id) as { customer_id: number }[]).map((r) => r.customer_id)
    );
    panels.push(
      panel(
        "due_today",
        "موعد سفارش امروز",
        dueToday(await reorderSignals(org, session.user.id, today), open).map((r) => ({
          label: r.name,
          sub: `معمولاً هر ${faNum(r.typicalGapDays)} روز · ${faNum(r.daysSinceLast)} روز از آخرین خرید`,
          href: orderHref(r.customerId),
        }))
      )
    );

    const overdue = await db
      .prepare(
        `SELECT c.id, c.business_name, MAX(o.order_date) AS last
           FROM customers c JOIN orders o ON o.id IN (SELECT id FROM orders WHERE customer_id = c.id)
          WHERE c.organization_id = ? AND o.salesperson_user_id = ?
          GROUP BY c.id HAVING ${daysBetween("?", "MAX(o.order_date)")} > 14
          ORDER BY last LIMIT 10`
      )
      .all(org, session.user.id, tehranTodayIso()) as { id: number; business_name: string; last: string }[];
    panels.push(
      panel(
        "call_list",
        "تماس‌های امروز",
        overdue.map((c) => ({
          label: c.business_name,
          sub: `آخرین خرید ${c.last}`,
          href: customerHref(c.id),
        }))
      )
    );

  }

  if (isVanRole(session.role)) {
    const run = await db
      .prepare(
        "SELECT id, weather_json FROM delivery_runs WHERE driver_user_id = ? AND run_date = ? AND organization_id = ?"
      )
      .get(session.user.id, today, org) as { id: number; weather_json: string | null } | undefined;
    if (run) {
      // Via runStops, so the load and the unload are counted. They are stops: unloading a
      // van is not a doorstep, and a driver told "3 stops" who then loads and unloads has
      // been told a lie by arithmetic rather than by anybody.
      const stops = (await stopCountsByRun(db, [run.id])).get(run.id) ?? 0;
      const remaining = (await remainingByRun(db, [run.id])).get(run.id) ?? 0;
      panels.push({
        key: "today_run",
        title: "مسیر امروز",
        items: [
          {
            label: `${stops} توقف`,
            sub: `${remaining} باقی‌مانده`,
            href: "/driver",
          },
        ],
      });
      if (run.weather_json) {
        try {
          const w = JSON.parse(run.weather_json) as { notes_fa?: string[] };
          if (w.notes_fa?.length) {
            panels.push({
              key: "weather",
              title: "وضع هوا",
              items: w.notes_fa.map((n) => ({ label: n, tone: "warn" as const, href: "/driver" })),
            });
          }
        } catch {
          /* ignore */
        }
      }
    }
    const yesterday = tehranTodayIso(new Date(Date.now() - 86_400_000));
    const failed = await db
      .prepare(
        `SELECT o.id, o.order_no FROM orders o
           JOIN delivery_stops ds ON ds.order_id = o.id
           JOIN delivery_runs dr ON dr.id = ds.run_id
          WHERE dr.driver_user_id = ? AND dr.run_date = ? AND o.status = 'DELIVERY_FAILED'`
      )
      .all(session.user.id, yesterday) as { id: number; order_no: string }[];
    panels.push(
      panel(
        "retry",
        "تحویل‌های ناموفق دیروز",
        failed.map((f) => ({ label: `سفارش ${f.order_no}`, tone: "crit" as const, href: `/sales/orders/${f.id}` }))
      )
    );
  }

  /* A platform_owner is a god key: they see everything, so their briefing is the OWNER's
     briefing over every group. Without this they matched no branch at all and signed in to a
     blank screen — a person who signs in to nothing, with no error anywhere to explain it.
     `isManager` (lib/appNav.ts) answers the same question the same way. */
  if (
    session.role === "group_manager" ||
    session.role === "owner" ||
    session.role === "platform_owner"
  ) {
    const gids = await scopeGroupIds(session);
    const inClause = gids === "all" || gids.length === 0 ? null : gids.join(",");

    /* One row per ORDER, not one row per status.
     *
     * `SUM(ROUND(...))` and never `ROUND(SUM(...))`. orderTotalToman rounds EACH line and
     * then adds (lib/orderMath.ts:66), so rounding the sum reorders the two operations and
     * the two figures disagree on fractional packs — measured on a three-half-line order:
     * 3 Toman the correct way, 2 the other. The briefing and the order page must print the
     * same number, because they ARE the same number.
     *
     * The factors are the line's own FROZEN columns (qty_per_pack / kg_per_base_unit live on
     * order_lines, lib/db.ts:1742), which is why this needs no join to products/packagings —
     * the same reasoning readOrders uses at lib/orders.ts:519. */
    const todays = await db
      .prepare(
        `SELECT o.id, o.order_no, o.status, c.business_name AS customer_name,
                COALESCE(SUM(ROUND(COALESCE(ol.packs_delivered, ol.packs_ordered)
                                    * ol.unit_price_toman)), 0) AS total_toman
           FROM orders o
           JOIN customers c ON c.id = o.customer_id
           LEFT JOIN order_lines ol ON ol.order_id = o.id
          WHERE o.organization_id = ? AND o.order_date = ?${inClause ? ` AND o.group_id IN (${inClause})` : ""}
          GROUP BY o.id
          ORDER BY o.id DESC`
      )
      .all(org, today) as {
      id: number;
      order_no: string;
      status: string;
      customer_name: string;
      total_toman: number;
    }[];

    /* The breakdown is the panel's HEADER, not its rows. Five identical «تأییدشده» rows
       stacked under a heading that already says "today's orders" is the panel saying the
       same thing five times instead of once plus the list. */
    const byStatus = new Map<string, number>();
    for (const o of todays) byStatus.set(o.status, (byStatus.get(o.status) ?? 0) + 1);

    panels.push(
      panel(
        "orders_by_state",
        "سفارش‌های امروز",
        todays.map((o) => ({
          label: `سفارش ${faNum(Number(o.order_no.split("-")[1] ?? 0))}#`,
          sub: `${o.customer_name} · ${faToman(o.total_toman)}`,
          /* Each order opens ITSELF. Every row used to link to the same generic board, so
             the panel could tell a manager there were five orders and not which five. */
          href: `/sales/orders/${o.id}`,
        })),
        [...byStatus].map(([status, n]) => ({
          /* ORDER_STATUS_LABEL, never `status`. This is the THIRD leak of this exact kind in
             this one function: `exceptions` and `reps_by_stage` were both fixed after the
             user reported reading «critical» and «prospect», each comment saying "found while
             fixing that one". `?? "نامشخص"` rather than `?? status`, because falling back to
             the raw value is the defect itself (tests/no-raw-enum-copy.test.ts). */
          label: ORDER_STATUS_LABEL[status as OrderStatus] ?? "نامشخص",
          sub: faNum(n),
        }))
      )
    );

    /* One item per parked order, linking to that order: the decision is the
       «تأیید اعتبار» action on the order's own page. This used to be a bare count linking
       to /sales/admin/credit-approvals, a page that was never built. */
    const waiting = await db
      .prepare(
        `SELECT ca.order_id, o.order_no, ca.overage_toman
           FROM credit_approvals ca JOIN orders o ON o.id = ca.order_id
          WHERE ca.organization_id = ? AND ca.status = 'pending'
          ORDER BY ca.requested_at`
      )
      .all(org) as { order_id: number; order_no: string; overage_toman: number }[];
    panels.push(
      panel(
        "credit_waiting",
        "تأیید اعتبار در انتظار شما",
        waiting.map((w) => ({
          label: `سفارش ${w.order_no}`,
          sub: `${w.overage_toman.toLocaleString("fa-IR")} تومان بیش از سقف`,
          tone: "crit" as const,
          href: `/sales/orders/${w.order_id}`,
        }))
      )
    );

    const unplanned = await db
      .prepare(
        `SELECT o.id, o.order_no FROM orders o
          WHERE o.organization_id = ? AND o.status = 'CONFIRMED'
            AND NOT EXISTS (SELECT 1 FROM delivery_stops ds WHERE ds.order_id = o.id)
          ORDER BY o.order_date LIMIT 10`
      )
      .all(org) as { id: number; order_no: string }[];
    panels.push(
      panel(
        "unplanned",
        "سفارش‌های بی‌مسیر",
        unplanned.map((o) => ({ label: `سفارش ${o.order_no}`, href: "/sales/routing", tone: "warn" as const }))
      )
    );

    panels.push(
      panel(
        "exceptions",
        "هشدارها",
        (await listAlerts(org, { open: true })).map((a) => ({
          label: a.title,
          /* SEVERITY_FA, not the raw column. `severity` is an English enum
             («critical»/«warning»/«opportunity») and this panel put it straight on screen
             under a Persian heading -- the user reported reading «critical» in «هشدارها».
             The tone below already encodes the same thing in colour. */
          sub: SEVERITY_FA[a.severity] ?? "نامشخص",
          tone: a.severity === "critical" ? "crit" : "warn",
          href: "/sales",
        }))
      )
    );
  }

  if (session.role === "rep_manager") {
    const byStage = await db
      .prepare(
        `SELECT stage, COUNT(*) AS n FROM representative_profiles WHERE organization_id = ? GROUP BY stage`
      )
      .all(org) as { stage: string; n: number }[];
    panels.push(
      panel(
        "reps_by_stage",
        "نمایندگان بر اساس مرحله",
        /* REP_STAGE_LABEL, not the raw enum: `stage` is «prospect»/«onboarding»/… and
           was rendering as-is beside a Persian heading. Same leak as the alert severity
           above; found while fixing that one. */
        byStage.map((s) => ({
          label: REP_STAGE_LABEL[s.stage as RepStage] ?? "نامشخص",
          sub: String(s.n),
          href: "/sales/reps",
        }))
      )
    );
  }

  /* The month's target, for EVERY role.
   *
   *  This used to live inside the `phone_sales` branch alone, so a manager staring at
   *  "سفارش‌های امروز" had no month context at all — the single biggest gap on the screen.
   *  `targets` already stores revenue_toman / kg / orders per Jalali period and
   *  `targetProgress` already computes it, so this is wiring, not a new table.
   *
   *  A manager with no personal target falls back to the GROUP target, which is the number
   *  they are actually accountable for. Placed here rather than in a branch so it applies to
   *  every role, including a driver. */
  const personal = await targetProgress(org, {
    user_id: session.user.id,
    period: currentPeriod(),
    metric: "revenue_toman",
  });
  const groupProgress =
    session.groupId === null
      ? null
      : await targetProgress(org, {
          group_id: session.groupId,
          period: currentPeriod(),
          metric: "revenue_toman",
        });
  const goal = personal.target > 0 ? personal : groupProgress;
  if (goal && goal.target > 0) {
    panels.push({
      key: "target",
      title: "هدف این ماه",
      items: [
        {
          label: `${Math.round(goal.fraction * 100)}٪`,
          sub: `${goal.actual.toLocaleString("fa-IR")} از ${goal.target.toLocaleString("fa-IR")}`,
          href: "/sales/commission",
          tone: goal.fraction >= 1 ? "good" : goal.fraction >= 0.6 ? "info" : "warn",
        },
      ],
    });
  }

  const hero: BriefingHero = {
    userId: session.user.id,
    displayName: session.user.display_name,
    avatarUrl: session.user.avatar_url ?? null,
    role: session.role,
  };

  const kept = panels.filter((p): p is BriefingPanel => p !== null);

  /* A briefing with nothing in it is indistinguishable from a broken page — the person
     cannot tell "quiet day" from "signed in wrong", and neither can we.
     So an empty day still renders one panel saying so. The per-panel emptiness filter stays
     exactly as it is: it is what keeps a screen from showing five empty headings.
     The hero is built BEFORE this branch and returned on BOTH paths: a hero that vanishes on
     a quiet day is worse than one that never existed, because the layout shifts under the
     reader exactly when they expect nothing to happen. */
  if (kept.length === 0) {
    return {
      role: session.role,
      hero,
      panels: [{ key: "empty_day", title: "امروز", items: [{ label: "کاری برای امروز ثبت نشده است" }] }],
    };
  }

  return { role: session.role, hero, panels: kept };
}
