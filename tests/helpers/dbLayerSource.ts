import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/** Every .ts file under a directory, depth first, in name order. */
function tsFiles(dir: string): string[] {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const p = path.join(dir, name);
      return statSync(p).isDirectory() ? tsFiles(p) : name.endsWith(".ts") ? [p] : [];
    });
}

/** The source of the database layer as ONE string: lib/db.ts (getDb), then the base schema, then
 *  everything else under lib/database/ (migration eras in order, backfills, rebuilds, seeds, types).
 *  That is the order the code ran in when it was one file, and a few guard tests depend on it (for
 *  example "the first CREATE TABLE users is the live CHECK"). They read the schema code as text,
 *  so splitting lib/db.ts must not blind them. */
export function dbLayerSource(root = process.cwd()): string {
  const dir = path.join(root, "lib", "database");
  const schema = path.join(dir, "schema.ts");
  return [path.join(root, "lib", "db.ts"), schema, ...tsFiles(dir).filter((f) => f !== schema)]
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");
}
