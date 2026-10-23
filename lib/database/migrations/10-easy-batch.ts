/* Migration era 10: the 2026-10-23 easy batch (docs/roadmap.md section 1).
 *
 * - tasks.snooze_count (F142): how many times an open task was put off, so a task cannot be
 *   pushed off forever (lib/taskSnooze.ts caps it). */
import type { DatabaseSync } from "node:sqlite";

function addColumn(db: DatabaseSync, table: string, column: string, definition: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (cols.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

export function applyEasyBatch(db: DatabaseSync): void {
  addColumn(db, "tasks", "snooze_count", "INTEGER NOT NULL DEFAULT 0");
}
