/** The Action Center — "the manager arrives to find problems delivered rather than
 *  hunting for them" (source §5).
 *
 *  `actionCenterFor` runs six bounded, session-scoped queries, turns each hit into a
 *  `Candidate` with an Impact / Probability / Urgency triple, and hands them to the
 *  pure `rankActionCenter`. Nothing here scans the whole `orders` table — every source
 *  is filtered to open rows, a recent window, or a stalled set.
 */

import { getDb } from "@/lib/db";
import { groupFilter, orderFilter, type Session } from "@/lib/session";
import { FULFILLED_ORDER_STATUSES, sqlStatusList } from "@/lib/orderStateMachine";
import { customerDebtsForOrg } from "@/lib/repo/payments";
import { stockLevels } from "@/lib/repo/stock";
import { customerHealthFor } from "@/lib/repo/health";
import { snapshotRows } from "@/lib/repo/kpiSnapshots";
import { rankActionCenter, type Bucket, type Candidate, type RankedItem } from "@/lib/analysis/actionCenter";
import { customerHref } from "@/lib/deepLink";

/** Alert categories, in Persian.
 *
 *  `alerts.category` is free text and falls back to the firing rule's `code`, so this map
 *  can never be exhaustive. An unmapped category yields NO subtitle rather than an English
 *  one: «webhook_failed» under a Persian headline is worse than nothing, and the bucket
 *  colour and the title already carry the meaning. The user found «credit» this way.
 */
export const ALERT_CATEGORY_FA: Record<string, string> = {
  stock: "انبار",
  credit: "اعتبار",
  delivery: "تحویل",
  payment: "پرداخت",
  quality: "کیفیت",
  route: "مسیر",
};

/** severity is CHECK-constrained to these three in the schema, so this map IS exhaustive.
 *  Exported for the buckets' own headings — see components/analysis/ActionCenter.tsx. */
export const SEVERITY_FA: Record<string, string> = {
  critical: "بحرانی",
  warning: "هشدار",
  opportunity: "فرصت",
};

const DAY_MS = 86_400_000;
/** Toman figures are normalised against this before clamping to [0,1]. */
const IMPACT_REF_TOMAN = 20_000_000;
const OVERDUE_WARN_TOMAN = 2_000_000;
const OVERDUE_CRIT_TOMAN = 20_000_000;
const STALLED_DAYS = 2;

const norm = (toman: number): number => Math.max(0, Math.min(1, toman / IMPACT_REF_TOMAN));

