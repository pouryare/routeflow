import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/** The source of the database layer as ONE string: lib/db.ts (getDb) followed by every file in
 *  lib/database/ (seeds, backfills, rebuilds, types), in name order. A few guard tests read the
 *  schema code as text; splitting lib/db.ts into lib/database/ must not blind them. */
export function dbLayerSource(root = process.cwd()): string {
  const dir = path.join(root, "lib", "database");
  const parts = readdirSync(dir).filter((f) => f.endsWith(".ts")).sort();
  return [readFileSync(path.join(root, "lib", "db.ts"), "utf8"), ...parts.map((f) => readFileSync(path.join(dir, f), "utf8"))].join("\n");
}
