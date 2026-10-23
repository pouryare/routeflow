// The detached worker that decodes a bulk import.
//
// Started by the parse route and never awaited by it: the request creates a job row and
// returns in milliseconds, while this loop resolves links in the background and writes
// each result as it lands. That inversion is the whole feature -- before it, one request
// tried to resolve a thousand links before returning a byte, and simply timed out.
//
// One job at a time, on purpose. lib/resolveMapsLink.ts already serialises Nominatim
// behind a single shared 1 req/sec gate, so two concurrent jobs would not go twice as
// fast; they would contend for the same budget and both crawl. A second paste waits its
// turn and says so.
//
// Restart-safe: every finished item is already in the database, and a job left `running`
// with no live worker is picked up again from its `pending` rows without redoing work.
//
// Never throws. resolveMapsLink is contractually unable to throw (a bad link comes back
// `unresolved`), and everything here is wrapped so one poisoned link cannot end a run
// that is nine hundred links from finished.

import { resolveMapsLink } from "@/lib/resolveMapsLink";
import { browserLifecycle } from "@/lib/playwrightExtract";
import { placeNameFromAddress } from "@/lib/geoLinks";
import type { DuplicatePool } from "@/lib/duplicateDetection";
import { nextItem } from "@/lib/leadImport/scheduler";
import { decideItem } from "@/lib/leadImport/dedupe";
import * as repo from "@/lib/repo/leadImport";
import type { LocationResolution } from "@/lib/db";

/** How many links are settled at once. Matches resolveMapsLinks' own default. */
export const CONCURRENCY = 4;

const UNNAMED_LOCATION = "مکان بدون نام";

/** One job in flight. Module-level so a second call joins rather than doubles up. */
let activeJobId: number | null = null;

export function isRunning(): boolean {
  return activeJobId !== null;
}

export function currentJobId(): number | null {
  return activeJobId;
}

/** Kicks the worker without waiting for it. Safe to call when a job is already running:
 *  the second paste is left `running` in the database and picked up when the first ends. */
export function startJob(organizationId: number, jobId: number): void {
  void runJob(organizationId, jobId).catch((err) => {
    console.error("[lead-import] job failed", { organizationId, jobId, err });
  });
}

async function runJob(organizationId: number, jobId: number): Promise<void> {
  if (activeJobId !== null) return; // something else owns the worker; it will pick this up
  activeJobId = jobId;
  try {
    // One browser for the whole job, the same way resolveMapsLinks shares one across a
    // batch. Launching Chromium per link would add seconds to every item that needs it.
    // Owned here rather than inside drainJob so a test can drain with a stub resolver
    // and never launch a browser at all.
    await browserLifecycle.getBrowser();
    await drainJob(organizationId, jobId);
  } finally {
    activeJobId = null;
    await browserLifecycle.closeBrowser().catch(() => {});
    // A paste that arrived while this job ran is still marked running. Take it now.
    const next = await repo.nextQueuedJob(organizationId);
    if (next && next.id !== jobId) startJob(organizationId, next.id);
  }
}

/** Turns one pasted URL into coordinates. The real implementation does the four-step
 *  network cascade; a test supplies a stub, which is why the drain loop below can be
 *  exercised without a network, a browser, or a clock. */
export type LinkResolver = (url: string, name: string) => Promise<ResolvedLink>;

/** What a resolver hands back. Structurally the shape resolveMapsLink already returns. */
export interface ResolvedLink {
  lat: number | null;
  lng: number | null;
  address: string | null;
  resolvedUrl: string;
  resolution: LocationResolution;
}

/** Drains one job to completion. Exported for tests, which pass a stub resolver; the
 *  production path reaches it through startJob with the real cascade. */
export async function drainJob(
  organizationId: number,
  jobId: number,
  resolve: LinkResolver = resolveMapsLink
): Promise<void> {
  const pool = await repo.loadDuplicatePool(organizationId);

  try {
    for (;;) {
      if (await repo.isCancelled(organizationId, jobId)) return;

      const pending = await repo.pendingItems(organizationId, jobId);
      if (pending.length === 0) break;

      // Cheapest tier first -- see lib/leadImport/scheduler.ts for why this is the
      // feature rather than an optimisation. Re-read pending each round: a previous
      // batch in this same tick may have consumed the cheapest items.
      const batch: repo.ImportItemRow[] = [];
      for (let i = 0; i < CONCURRENCY; i++) {
        const pick = nextItem(await repo.pendingItems(organizationId, jobId));
        if (!pick) break;
        await repo.markResolving(organizationId, pick.id);
        batch.push(pick);
      }
      if (batch.length === 0) break;

      await Promise.all(batch.map((item) => resolveOne(organizationId, item, pool, resolve)));

      await repo.refreshCounters(organizationId, jobId);
    }

    await autoAddAll(organizationId, jobId);
    await repo.refreshCounters(organizationId, jobId);
    if (!await repo.isCancelled(organizationId, jobId)) await repo.finishJob(organizationId, jobId, "done");
  } catch (err) {
    console.error("[lead-import] drain failed", { organizationId, jobId, err });
    if (!await repo.isCancelled(organizationId, jobId)) await repo.finishJob(organizationId, jobId, "cancelled");
  }
}

async function resolveOne(
  organizationId: number,
  item: repo.ImportItemRow,
  pool: DuplicatePool[],
  resolve: LinkResolver
): Promise<void> {
  try {
    const r = await resolve(item.maps_url, item.name);
    const name =
      item.name || (r.address ? placeNameFromAddress(r.address) : null) || UNNAMED_LOCATION;

    const verdict = decideItem({
      name,
      address: r.address ?? null,
      lat: r.lat,
      lng: r.lng,
      resolution: r.resolution,
      pool,
    });

    await repo.markResolved(organizationId, item.id, {
      lat: r.lat,
      lng: r.lng,
      address: r.address,
      resolvedUrl: r.resolvedUrl,
      resolution: r.resolution,
      status: verdict.verdict === "add" ? "done" : verdict.verdict,
      duplicateOf: verdict.duplicateOf,
      duplicateName: verdict.duplicateName,
    });
  } catch (err) {
    // resolveMapsLink should never throw, but a Chromium crash or a malformed URL that
    // slips past its guards must not take the other 999 links down with it.
    console.error("[lead-import] item failed", { itemId: item.id, err });
    await repo.markResolved(organizationId, item.id, {
      lat: null,
      lng: null,
      address: null,
      resolvedUrl: item.maps_url,
      resolution: "unresolved",
      status: "unresolved",
    });
  }
}

/** Saves everything the dedupe pass cleared for auto-add. */
async function autoAddAll(organizationId: number, jobId: number): Promise<void> {
  const items = (await repo
    .listItems(organizationId, jobId))
    .filter((i) => i.status === "done" && i.saved_location_id === null);
  const groupId = (await repo.getJob(organizationId, jobId))?.group_id ?? null;
  await repo.autoAddItems(organizationId, items, groupId);
}

/** The boot sweep: requeues work a restart orphaned. Called from instrumentation.ts. */
export async function resumeOrphanedJobs(): Promise<void> {
  for (const job of await repo.orphanedJobs()) {
    startJob(job.organization_id, job.id);
  }
}

