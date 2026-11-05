import { getDb } from "@/lib/db";
import { TUTORIAL_IDS } from "@/lib/tutorials/catalog";

/** Tutorials on the server: a manager sends one to a person (idea I7), and the company's step
 *  counts with no names (idea I12). Each person's own ticks live in users.prefs_json.tutorials. */

export type TutorialEvent = "start" | "skip" | "quit" | "done";
export const isTutorialEvent = (v: unknown): v is TutorialEvent => v === "start" || v === "skip" || v === "quit" || v === "done";

export async function countStep(organizationId: number, tutorialId: string, step: number, event: TutorialEvent): Promise<void> {
  if (!TUTORIAL_IDS.has(tutorialId) || !Number.isInteger(step) || step < 0 || step > 50) return;
  await getDb()
    .prepare(
      `INSERT INTO tutorial_counts (organization_id, tutorial_id, step, event, n) VALUES (?, ?, ?, ?, 1)
       ON CONFLICT (organization_id, tutorial_id, step, event) DO UPDATE SET n = tutorial_counts.n + 1`
    )
    .run(organizationId, tutorialId, step, event);
}

export type StepCount = { tutorial_id: string; step: number; event: TutorialEvent; n: number };

export async function stepCounts(organizationId: number): Promise<StepCount[]> {
  const rows = (await getDb()
    .prepare("SELECT tutorial_id, step, event, n FROM tutorial_counts WHERE organization_id = ? ORDER BY tutorial_id, step")
    .all(organizationId)) as StepCount[];
  return rows.map((r) => ({ ...r, step: Number(r.step), n: Number(r.n) }));
}

export type Assignment = { id: number; user_id: number; tutorial_id: string; sent_by: number; sent_by_name: string; sent_at: string; seen_at: string | null; done_at: string | null };

/** Sends a tutorial to a person of the same company. A second send of the same unfinished one is a no-op. */
export async function sendTutorial(organizationId: number, userId: number, tutorialId: string, sentBy: number): Promise<number | null> {
  if (!TUTORIAL_IDS.has(tutorialId)) return null;
  const db = getDb();
  const person = await db.prepare("SELECT id FROM users WHERE id = ? AND organization_id = ? AND active = 1").get(userId, organizationId);
  if (!person) return null;
  const open = (await db
    .prepare("SELECT id FROM tutorial_assignments WHERE organization_id = ? AND user_id = ? AND tutorial_id = ? AND done_at IS NULL")
    .get(organizationId, userId, tutorialId)) as { id: number } | undefined;
  if (open) return Number(open.id);
  const r = await db
    .prepare("INSERT INTO tutorial_assignments (organization_id, user_id, tutorial_id, sent_by, sent_at) VALUES (?, ?, ?, ?, ?)")
    .run(organizationId, userId, tutorialId, sentBy, new Date().toISOString());
  return Number(r.lastInsertRowid);
}

const SELECT = `SELECT a.id, a.user_id, a.tutorial_id, a.sent_by, COALESCE(u.display_name, u.username) AS sent_by_name, a.sent_at, a.seen_at, a.done_at
  FROM tutorial_assignments a JOIN users u ON u.id = a.sent_by`;

const shape = (r: Assignment): Assignment => ({ ...r, id: Number(r.id), user_id: Number(r.user_id), sent_by: Number(r.sent_by) });

/** What one person was sent and has not finished: shown on their today page. */
export async function openAssignmentsFor(organizationId: number, userId: number): Promise<Assignment[]> {
  const rows = (await getDb().prepare(`${SELECT} WHERE a.organization_id = ? AND a.user_id = ? AND a.done_at IS NULL ORDER BY a.sent_at`).all(organizationId, userId)) as Assignment[];
  return rows.map(shape);
}

/** Everything a manager sent, newest first, for the sent / seen / done list. */
export async function assignmentsSentBy(organizationId: number, sentBy: number): Promise<(Assignment & { user_name: string })[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT a.id, a.user_id, a.tutorial_id, a.sent_by, '' AS sent_by_name, a.sent_at, a.seen_at, a.done_at, COALESCE(p.display_name, p.username) AS user_name
       FROM tutorial_assignments a JOIN users p ON p.id = a.user_id
       WHERE a.organization_id = ? AND a.sent_by = ? ORDER BY a.sent_at DESC LIMIT 200`
    )
    .all(organizationId, sentBy)) as (Assignment & { user_name: string })[];
  return rows.map((r) => ({ ...shape(r), user_name: r.user_name }));
}

/** The person opened or finished a tutorial they were sent. */
export async function markAssignment(organizationId: number, userId: number, tutorialId: string, what: "seen" | "done"): Promise<void> {
  const now = new Date().toISOString();
  const col = what === "seen" ? "seen_at" : "done_at";
  await getDb()
    .prepare(`UPDATE tutorial_assignments SET ${col} = COALESCE(${col}, ?)${what === "done" ? ", seen_at = COALESCE(seen_at, ?)" : ""} WHERE organization_id = ? AND user_id = ? AND tutorial_id = ? AND done_at IS NULL`)
    .run(...(what === "done" ? [now, now] : [now]), organizationId, userId, tutorialId);
}
