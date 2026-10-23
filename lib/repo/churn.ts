/** Churn scoring, assembled from the order history.
 *
 *  The logistic model + its SGD step are pure (lib/predict/churn). This module builds
 *  the feature vectors, scores every customer into `churn_scores`, and — once there
 *  are enough real lapses to learn from — folds a labelled set through `churnStep` to
 *  replace the shipped default weights with the tenant's own.
 */

import { getDb } from "@/lib/db";
import { PRICED_ORDER_STATUSES, FULFILLED_ORDER_STATUSES, sqlStatusList } from "@/lib/orderStateMachine";
import { customerDebt } from "@/lib/repo/payments";
import {
  churnScore,
  churnStep,
  churnBand,
  churnReason,
  DEFAULT_CHURN_WEIGHTS,
  type ChurnFeatures,
  type ChurnWeights,
} from "@/lib/predict/churn";

import { mapSeq } from "@/lib/seq";
const DAY_MS = 86_400_000;
const TRAIN_WINDOW_DAYS = 60;
const MIN_TRAIN_ROWS = 10;
const TRAIN_EPOCHS = 10;
const TRAIN_LR = 0.05;

const daysBetween = (a: string, b: string) => (Date.parse(a) - Date.parse(b)) / DAY_MS;

/** Feature vector for a customer, as of `asOfIso` (orders after it are ignored, so this
 *  is safe to call at a historical cutoff for training). */
export async function churnFeaturesFor(
  organizationId: number,
  customerId: number,
  asOfIso: string = new Date().toISOString()
): Promise<ChurnFeatures> {
  const db = getDb();
  const dates = (
    await db
      .prepare(
        `SELECT order_date FROM orders
          WHERE organization_id = ? AND customer_id = ?
            AND status IN (${sqlStatusList(PRICED_ORDER_STATUSES)})
            AND order_date < ?
          ORDER BY order_date`
      )
      .all(organizationId, customerId, asOfIso) as { order_date: string }[]
  ).map((r) => r.order_date);

  const last = dates.at(-1) ?? null;
  const first = dates[0] ?? null;
  const meanInterval =
    dates.length >= 2 ? daysBetween(dates.at(-1)!, dates[0]) / (dates.length - 1) : 30;
  const recency_ratio = last ? Math.max(0, daysBetween(asOfIso, last)) / (meanInterval || 30) : 5;

  const q1 = new Date(Date.parse(asOfIso) - 90 * DAY_MS).toISOString();
  const q2 = new Date(Date.parse(asOfIso) - 180 * DAY_MS).toISOString();
  const thisQ = dates.filter((d) => d >= q1).length;
  const prevQ = dates.filter((d) => d >= q2 && d < q1).length;
  const trend = prevQ === 0 ? (thisQ > 0 ? 2 : 1) : thisQ / prevQ;

  const tenure_months = first ? Math.max(0, daysBetween(asOfIso, first)) / 30 : 0;

  const complaints_90d = Number(
    (
      await db
        .prepare(
          `SELECT COUNT(*) AS n FROM quality_complaints
            WHERE organization_id = ? AND customer_id = ?
              AND (status = 'open' OR reported_at >= ?)`
        )
        .get(organizationId, customerId, q1) as { n: number }
    ).n
  );

  const rev = Number(
    (
      await db
        .prepare(
          `SELECT COALESCE(SUM(COALESCE(ol.packs_delivered, ol.packs_ordered) * ol.unit_price_toman), 0) AS r
             FROM order_lines ol JOIN orders o ON o.id = ol.order_id
            WHERE o.organization_id = ? AND o.customer_id = ?
              AND o.status IN (${sqlStatusList(FULFILLED_ORDER_STATUSES)})
              AND o.order_date >= ? AND o.order_date < ?`
        )
        .get(organizationId, customerId, q2, asOfIso) as { r: number }
    ).r
  );
  const overdue = (await customerDebt(organizationId, customerId, asOfIso)).bucket_30_plus;
  const overdue_ratio = rev > 0 ? overdue / rev : overdue > 0 ? 2 : 0;

  return { recency_ratio, trend, tenure_months, complaints_90d, overdue_ratio };
}

/** The tenant's learned weights, or the shipped default. */
export async function churnWeightsFor(organizationId: number): Promise<ChurnWeights> {
  const row = await getDb()
    .prepare(
      `SELECT weights_json FROM churn_models
        WHERE organization_id = ? OR organization_id IS NULL
        ORDER BY organization_id IS NULL
        LIMIT 1`
    )
    .get(organizationId) as { weights_json: string } | undefined;
  if (!row) return { ...DEFAULT_CHURN_WEIGHTS };
  try {
    return { ...DEFAULT_CHURN_WEIGHTS, ...(JSON.parse(row.weights_json) as Partial<ChurnWeights>) };
  } catch {
    return { ...DEFAULT_CHURN_WEIGHTS };
  }
}

export interface ChurnResult {
  probability: number;
  band: "low" | "watch" | "high";
  reason_fa: string;
}

