import fs from "node:fs/promises";
import path from "node:path";
import type { ListedObject, StorageDriver } from "./driver";
import { PHOTOS_DIR } from "@/lib/photos";
import { AVATAR_DIR } from "@/lib/avatarStore";

/** The «دیسک سرور» storage (decision 20): development, demo and tests only. Production cannot
 *  pick it, so a company there always brings its own S3. */
export function devStorageAllowed(): boolean {
  return process.env.ROUTEFLOW_DEV_STORAGE === "1" || process.env.NODE_ENV === "test" || process.env.NODE_ENV === "development";
}

/** shortcut: the dev disk keeps the old flat layout (data/photos/<stem>.<ext>, avatars beside it)
 *  so the demo files and the existing tests keep working; a real S3 storage uses the folder keys.
 *  Upgrade if the dev disk ever needs the same layout as S3. */
function legacyPath(key: string): string {
  const base = path.basename(key);
  if (!/^[A-Za-z0-9_.-]{1,80}$/.test(base) || base.startsWith(".")) throw new Error("نام فایل نامعتبر است");
  return path.join(key.includes("/avatars/") ? AVATAR_DIR : PHOTOS_DIR, base);
}

async function* walk(dir: string, root: string): AsyncIterable<ListedObject> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(full, root);
    else if (e.isFile()) yield { key: path.relative(root, full), bytes: (await fs.stat(full)).size };
  }
}

export function localDriver(): StorageDriver {
  return {
    async put(key, body) {
      const p = legacyPath(key);
      await fs.mkdir(path.dirname(p), { recursive: true });
      await fs.writeFile(p, body);
    },
    async get(key) {
      try {
        return await fs.readFile(legacyPath(key));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw e;
      }
    },
    async head(key) {
      try {
        return (await fs.stat(legacyPath(key))).size;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw e;
      }
    },
    async remove(key) {
      await fs.rm(legacyPath(key), { force: true });
    },
    async *list() {
      // Flat layout: every file under the photos folder (avatars included).
      yield* walk(PHOTOS_DIR, PHOTOS_DIR);
    },
  };
}
