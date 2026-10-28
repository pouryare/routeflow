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

/** The source of the database layer as ONE string: lib/db.ts, then everything under lib/database/.
 *  Guard tests read it as text. */
export function dbLayerSource(root = process.cwd()): string {
  const dir = path.join(root, "lib", "database");
  return [path.join(root, "lib", "db.ts"), ...tsFiles(dir)].map((f) => readFileSync(f, "utf8")).join("\n");
}
