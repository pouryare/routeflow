// A PROPOSED day: the lane you drag orders into before it is real.
//
// The whole page's rule lives here, in two lines:
//
//   Making something new is DELIBERATE. Changing something real is INSTANT.
//
// A lane with no driver, or no date, is a draft -- private to whoever made it, and nothing
// else in the company can see it. A lane with both becomes a real run, in that company, for
// that driver, on that date, and from that moment the ordinary run machinery owns it.
//
// There is no global commit button anywhere in this module, and that is deliberate. A single
// "commit everything" control means there is something to forget, and a draft you arranged for
// twenty minutes and never committed is a draft you did not do.
//
// «پیشنهاد بده» fills EMPTY lanes only. `isEmpty` is the whole rule and it is two flags:
// the suggestion made this lane, and nobody has touched it since.

import { getDb } from "@/lib/db";
import type { Db } from "@/lib/database/client";

export interface RunDraft {
  id: number;
  organization_id: number;
  user_id: number;
  driver_user_id: number | null;
  run_date: string | null;
  created_by_suggest: number;
  manual_edits: number;
  created_at: string;
  updated_at: string;
  /** Filled in by readRunDrafts; not a column. */
  order_ids: number[];
  /** The driver's display name, joined in by readRunDrafts. Null while no driver is chosen
   *  — which is the normal state of a draft, and the reason the board has to say
   *  «بدون راننده» rather than showing a blank. */
  driver_name?: string | null;
}

export interface DraftStop {
  draft_id: number;
  order_id: number;
  seq: number;
}

const iso = () => new Date().toISOString();

/** A lane «پیشنهاد بده» is allowed to fill.
 *
 *  The suggestion made it AND nobody has touched it. The first hand-drag sets `manual_edits`
 *  and nothing clears it -- not even a later press of the button. A person who spent twenty
 *  minutes arranging a day should never find it silently replaced because they pressed
 *  "suggest" again. */
export function isEmpty(d: Pick<RunDraft, "created_by_suggest" | "manual_edits">): boolean {
  return d.created_by_suggest === 1 && d.manual_edits === 0;
}

/** Has enough been decided for this lane to become a real run? */
export function isReadyToCommit(d: Pick<RunDraft, "driver_user_id" | "run_date">): boolean {
  return d.driver_user_id != null && d.run_date != null && d.run_date !== "";
}

/** Every lane on this user's board, with their orders, in order. */
export async function readRunDrafts(
  db: Db,
  organizationId: number,
  userId: number
): Promise<RunDraft[]> {
  const drafts = await db
    .prepare(
      `SELECT * FROM run_drafts
        WHERE organization_id = ? AND user_id = ?
        ORDER BY COALESCE(run_date, '9999-12-31'), id`
    )
    .all(organizationId, userId) as unknown as RunDraft[];

  if (drafts.length === 0) return [];
  const ids = drafts.map((d) => d.id);
  const stops = await db
    .prepare(
      `SELECT draft_id, order_id, seq FROM run_draft_stops
        WHERE draft_id IN (${ids.join(",")}) ORDER BY draft_id, seq, id`
    )
    .all() as unknown as DraftStop[];

  const byDraft = new Map<number, number[]>();
  for (const s of stops) {
    const list = byDraft.get(s.draft_id) ?? [];
    list.push(s.order_id);
    byDraft.set(s.draft_id, list);
  }
  return drafts.map((d) => ({ ...d, order_ids: byDraft.get(d.id) ?? [] }));
}

