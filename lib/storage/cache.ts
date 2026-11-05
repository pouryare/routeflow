import fs from "node:fs/promises";
import path from "node:path";

/** The app server's read-through cache of company files (decision 8): kept 7 days after the last
 *  read. Files never change (a new upload gets a new stem), so nothing needs invalidating except a
 *  purge. Each container keeps its own; losing it costs one fetch from the bucket. */
const CACHE_DIR = process.env.ROUTEFLOW_FILE_CACHE_DIR ?? path.join(process.cwd(), "data", "cache", "files");
const CACHE_DAYS = 7;

const name = (stem: string, ext: string) => path.join(CACHE_DIR, `${stem}.${ext}`);

export async function cacheGet(stem: string, ext: string): Promise<Buffer | null> {
  try {
    const p = name(stem, ext);
    const bytes = await fs.readFile(p);
    const t = new Date();
    await fs.utimes(p, t, t).catch(() => {}); // the last read starts the 7 days again
    return bytes;
  } catch {
    return null;
  }
}

export async function cachePut(stem: string, ext: string, body: Buffer): Promise<void> {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    const p = name(stem, ext);
    const tmp = `${p}.${process.pid}.tmp`;
    await fs.writeFile(tmp, body);
    await fs.rename(tmp, p);
  } catch {
    /* a cache that cannot write is a slower read, not a failed one */
  }
}

export async function cacheDrop(stem: string, exts: string[]): Promise<void> {
  await Promise.all(exts.map((e) => fs.rm(name(stem, e), { force: true }).catch(() => {})));
}

/** Removes files not read for CACHE_DAYS; returns how many. */
export async function cacheEvict(days = CACHE_DAYS): Promise<number> {
  const cutoff = Date.now() - days * 86_400_000;
  let n = 0;
  let entries: string[];
  try {
    entries = await fs.readdir(CACHE_DIR);
  } catch {
    return 0;
  }
  for (const f of entries) {
    const p = path.join(CACHE_DIR, f);
    try {
      if ((await fs.stat(p)).mtimeMs < cutoff) {
        await fs.rm(p, { force: true });
        n++;
      }
    } catch {
      /* gone already */
    }
  }
  return n;
}