export async function scoreChurn(
  organizationId: number,
  customerId: number,
  asOfIso: string = new Date().toISOString()
): Promise<ChurnResult> {
  const f = await churnFeaturesFor(organizationId, customerId, asOfIso);
  const p = churnScore(f, await churnWeightsFor(organizationId));
  return { probability: p, band: churnBand(p), reason_fa: churnReason(f) };
}

/** Build a labelled set from history and fold it through `churnStep`. A customer active
 *  at `cutoff = asOf − 60d` is label 1 if they then had no order in the following 60
 *  days. No-op (keeps the default) below MIN_TRAIN_ROWS labelled rows. */
export async function trainChurnFromLapses(
  organizationId: number,
  asOfIso: string = new Date().toISOString()
): Promise<{ trained: boolean; n_obs: number }> {
  const db = getDb();
  const asOf = Date.parse(asOfIso);
  const cutoffIso = new Date(asOf - TRAIN_WINDOW_DAYS * DAY_MS).toISOString();
  const activeFromIso = new Date(asOf - 2 * TRAIN_WINDOW_DAYS * DAY_MS).toISOString();

  const activeAtCutoff = (
    await db
      .prepare(
        `SELECT DISTINCT customer_id AS id FROM orders
          WHERE organization_id = ? AND status IN (${sqlStatusList(PRICED_ORDER_STATUSES)})
            AND order_date >= ? AND order_date < ?`
      )
      .all(organizationId, activeFromIso, cutoffIso) as { id: number }[]
  ).map((r) => r.id);

  if (activeAtCutoff.length < MIN_TRAIN_ROWS) {
    const existing = await db
      .prepare("SELECT n_obs FROM churn_models WHERE organization_id = ?")
      .get(organizationId) as { n_obs: number } | undefined;
    return { trained: false, n_obs: existing?.n_obs ?? 0 };
  }

  const rows = await mapSeq(activeAtCutoff, async (id) => {
    const orderedAfter = await db
      .prepare(
        `SELECT 1 FROM orders
          WHERE organization_id = ? AND customer_id = ? AND status IN (${sqlStatusList(PRICED_ORDER_STATUSES)})
            AND order_date >= ? AND order_date < ? LIMIT 1`
      )
      .get(organizationId, id, cutoffIso, asOfIso);
    return {
      features: await churnFeaturesFor(organizationId, id, cutoffIso),
      label: (orderedAfter ? 0 : 1) as 0 | 1,
    };
  });

  let w = await churnWeightsFor(organizationId);
  for (let epoch = 0; epoch < TRAIN_EPOCHS; epoch++) {
    for (const r of [...rows].sort(() => Math.random() - 0.5)) {
      w = churnStep(w, r.features, r.label, TRAIN_LR);
    }
  }

  await db.prepare(
    `INSERT INTO churn_models (organization_id, weights_json, n_obs, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (organization_id) DO UPDATE SET weights_json = excluded.weights_json,
       n_obs = excluded.n_obs, updated_at = excluded.updated_at`
  ).run(organizationId, JSON.stringify(w), rows.length, new Date().toISOString());

  return { trained: true, n_obs: rows.length };
}

/** Score every customer with at least one confirmed order. */
export async function materialiseChurnScores(
  organizationId: number,
  asOfIso: string = new Date().toISOString()
): Promise<number> {
  const db = getDb();
  const customers = await db
    .prepare(
      `SELECT DISTINCT customer_id AS id FROM orders
        WHERE organization_id = ? AND status IN (${sqlStatusList(PRICED_ORDER_STATUSES)})`
    )
    .all(organizationId) as { id: number }[];

  const now = new Date().toISOString();
  const stmt = db.prepare(
    `INSERT INTO churn_scores (organization_id, customer_id, probability, band, reason_fa, computed_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (organization_id, customer_id) DO UPDATE SET probability = excluded.probability,
       band = excluded.band, reason_fa = excluded.reason_fa, computed_at = excluded.computed_at`
  );
  for (const c of customers) {
    const r = await scoreChurn(organizationId, c.id, asOfIso);
    await stmt.run(organizationId, c.id, r.probability, r.band, r.reason_fa, now);
  }
  return customers.length;
}

export interface ChurnBoardRow {
  customer_id: number;
  business_name: string;
  probability: number;
  band: string;
  reason_fa: string | null;
  computed_at: string;
}

export async function churnBoard(organizationId: number, band?: "low" | "watch" | "high"): Promise<ChurnBoardRow[]> {
  const where = ["cs.organization_id = ?"];
  const params: unknown[] = [organizationId];
  if (band) {
    where.push("cs.band = ?");
    params.push(band);
  }
  return await getDb()
    .prepare(
      `SELECT cs.customer_id, c.business_name, cs.probability, cs.band, cs.reason_fa, cs.computed_at
         FROM churn_scores cs JOIN customers c ON c.id = cs.customer_id
        WHERE ${where.join(" AND ")}
        ORDER BY cs.probability DESC`
    )
    .all(...(params as never[])) as unknown as ChurnBoardRow[];
}
