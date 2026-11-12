import type { Db } from "@/lib/database/client";
import { getDb } from "@/lib/db";
import { runEventRules } from "./rules";

export interface EventInput {
  kind: string;
  entity_type?: string | null;
  entity_id?: number | null;
  actor_user_id?: number | null;
  /** Who was really driving, when this happened under Login-As. NULL by default, so no
   *  existing call site has to change. */
  impersonated_by?: number | null;
  metadata?: Record<string, unknown> | null;
  occurred_at?: string;
}

export interface EventRow {
  id: number;
  organization_id: number;
  kind: string;
  entity_type: string | null;
  entity_id: number | null;
  actor_user_id: number | null;
  metadata_json: string | null;
  occurred_at: string;
  created_at: string;
  pending: boolean;
  attempts: number;
  next_try_at: string | null;
  last_error: string | null;
}

/** A reaction that keeps failing is tried this many times, then left for a person (the status card). */
export const MAX_EVENT_ATTEMPTS = 6;

/** Append one fact to the bus and run the rule engine against it. Returns the event id.
 *
 *  The event is saved `pending`, the reaction runs, and only then is it marked handled. Called inside a
 *  transaction (the usual case: every statement under `db.tx` joins it) the event and the change it
 *  describes commit together, or neither exists. A reaction that fails is not lost: the event stays
 *  pending with `attempts`, `last_error` and a back-off `next_try_at`, and `drainEvents` runs it again.
 *  The caller's flow is never broken by a rule failure. */
export async function emitEvent(organizationId: number, input: EventInput, db?: Db): Promise<number> {
  const d = db ?? getDb();
  const now = new Date().toISOString();
  const id = Number(
    (await d
      .prepare(
        `INSERT INTO events
           (organization_id, kind, entity_type, entity_id, actor_user_id, impersonated_by,
            metadata_json, occurred_at, created_at, pending)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE)`
      )
      .run(
        organizationId,
        input.kind,
        input.entity_type ?? null,
        input.entity_id ?? null,
        input.actor_user_id ?? null,
        /* Who was really driving, when this happened under Login-As. NULL by default. */
        input.impersonated_by ?? null,
        input.metadata ? JSON.stringify(input.metadata) : null,
        input.occurred_at ?? now,
        now
      )).lastInsertRowid
  );
  await react(organizationId, id, d);
  return id;
}

/** Runs the rules for one saved event and records the outcome on it. Never throws. */
async function react(organizationId: number, id: number, d: Db): Promise<boolean> {
  try {
    const row = (await d.prepare("SELECT * FROM events WHERE id = ?").get(id)) as unknown as EventRow;
    await runEventRules(organizationId, row, d);
    await d.prepare("UPDATE events SET pending = FALSE, last_error = NULL, next_try_at = NULL WHERE id = ?").run(id);
    return true;
  } catch (e) {
    console.warn("[rules] event rule run failed", e);
    try {
      const attempts = Number(
        ((await d.prepare("SELECT attempts FROM events WHERE id = ?").get(id)) as { attempts: number } | undefined)?.attempts ?? 0
      ) + 1;
      /* One minute, two, four ... capped at an hour. */
      const next = new Date(Date.now() + Math.min(2 ** (attempts - 1), 60) * 60_000).toISOString();
      await d
        .prepare("UPDATE events SET attempts = ?, last_error = ?, next_try_at = ? WHERE id = ?")
        .run(attempts, String(e instanceof Error ? e.message : e).slice(0, 500), next, id);
    } catch {
      /* the event stays pending; the next drain tries it again */
    }
    return false;
  }
}

/** Runs the reactions of events that are still pending: a rule failed, or the process died between the
 *  save and the reaction. Claims rows with SKIP LOCKED, so two callers (the sweep, the worker) never run
 *  the same event twice. Returns how many were handled. Rules are safe to run again: a rule that
 *  already fired for an entity is found by `liveRun` and skipped. */
export async function drainEvents(organizationId: number, limit = 100): Promise<number> {
  const db = getDb();
  const now = new Date().toISOString();
  return await db.tx(async () => {
    const rows = (await db
      .prepare(
        `SELECT id FROM events
          WHERE organization_id = ? AND pending AND attempts < ? AND (next_try_at IS NULL OR next_try_at <= ?)
          ORDER BY id LIMIT ? FOR UPDATE SKIP LOCKED`
      )
      .all(organizationId, MAX_EVENT_ATTEMPTS, now, limit)) as { id: number }[];
    let done = 0;
    for (const r of rows) if (await react(organizationId, Number(r.id), db)) done += 1;
    return done;
  });
}

/** Events whose reaction has not run yet, and the oldest of them: the numbers the status card shows. */
export async function pendingEventStats(organizationId: number): Promise<{ pending: number; failed: number; oldest: string | null }> {
  const r = (await getDb()
    .prepare(
      `SELECT COUNT(*) AS pending, COUNT(*) FILTER (WHERE attempts >= ?) AS failed, MIN(created_at) AS oldest
         FROM events WHERE organization_id = ? AND pending`
    )
    .get(MAX_EVENT_ATTEMPTS, organizationId)) as { pending: number; failed: number; oldest: string | null };
  return { pending: Number(r.pending), failed: Number(r.failed), oldest: r.oldest };
}

/** Same, but never throws -- for emitters wired into a host flow that must not break. */
export async function tryEmitEvent(organizationId: number, input: EventInput, db?: Db): Promise<void> {
  try {
    await emitEvent(organizationId, input, db);
  } catch {
    /* the bus is best-effort; the host flow already committed its real work */
  }
}

export async function recentEvents(
  organizationId: number,
  filter: { kind?: string; since?: string; limit?: number } = {}
): Promise<EventRow[]> {
  const clauses = ["organization_id = ?"];
  const params: unknown[] = [organizationId];
  if (filter.kind) {
    clauses.push("kind = ?");
    params.push(filter.kind);
  }
  if (filter.since) {
    clauses.push("occurred_at > ?");
    params.push(filter.since);
  }
  params.push(filter.limit ?? 100);
  return await getDb()
    .prepare(
      `SELECT * FROM events WHERE ${clauses.join(" AND ")} ORDER BY occurred_at DESC, id DESC LIMIT ?`
    )
    .all(...(params as never[])) as unknown as EventRow[];
}
