import type { DatabaseSync } from "node:sqlite";
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
}

/** Append one fact to the bus, then drive the rule engine against it best-effort.
 *  Returns the event id. A rule-engine failure is logged and swallowed -- the fact is
 *  already recorded -- so the id is always a real, inserted row. */
export function emitEvent(organizationId: number, input: EventInput, db?: DatabaseSync): number {
  const now = new Date().toISOString();
  const id = Number(
    (db ?? getDb())
      .prepare(
        `INSERT INTO events
           (organization_id, kind, entity_type, entity_id, actor_user_id, impersonated_by,
            metadata_json, occurred_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      ).lastInsertRowid
  );
  try {
    const row = (db ?? getDb())
      .prepare("SELECT * FROM events WHERE id = ?")
      .get(id) as unknown as EventRow;
    runEventRules(organizationId, row, db);
  } catch (e) {
    /* generation is best-effort; the fact is already recorded */
    console.warn("[rules] event rule run failed", e);
  }
  return id;
}

/** Same, but never throws -- for emitters wired into a host flow that must not break. */
export function tryEmitEvent(organizationId: number, input: EventInput, db?: DatabaseSync): void {
  try {
    emitEvent(organizationId, input, db);
  } catch {
    /* the bus is best-effort; the host flow already committed its real work */
  }
}

export function recentEvents(
  organizationId: number,
  filter: { kind?: string; since?: string; limit?: number } = {}
): EventRow[] {
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
  return getDb()
    .prepare(
      `SELECT * FROM events WHERE ${clauses.join(" AND ")} ORDER BY occurred_at DESC, id DESC LIMIT ?`
    )
    .all(...(params as never[])) as unknown as EventRow[];
}
