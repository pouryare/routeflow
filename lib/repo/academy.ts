import fs from "node:fs";
import path from "node:path";
import { getDb, plain } from "@/lib/db";
import type { Session } from "@/lib/session";
import { MANAGE_ROLES, isOwner } from "@/lib/roles";
import { makeRepo } from "./base";
import { stringAgg } from "@/lib/database/dialect";

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
export async function listObjectionCards(
  organizationId: number,
  filter: { outcome_code?: string; customer_type?: string } = {}
): Promise<ObjectionCardRow[]> {
  const params: unknown[] = [organizationId];
  let sql =
    "SELECT *, (organization_id IS NOT NULL) AS is_tenant FROM objection_cards WHERE active = 1 AND (organization_id = ? OR organization_id IS NULL)";
  if (filter.outcome_code) {
    sql += " AND outcome_code = ?";
    params.push(filter.outcome_code);
  }
  const rows = await objectionCardsRepo
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
  // plain(): these rows go straight to a Client Component (the academy library), and
  // node:sqlite hands them back with a null prototype, which Next.js refuses to pass.
  return plain(out);
}

/** The single best card for an outcome: a customer_type-specific match beats a generic
 *  one; a tenant card beats a default. */
export async function objectionCardFor(
  organizationId: number,
  outcomeCode: string,
  customerType?: string | null
): Promise<ObjectionCardRow | undefined> {
  const cards = await listObjectionCards(organizationId, { outcome_code: outcomeCode });
  if (customerType) {
    const specific = cards.find((c) => c.customer_type === customerType);
    if (specific) return specific;
  }
  return cards.find((c) => c.customer_type === null) ?? cards[0];
}

export async function upsertObjectionCard(
  organizationId: number,
  input: {
    outcome_code: string;
    customer_type?: string | null;
    title_fa: string;
    script_fa: string;
    module_slug?: string | null;
    active?: boolean;
  }
): Promise<void> {
  await getDb()
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
  /** F133: roles that must finish this lesson. Absent or empty: optional for everyone. */
  required_for?: string[];
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

export async function markLessonDone(organizationId: number, userId: number, lessonSlug: string): Promise<void> {
  await getDb()
    .prepare(
      `INSERT INTO lesson_progress (organization_id, user_id, lesson_slug, completed_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (organization_id, user_id, lesson_slug) DO UPDATE SET completed_at = excluded.completed_at`
    )
    .run(organizationId, userId, lessonSlug, new Date().toISOString());
}

export async function lessonProgress(
  organizationId: number,
  userId: number
): Promise<{ lesson_slug: string; completed_at: string }[]> {
  return plain(
    await getDb()
      .prepare(
        "SELECT lesson_slug, completed_at FROM lesson_progress WHERE organization_id = ? AND user_id = ?"
      )
      .all(organizationId, userId) as unknown as { lesson_slug: string; completed_at: string }[]
  );
}

export interface TrainingPerson {
  id: number;
  name: string;
  role: string;
  /** Per required lesson slug: done, not done, or not required for this person's roles. */
  lessons: Record<string, "done" | "todo" | "na">;
}

/** F133: who has finished the lessons their roles require. The owner sees every active person
 *  in the company, a group manager the people in their group; nobody else gets a table. A
 *  person counts under every role they hold (users.role and user_roles). Only lessons with a
 *  `required_for` list appear. */
export async function trainingStatus(session: Session): Promise<{ lessons: AcademyModule[]; people: TrainingPerson[] } | null> {
  if (!MANAGE_ROLES.includes(session.role)) return null;
  const lessons = academyManifest().filter((m) => (m.required_for ?? []).length > 0);
  const roles = [...new Set(lessons.flatMap((m) => m.required_for ?? []))];
  if (lessons.length === 0 || roles.length === 0) return { lessons, people: [] };
  const db = getDb();
  const inGroup = !isOwner(session.role); // a group manager: their own group only
  if (inGroup && session.groupId === null) return { lessons, people: [] };
  const rows = await db
    .prepare(
      `SELECT u.id, u.display_name AS name, u.role,
              (SELECT ${stringAgg("ur.role")} FROM user_roles ur WHERE ur.user_id = u.id) AS roles
         FROM users u
        WHERE u.organization_id = ? AND u.active = 1${inGroup ? " AND u.group_id = ?" : ""}
        ORDER BY u.display_name, u.id`
    )
    .all(...(inGroup ? [session.organizationId, session.groupId as number] : [session.organizationId])) as unknown as {
    id: number; name: string; role: string; roles: string | null;
  }[];
  const done = new Set(
    (await db
      .prepare("SELECT user_id, lesson_slug FROM lesson_progress WHERE organization_id = ?")
      .all(session.organizationId) as unknown as { user_id: number; lesson_slug: string }[]).map((r) => `${r.user_id}:${r.lesson_slug}`)
  );
  const people: TrainingPerson[] = [];
  for (const r of rows) {
    const held = new Set([r.role, ...(r.roles ? r.roles.split(",") : [])]);
    if (!roles.some((x) => held.has(x))) continue;
    const cells: TrainingPerson["lessons"] = {};
    for (const m of lessons) {
      const needed = (m.required_for ?? []).some((x) => held.has(x));
      cells[m.slug] = !needed ? "na" : done.has(`${r.id}:${m.slug}`) ? "done" : "todo";
    }
    people.push({ id: r.id, name: r.name, role: r.role, lessons: cells });
  }
  // Most to do first: that is who the manager talks to.
  const todo = (p: TrainingPerson) => Object.values(p.lessons).filter((v) => v === "todo").length;
  people.sort((a, b) => todo(b) - todo(a));
  return { lessons, people };
}