/** A lane with neither a driver nor a date: it exists only on this board. */
export async function createDraft(input: {
  organizationId: number;
  userId: number;
  bySuggest?: boolean;
}): Promise<number> {
  const db = getDb();
  const now = iso();
  return Number(
    (await db
      .prepare(
        `INSERT INTO run_drafts (organization_id, user_id, created_by_suggest, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(input.organizationId, input.userId, input.bySuggest ? 1 : 0, now, now)).lastInsertRowid
  );
}

/** Add an order to a lane. Sets `manual_edits` permanently.
 *
 *  Also pulls the order out of any OTHER lane it was sitting in, because an order can only
 *  be in one place on this board -- and leaving it in two would make both lanes claim it,
 *  and whichever one committed first would silently lose the other. */
export async function addOrderToDraft(input: {
  organizationId: number;
  userId: number;
  draftId: number;
  orderId: number;
  seq?: number;
}): Promise<void> {
  const db = getDb();
  await assertOwned(input.draftId, input.organizationId, input.userId);

  await db.tx(async () => {
    await db.prepare("DELETE FROM run_draft_stops WHERE order_id = ? AND draft_id != ?").run(
      input.orderId,
      input.draftId
    );
    const next =
      input.seq ??
      Number(
        (await db
          .prepare("SELECT COALESCE(MAX(seq), -1) + 1 AS n FROM run_draft_stops WHERE draft_id = ?")
          .get(input.draftId) as { n: number }).n
      );
    await db.prepare(
      `INSERT OR IGNORE INTO run_draft_stops (draft_id, order_id, seq, created_at) VALUES (?, ?, ?, ?)`
    ).run(input.draftId, input.orderId, next, iso());
    await touch(input.draftId);
  });
}

export async function removeOrderFromDraft(input: {
  organizationId: number;
  userId: number;
  draftId: number;
  orderId: number;
}): Promise<void> {
  await assertOwned(input.draftId, input.organizationId, input.userId);
  await getDb()
    .prepare("DELETE FROM run_draft_stops WHERE draft_id = ? AND order_id = ?")
    .run(input.draftId, input.orderId);
  await touch(input.draftId);
}

/** The permanent flag. There is deliberately no un-marking it anywhere in this file. */
export async function markEdited(draftId: number): Promise<void> {
  await touch(draftId);
}

async function touch(draftId: number): Promise<void> {
  await getDb()
    .prepare(
      "UPDATE run_drafts SET manual_edits = 1, updated_at = ? WHERE id = ? AND manual_edits = 0"
    )
    .run(iso(), draftId);
}

export async function deleteDraft(input: {
  organizationId: number;
  userId: number;
  draftId: number;
}): Promise<void> {
  // Scoped by user as well as organisation: a draft is private, so deleting one is private.
  // run_draft_stops cascades.
  await getDb()
    .prepare("DELETE FROM run_drafts WHERE id = ? AND organization_id = ? AND user_id = ?")
    .run(input.draftId, input.organizationId, input.userId);
}

/** Set the driver and/or the date. Supplying both makes the lane real. */
export async function setDraftTarget(input: {
  organizationId: number;
  userId: number;
  draftId: number;
  driverUserId?: number | null;
  runDate?: string | null;
}): Promise<void> {
  const db = getDb();
  await assertOwned(input.draftId, input.organizationId, input.userId);

  const sets: string[] = ["updated_at = ?"];
  const values: (string | number | null)[] = [iso()];
  if (input.driverUserId !== undefined) {
    sets.push("driver_user_id = ?");
    values.push(input.driverUserId);
  }
  if (input.runDate !== undefined) {
    sets.push("run_date = ?");
    values.push(input.runDate);
  }
  await db.prepare(`UPDATE run_drafts SET ${sets.join(", ")} WHERE id = ?`).run(...values, input.draftId);
  // Choosing a driver or a date is a hand on the lane, so it retires it from the suggestion's
  // reach exactly like a drag does. Otherwise pressing «پیشنهاد بده» again would refill a lane
  // the manager had already decided something about.
  await touch(input.draftId);
}

/** Assert the lane is this user's. A draft is PRIVATE, so ownership is the first question,
 *  not a filter applied afterwards. */
async function assertOwned(draftId: number, organizationId: number, userId: number): Promise<void> {
  const owned = await getDb()
    .prepare("SELECT id FROM run_drafts WHERE id = ? AND organization_id = ? AND user_id = ?")
    .get(draftId, organizationId, userId);
  if (!owned) throw new Error("پیش‌نویس پیدا نشد");
}
/* --- commit: a draft becomes a real run ------------------------------------------------
 *
 * In lib/repo/ rather than the API route, because this is the whole point of the feature --
 * making something NEW is deliberate, and the transaction is what makes it all-or-nothing.
 * A route file that could write a run could not be tested without a request, and could not be
 * reused by a page or a sync.
 *
 * The run and the draft's deletion share ONE transaction. If the draft survived a failed
 * commit, the orders would be in two lanes at once: on the new van and still in the plan. */

export interface CommitInput {
  draftId: number;
  organizationId: number;
  /** Whose plan this is. The delete is scoped by it too, so a commit can never take
   *  somebody else's draft even if the id is guessed. */
  userId: number;
  driverUserId: number;
  runDate: string;
  orderIds: number[];
}

export async function commitDraft(db: Db, input: CommitInput): Promise<number> {
  const now = new Date().toISOString();
  return await db.tx(async () => {
    const runId = Number(
      (await db
        .prepare(
          `INSERT INTO delivery_runs (driver_user_id, group_id, run_date, created_by, created_at, updated_at, organization_id)
           VALUES (?, NULL, ?, ?, ?, ?, ?)`
        )
        .run(input.driverUserId, input.runDate, input.userId, now, now, input.organizationId))
        .lastInsertRowid
    );

    const addStop = db.prepare(
      `INSERT INTO delivery_stops (run_id, order_id, sort_order, status, collected_toman, created_at)
       VALUES (?, ?, ?, 'pending', 0, ?)`
    );
    for (const [i, orderId] of input.orderIds.entries()) {
      // UNIQUE (run_id, order_id) will not catch a double-booking on ANOTHER run, so the
      // change count is the check: an order already on a van must not silently join a second
      // one, and the message names it.
      const r = await addStop.run(runId, orderId, i, now);
      if (Number(r.changes) === 0) throw new Error("سفارش در مسیر دیگری ثبت شده است");
    }

    await db.prepare(
      "DELETE FROM run_drafts WHERE id = ? AND organization_id = ? AND user_id = ?"
    ).run(input.draftId, input.organizationId, input.userId);
    return runId;
  });
}