function alertCandidates(session: Session): Candidate[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, severity, category, title, group_id, created_at
         FROM alerts WHERE organization_id = ? AND resolved_at IS NULL`
    )
    .all(session.organizationId) as {
    id: number;
    severity: Bucket;
    category: string;
    title: string;
    group_id: number | null;
    created_at: string;
  }[];
  const now = Date.now();
  return rows
    .filter(
      (a) =>
        session.role === "owner" ||
        session.role === "platform_owner" ||
        a.group_id === null ||
        a.group_id === session.groupId
    )
    .map((a) => {
      const ageDays = (now - Date.parse(a.created_at)) / DAY_MS;
      return {
        key: `alert:${a.id}`,
        kind: "alert" as const,
        title_fa: a.title,
        sub_fa: ALERT_CATEGORY_FA[a.category],
        bucket: a.severity,
        impact: a.category === "stock" || a.category === "credit" ? 0.7 : 0.5,
        probability: 1,
        urgency: Math.max(0.2, Math.min(1, ageDays / 5)),
        href: "/sales/today",
      };
    });
}

interface StalledRow {
  id: number;
  status: string;
  last_event: string | null;
  value: number;
}

function stalledOrderCandidates(session: Session): Candidate[] {
  const db = getDb();
  const scope = orderFilter(session, "o");
  const cutoff = new Date(Date.now() - STALLED_DAYS * DAY_MS).toISOString();
  const rows = db
    .prepare(
      `SELECT o.id, o.status,
              (SELECT MAX(e.created_at) FROM order_events e WHERE e.order_id = o.id) AS last_event,
              COALESCE(SUM(COALESCE(ol.packs_delivered, ol.packs_ordered) * ol.unit_price_toman), 0) AS value
         FROM orders o
         LEFT JOIN order_lines ol ON ol.order_id = o.id
        WHERE o.organization_id = ?
          AND o.status IN ('CONFIRMED', 'PLANNED', 'READY')${scope.sql}
        GROUP BY o.id
       HAVING last_event IS NULL OR last_event < ?`
    )
    .all(session.organizationId, ...scope.params, cutoff) as unknown as StalledRow[];

  const now = Date.now();
  return rows.map((r) => {
    const staleDays = r.last_event ? (now - Date.parse(r.last_event)) / DAY_MS : STALLED_DAYS + 1;
    return {
      key: `stalled_order:${r.id}`,
      kind: "stalled_order" as const,
      title_fa: `سفارش راکد در «${r.status}»`,
      sub_fa: `${Math.floor(staleDays)} روز بدون حرکت`,
      bucket: staleDays > 5 ? ("critical" as Bucket) : ("warning" as Bucket),
      impact: norm(r.value),
      probability: 1,
      urgency: Math.min(1, staleDays / 7),
      href: `/sales/orders/${r.id}`,
    };
  });
}

function overdueCandidates(session: Session): Candidate[] {
  const db = getDb();
  const f = groupFilter(session);
  const inScope = new Map(
    (
      db.prepare(`SELECT id, business_name FROM customers WHERE 1 = 1${f.sql}`).all(...f.params) as {
        id: number;
        business_name: string;
      }[]
    ).map((c) => [c.id, c.business_name])
  );
  const debts = customerDebtsForOrg(session.organizationId);
  const out: Candidate[] = [];
  for (const [id, name] of inScope) {
    const over = debts.get(id)?.bucket_30_plus ?? 0;
    if (over < OVERDUE_WARN_TOMAN) continue;
    out.push({
      key: `overdue_receivable:${id}`,
      kind: "overdue_receivable",
      title_fa: `مطالبات معوق: ${name}`,
      sub_fa: `${Math.round(over).toLocaleString("fa-IR")} تومان بیش از ۳۰ روز`,
      bucket: over >= OVERDUE_CRIT_TOMAN ? "critical" : "warning",
      impact: norm(over),
      probability: 1,
      urgency: 0.7,
      href: customerHref(id),
    });
  }
  return out;
}

function atRiskCandidates(session: Session): Candidate[] {
  const db = getDb();
  const f = groupFilter(session);
  const inScope = new Map(
    (
      db.prepare(`SELECT id, business_name FROM customers WHERE 1 = 1${f.sql}`).all(...f.params) as {
        id: number;
        business_name: string;
      }[]
    ).map((c) => [c.id, c.business_name])
  );

  // Prefer the snapshot the sweep wrote; fall back to a bounded live compute.
  const snaps = snapshotRows(session.organizationId, { metric: "health_score", scope_type: "customer" });
  let scored: { id: number; score: number }[];
  if (snaps.length > 0) {
    const latest = snaps.reduce((m, r) => (r.period > m ? r.period : m), snaps[0].period);
    scored = snaps
      .filter((r) => r.period === latest && inScope.has(r.scope_id))
      .map((r) => ({ id: r.scope_id, score: r.value }));
  } else {
    const recent = db
      .prepare(
        `SELECT DISTINCT o.customer_id AS id FROM orders o
          WHERE o.organization_id = ? AND o.status IN (${sqlStatusList(FULFILLED_ORDER_STATUSES)})
            AND o.order_date >= ? LIMIT 60`
      )
      .all(session.organizationId, new Date(Date.now() - 180 * DAY_MS).toISOString()) as { id: number }[];
    scored = recent
      .filter((r) => inScope.has(r.id))
      .map((r) => ({ id: r.id, score: customerHealthFor(session.organizationId, r.id).score }));
  }

  return scored
    .filter((s) => s.score < 40)
    .map((s) => ({
      key: `at_risk_customer:${s.id}`,
      kind: "at_risk_customer" as const,
      title_fa: `مشتری در خطر: ${inScope.get(s.id) ?? s.id}`,
      sub_fa: `امتیاز سلامت ${Math.round(s.score)}`,
      bucket: "warning" as Bucket,
      impact: 0.5,
      probability: Math.max(0, Math.min(1, (70 - s.score) / 70)),
      urgency: 0.5,
      href: customerHref(s.id),
    }));
}

function stockoutCandidates(session: Session): Candidate[] {
  // Stock is org-wide (no group column), so this source only shows for owner / manager.
  if (session.role === "salesperson" || session.role === "driver") return [];
  const db = getDb();
  const since = new Date(Date.now() - 14 * DAY_MS).toISOString();
  const runRate = new Map(
    (
      db
        .prepare(
          `SELECT ol.product_id AS pid,
                  SUM(COALESCE(ol.packs_delivered, 0) * ol.qty_per_pack) AS base_qty,
                  AVG(ol.unit_price_toman) AS price
             FROM order_lines ol JOIN orders o ON o.id = ol.order_id
            WHERE o.organization_id = ? AND o.status IN (${sqlStatusList(FULFILLED_ORDER_STATUSES)})
              AND o.order_date >= ?
            GROUP BY ol.product_id`
        )
        .all(session.organizationId, since) as { pid: number; base_qty: number; price: number }[]
    ).map((r) => [r.pid, { perDay: r.base_qty / 14, price: r.price }])
  );
  const names = new Map(
    (db.prepare("SELECT id, name FROM products WHERE organization_id = ?").all(session.organizationId) as {
      id: number;
      name: string;
    }[]).map((p) => [p.id, p.name])
  );

  const out: Candidate[] = [];
  for (const lvl of stockLevels(session.organizationId)) {
    const rr = runRate.get(lvl.product_id);
    if (!rr || rr.perDay <= 0) continue;
    const coverDays = lvl.available / rr.perDay;
    if (lvl.available > 0 && coverDays >= 7) continue;
    out.push({
      key: `stockout_risk:${lvl.product_id}`,
      kind: "stockout_risk",
      title_fa: `خطر کمبود: ${names.get(lvl.product_id) ?? lvl.product_id}`,
      sub_fa:
        lvl.available <= 0
          ? "موجودی قابل‌تعهد صفر یا منفی"
          : `پوشش حدود ${Math.max(0, Math.floor(coverDays))} روز`,
      bucket: lvl.available <= 0 ? "critical" : "warning",
      impact: norm(rr.perDay * 7 * (rr.price || 0)),
      probability: lvl.available <= 0 ? 1 : Math.max(0.3, 1 - coverDays / 7),
      urgency: lvl.available <= 0 ? 1 : 0.7,
      href: "/sales/stock",
    });
  }
  return out;
}

function crossSellCandidates(session: Session): Candidate[] {
  if (session.role === "driver") return [];
  const db = getDb();
  const active = new Date(Date.now() - 60 * DAY_MS).toISOString();
  const oScope = orderFilter(session, "o");

  // the org's most-penetrated product
  const top = db
    .prepare(
      `SELECT ol.product_id AS pid, p.name AS name,
              COUNT(DISTINCT o.customer_id) AS buyers,
              AVG(COALESCE(ol.packs_delivered, ol.packs_ordered) * ol.unit_price_toman) AS avg_line
         FROM order_lines ol
         JOIN orders o ON o.id = ol.order_id
         JOIN products p ON p.id = ol.product_id
        WHERE o.organization_id = ? AND o.status IN (${sqlStatusList(FULFILLED_ORDER_STATUSES)})${oScope.sql}
        GROUP BY ol.product_id
        ORDER BY buyers DESC
        LIMIT 1`
    )
    .get(session.organizationId, ...oScope.params) as
    | { pid: number; name: string; buyers: number; avg_line: number }
    | undefined;
  if (!top || top.buyers < 3) return [];

  const activeCustomers = db
    .prepare(
      `SELECT DISTINCT o.customer_id AS id, c.business_name AS name
         FROM orders o JOIN customers c ON c.id = o.customer_id
        WHERE o.organization_id = ? AND o.order_date >= ?${oScope.sql}`
    )
    .all(session.organizationId, active, ...oScope.params) as { id: number; name: string }[];
  const totalActive = activeCustomers.length || 1;
  const penetration = Math.min(1, top.buyers / totalActive);

  const buyersOfTop = new Set(
    (
      db
        .prepare(
          `SELECT DISTINCT o.customer_id AS id FROM orders o JOIN order_lines ol ON ol.order_id = o.id
            WHERE o.organization_id = ? AND ol.product_id = ?`
        )
        .all(session.organizationId, top.pid) as { id: number }[]
    ).map((r) => r.id)
  );

  return activeCustomers
    .filter((c) => !buyersOfTop.has(c.id))
    .slice(0, 5)
    .map((c) => ({
      key: `cross_sell:${top.pid}:${c.id}`,
      kind: "cross_sell" as const,
      title_fa: `فرصت فروش «${top.name}» به ${c.name}`,
      sub_fa: `${Math.round(penetration * 100)}٪ مشتری‌های مشابه این کالا را می‌خرند`,
      bucket: "opportunity" as Bucket,
      impact: norm(top.avg_line || 0),
      probability: penetration,
      urgency: 0.3,
      href: customerHref(c.id),
    }));
}

/** Phase 10: customers the churn model flags `high`. A no-op until the prediction
 *  sweep has written `churn_scores`. */
function churnCandidates(session: Session): Candidate[] {
  const db = getDb();
  const f = groupFilter(session);
  const inScope = new Set(
    (
      db.prepare(`SELECT id FROM customers WHERE 1 = 1${f.sql}`).all(...f.params) as { id: number }[]
    ).map((c) => c.id)
  );
  const rows = db
    .prepare(
      `SELECT cs.customer_id, cs.probability, cs.reason_fa, c.business_name
         FROM churn_scores cs JOIN customers c ON c.id = cs.customer_id
        WHERE cs.organization_id = ? AND cs.band = 'high'`
    )
    .all(session.organizationId) as {
    customer_id: number;
    probability: number;
    reason_fa: string | null;
    business_name: string;
  }[];

  return rows
    .filter((r) => inScope.has(r.customer_id))
    .map((r) => ({
      key: `churn:${r.customer_id}`,
      kind: "at_risk_customer" as const,
      title_fa: `احتمال ریزش: ${r.business_name}`,
      sub_fa: r.reason_fa ?? `احتمال ${Math.round(r.probability * 100)}٪`,
      bucket: "warning" as Bucket,
      impact: 0.5,
      probability: Math.max(0, Math.min(1, r.probability)),
      urgency: 0.5,
      href: customerHref(r.customer_id),
    }));
}

export function actionCenterFor(session: Session): Record<Bucket, RankedItem[]> {
  if (session.role === "driver") {
    return { critical: [], warning: [], opportunity: [] };
  }
  const cands: Candidate[] = [
    ...alertCandidates(session),
    ...stalledOrderCandidates(session),
    ...overdueCandidates(session),
    ...atRiskCandidates(session),
    ...churnCandidates(session),
    ...stockoutCandidates(session),
    ...crossSellCandidates(session),
  ];
  return rankActionCenter(cands);
}
