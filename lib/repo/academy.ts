import fs from "node:fs";
import path from "node:path";
import { getDb } from "@/lib/db";
import { makeRepo } from "./base";

export class AcademyError extends Error {}

export interface ObjectionCardRow {
  id: number;
  organization_id: number | null;
  outcome_code: string;
  customer_type: string | null;
  title_fa: string;
  script_fa: string;
  module_slug: string | null;
  active: number;
  updated_at: string;
}

export const objectionCardsRepo = makeRepo<ObjectionCardRow>("objection_cards", { tenant: true });

/** Cards visible to a tenant: its own ∪ the NULL-org starters, tenant winning per
 *  (outcome_code, customer_type). */
export function listObjectionCards(
  organizationId: number,
  filter: { outcome_code?: string; customer_type?: string } = {}
): ObjectionCardRow[] {
  const params: unknown[] = [organizationId];
  let sql =
    "SELECT *, (organization_id IS NOT NULL) AS is_tenant FROM objection_cards WHERE active = 1 AND (organization_id = ? OR organization_id IS NULL)";
  if (filter.outcome_code) {
    sql += " AND outcome_code = ?";
    params.push(filter.outcome_code);
  }
  const rows = objectionCardsRepo
    .db()
    .prepare(sql)
    .all(...(params as never[])) as unknown as (ObjectionCardRow & { is_tenant: number })[];

  const key = (r: ObjectionCardRow) => `${r.outcome_code}::${r.customer_type ?? ""}`;
  const best = new Map<string, ObjectionCardRow>();
  for (const r of rows) {
    const k = key(r);
    const existing = best.get(k);
    if (!existing || r.is_tenant) best.set(k, r);
  }
  let out = [...best.values()];
  if (filter.customer_type) {
    out = out.filter((r) => r.customer_type === filter.customer_type || r.customer_type === null);
  }
  return out;
}

/** The single best card for an outcome: a customer_type-specific match beats a generic
 *  one; a tenant card beats a default. */
export function objectionCardFor(
  organizationId: number,
  outcomeCode: string,
  customerType?: string | null
): ObjectionCardRow | undefined {
  const cards = listObjectionCards(organizationId, { outcome_code: outcomeCode });
  if (customerType) {
    const specific = cards.find((c) => c.customer_type === customerType);
    if (specific) return specific;
  }
  return cards.find((c) => c.customer_type === null) ?? cards[0];
}

export function upsertObjectionCard(
  organizationId: number,
  input: {
    outcome_code: string;
    customer_type?: string | null;
    title_fa: string;
    script_fa: string;
    module_slug?: string | null;
    active?: boolean;
  }
): void {
  getDb()
    .prepare(
      `INSERT INTO objection_cards
         (organization_id, outcome_code, customer_type, title_fa, script_fa, module_slug, active, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (organization_id, outcome_code, customer_type) DO UPDATE SET
         title_fa = excluded.title_fa, script_fa = excluded.script_fa,
         module_slug = excluded.module_slug, active = excluded.active, updated_at = excluded.updated_at`
    )
    .run(
      organizationId,
      input.outcome_code,
      input.customer_type ?? null,
      input.title_fa,
      input.script_fa,
      input.module_slug ?? null,
      input.active === false ? 0 : 1,
      new Date().toISOString()
    );
}

export interface AcademyModule {
  slug: string;
  module: number;
  title_fa: string;
  order: number;
  status: string;
}

export function academyManifest(): AcademyModule[] {
  try {
    const p = path.join(process.cwd(), "content", "academy", "_manifest.json");
    return (JSON.parse(fs.readFileSync(p, "utf8")) as AcademyModule[]).sort((a, b) => a.order - b.order);
  } catch {
    return [];
  }
}

export function lessonBody(slug: string): string | null {
  try {
    const p = path.join(process.cwd(), "content", "academy", slug, "index.mdx");
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

export function markLessonDone(organizationId: number, userId: number, lessonSlug: string): void {
  getDb()
    .prepare(
      `INSERT INTO lesson_progress (organization_id, user_id, lesson_slug, completed_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (organization_id, user_id, lesson_slug) DO UPDATE SET completed_at = excluded.completed_at`
    )
    .run(organizationId, userId, lessonSlug, new Date().toISOString());
}

export function lessonProgress(
  organizationId: number,
  userId: number
): { lesson_slug: string; completed_at: string }[] {
  return getDb()
    .prepare(
      "SELECT lesson_slug, completed_at FROM lesson_progress WHERE organization_id = ? AND user_id = ?"
    )
    .all(organizationId, userId) as unknown as { lesson_slug: string; completed_at: string }[];
}
