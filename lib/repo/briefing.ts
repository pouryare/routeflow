import { getDb } from "@/lib/db";
import type { Session } from "@/lib/session";
import { scopeGroupIds } from "@/lib/session";
import { toJalali } from "@/lib/jalali";
import { listTasks } from "./tasks";
import { listAlerts } from "./alerts";
import { targetProgress } from "./targets";
import { SEVERITY_FA } from "@/lib/repo/actionCenter";
import { REP_STAGE_LABEL, type RepStage } from "@/lib/repStages";
import { customerHref } from "@/lib/deepLink";
import { isVanRole } from "../roles";

export interface BriefingItem {
  label: string;
  sub?: string;
  href?: string;
  tone?: "good" | "warn" | "crit" | "info";
  action?: { kind: "task_outcome"; task_id: number; customer_id?: number } | { kind: "link"; href: string };
}
export interface BriefingPanel {
  key: string;
  title: string;
  items: BriefingItem[];
  more?: number;
}
export interface Briefing {
  role: string;
  panels: BriefingPanel[];
}

const CAP = 5;
const cap = (items: BriefingItem[]): { items: BriefingItem[]; more?: number } =>
  items.length > CAP ? { items: items.slice(0, CAP), more: items.length - CAP } : { items };

function panel(key: string, title: string, items: BriefingItem[]): BriefingPanel | null {
  if (items.length === 0) return null;
  return { key, title, ...cap(items) };
}

function currentPeriod(): string {
  const j = toJalali(new Date().toISOString())!;
  return `${j.jy}-${String(j.jm).padStart(2, "0")}`;
}

export function todayFor(session: Session): Briefing {
  const db = getDb();
  const org = session.organizationId;
  const today = new Date().toISOString().slice(0, 10);
  const panels: (BriefingPanel | null)[] = [];

  if (session.role === "phone_sales") {
    const tasks = listTasks(org, { assignee: session.user.id }).concat(
      listTasks(org, { role: "phone_sales" }).filter((t) => t.assignee_user_id === null)
    );
    panels.push(
      panel(
        "open_tasks",
        "کارهای باز",
        tasks.map((t) => ({
          label: t.title,
          sub: t.priority,
          action: t.entity_type === "customer" && t.entity_id
            ? { kind: "task_outcome", task_id: t.id, customer_id: t.entity_id }
            : { kind: "task_outcome", task_id: t.id },
        }))
      )
    );

    const overdue = db
      .prepare(
        `SELECT c.id, c.business_name, MAX(o.order_date) AS last
           FROM customers c JOIN orders o ON o.id IN (SELECT id FROM orders WHERE customer_id = c.id)
          WHERE c.organization_id = ? AND o.salesperson_user_id = ?
          GROUP BY c.id HAVING julianday('now') - julianday(MAX(o.order_date)) > 14
          ORDER BY last LIMIT 10`
      )
      .all(org, session.user.id) as { id: number; business_name: string; last: string }[];
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

    const p = targetProgress(org, {
      user_id: session.user.id,
      period: currentPeriod(),
      metric: "revenue_toman",
    });
    if (p.target > 0) {
      panels.push({
        key: "target",
        title: "هدف این ماه",
        items: [
          {
            label: `${Math.round(p.fraction * 100)}%`,
            sub: `${p.actual.toLocaleString("fa-IR")} از ${p.target.toLocaleString("fa-IR")}`,
            href: "/sales/commission",
            tone: p.fraction >= 1 ? "good" : p.fraction >= 0.6 ? "info" : "warn",
          },
        ],
      });
    }
  }

  if (isVanRole(session.role)) {
    const run = db
      .prepare(
        "SELECT id, weather_json FROM delivery_runs WHERE driver_user_id = ? AND run_date = ? AND organization_id = ?"
      )
      .get(session.user.id, today, org) as { id: number; weather_json: string | null } | undefined;
    if (run) {
      const agg = db
        .prepare(
          `SELECT COUNT(*) AS stops,
                  SUM(CASE WHEN ds.status = 'pending' THEN 1 ELSE 0 END) AS remaining
             FROM delivery_stops ds WHERE ds.run_id = ?`
        )
        .get(run.id) as { stops: number; remaining: number };
      panels.push({
        key: "today_run",
        title: "مسیر امروز",
        items: [
          {
            label: `${agg.stops} توقف`,
            sub: `${agg.remaining} باقی‌مانده`,
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
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const failed = db
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
    const gids = scopeGroupIds(session);
    const inClause = gids === "all" || gids.length === 0 ? null : gids.join(",");

    const byState = db
      .prepare(
        `SELECT status, COUNT(*) AS n FROM orders
          WHERE organization_id = ? AND order_date = ?${inClause ? ` AND group_id IN (${inClause})` : ""}
          GROUP BY status`
      )
      .all(org, today) as { status: string; n: number }[];
    panels.push(
      panel(
        "orders_by_state",
        "سفارش‌های امروز",
        byState.map((s) => ({ label: s.status, sub: String(s.n), href: "/sales/board" }))
      )
    );

    /* One item per parked order, linking to that order: the decision is the
       «تأیید اعتبار» action on the order's own page. This used to be a bare count linking
       to /sales/admin/credit-approvals, a page that was never built. */
    const waiting = db
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

    const unplanned = db
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
        listAlerts(org, { open: true }).map((a) => ({
          label: a.title,
          /* SEVERITY_FA, not the raw column. `severity` is an English enum
             («critical»/«warning»/«opportunity») and this panel put it straight on screen
             under a Persian heading -- the user reported reading «critical» in «هشدارها».
             The tone below already encodes the same thing in colour. */
          sub: SEVERITY_FA[a.severity] ?? a.severity,
          tone: a.severity === "critical" ? "crit" : "warn",
          href: "/sales",
        }))
      )
    );
  }

  if (session.role === "rep_manager") {
    const byStage = db
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
          label: REP_STAGE_LABEL[s.stage as RepStage] ?? s.stage,
          sub: String(s.n),
          href: "/sales/reps",
        }))
      )
    );
  }

  const kept = panels.filter((p): p is BriefingPanel => p !== null);

  /* A briefing with nothing in it is indistinguishable from a broken page — the person
     cannot tell "quiet day" from "signed in wrong", and neither can we.
     So an empty day still renders one panel saying so. The per-panel emptiness filter stays
     exactly as it is: it is what keeps a screen from showing five empty headings. */
  if (kept.length === 0) {
    return {
      role: session.role,
      panels: [{ key: "empty_day", title: "امروز", items: [{ label: "کاری برای امروز ثبت نشده است" }] }],
    };
  }

  return { role: session.role, panels: kept };
}
