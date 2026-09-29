import type { DatabaseSync } from "node:sqlite";
import { getDb } from "@/lib/db";
import { createOrder, addLine, submitOrder, OrderError } from "@/lib/orders";
import { advanceOrder } from "@/lib/repo/orders";
import { recordPayment, PaymentError } from "@/lib/repo/payments";
import { completeDelivery, DeliveryError } from "@/lib/delivery";
import { isOfflineOp, type OfflineOp } from "@/lib/offline/safety";
import { toServerTime } from "@/lib/offline/clock";
import type { OrderRole } from "@/lib/orderStateMachine";

export class SyncError extends Error {}

export interface IncomingMutation {
  client_uuid: string;
  op: OfflineOp;
  payload: Record<string, unknown>;
  occurred_at: string;
  clock_skew_ms: number;
  device_id?: string | null;
  depends_on?: string[];
  /** the entity's updated_at when the device last saw it, for conflict detection */
  base_version?: string | null;
}

export type MutationResult =
  | { status: "applied"; server_id: number | null }
  | { status: "duplicate"; server_id: number | null }
  | { status: "conflict"; reason: string }
  | { status: "failed"; error: string };

/** client_uuid -> the server id its mutation produced (an order id, a delivery id, …). */
type Resolved = Map<string, number>;

/** Every role an offline mutation may be authorised as.
 *
 *  This must stay exactly the `OrderRole` union. The array is the app's only
 *  bridge from a TEXT column back into the typed order machine, so an extra
 *  entry is a cast that silences tsc while admitting a role the machine cannot
 *  reason about. The retired names "salesperson" and "driver" sat here while
 *  the vocabulary migration ran; the column no longer holds either, and
 *  `OrderRole` no longer names them.
 *
 *  `satisfies` is deliberate: it fails the build if the two ever drift, which is
 *  how "salesperson" survived here in the first place — a plain annotation would
 *  have accepted the extra names without complaint. */
const ORDER_ROLES = [
  "phone_sales",
  "group_manager",
  "owner",
  "field_rep",
  "delivery_driver",
] satisfies OrderRole[];

/** The roles an offline mutation is authorised as — the person's FULL set, plus their real
 *  primary from users.role.
 *
 *  The two are different questions and the answer needs both: the SET decides what they may
 *  fire, and users.role is the actual primary (the SET is stored alphabetically, so
 *  `roles[0]` is not it — "delivery_driver" sorts before "field_rep", which is precisely the
 *  wrong answer for a driver who visits shops).
 *
 *  This is the worst place in the app to get wrong, because the driver app IS an offline
 *  client: whatever this returns is what a driver can do in a van with no network and no
 *  feedback. A role added later used to be downgraded to "phone_sales" silently -- a button
 *  that quietly does nothing. An UNRECOGNISED role is therefore refused, not defaulted.
 *
 *  It is a SET, not a single role, for the sharpest reason in Phase A: a driver who also
 *  visits shops queues `deliver` in a van, the server authorises them as `field_rep` because
 *  that is their active role, and the transition is refused. No error reaches the van, the
 *  queue drains, and the stop is simply never marked. Reading the set is what makes the
 *  offline path agree with the guard the online path uses.
 *
 *  Empty (not [primary]) when the account has no rows, because an empty set must mean
 *  "reaches nothing" — never "reaches everything". */
function rolesForOffline(
  db: DatabaseSync,
  userId: number
): { roles: OrderRole[]; primary: OrderRole } | null {
  const u = db.prepare("SELECT role FROM users WHERE id = ?").get(userId) as
    | { role: string }
    | undefined;
  if (!u) return null;
  const primary = ORDER_ROLES.find((r) => r === u.role);
  if (!primary) return null;

  const rows = db
    .prepare("SELECT role FROM user_roles WHERE user_id = ? ORDER BY role")
    .all(userId) as Array<{ role: string }>;
  const known = ORDER_ROLES as readonly string[];
  const held = rows.map((r) => r.role).filter((r): r is OrderRole => known.includes(r));

  /* An account with no set rows falls back to its primary, mirroring getSessionFromCookies,
     so the offline path and the online path can never disagree about the same person. The
     primary is always included even if the set somehow omits it. */
  const roles = held.includes(primary) ? held : [primary, ...held];
  return { roles, primary };
}

/** Topological order on `depends_on`. A cycle or a missing local dep just falls through
 *  in original order -- the per-mutation dep check then fails it cleanly. */
function toposort(muts: IncomingMutation[]): IncomingMutation[] {
  const byId = new Map(muts.map((m) => [m.client_uuid, m]));
  const done = new Set<string>();
  const out: IncomingMutation[] = [];
  const visit = (m: IncomingMutation, stack: Set<string>) => {
    if (done.has(m.client_uuid) || stack.has(m.client_uuid)) return;
    stack.add(m.client_uuid);
    for (const dep of m.depends_on ?? []) {
      const d = byId.get(dep);
      if (d) visit(d, stack);
    }
    stack.delete(m.client_uuid);
    done.add(m.client_uuid);
    out.push(m);
  };
  for (const m of muts) visit(m, new Set());
  return out;
}

/** Resolve a client_uuid reference to a server id: this batch first, then any prior
 *  applied mutation, else undefined. */
function resolveRef(
  db: DatabaseSync,
  organizationId: number,
  ref: string | undefined,
  resolved: Resolved
): number | undefined {
  if (!ref) return undefined;
  if (resolved.has(ref)) return resolved.get(ref);
  const row = db
    .prepare(
      "SELECT result_json FROM sync_mutations WHERE organization_id = ? AND client_uuid = ? AND status IN ('applied','duplicate')"
    )
    .get(organizationId, ref) as { result_json: string | null } | undefined;
  if (row?.result_json) {
    try {
      const r = JSON.parse(row.result_json) as { server_id?: number };
      if (typeof r.server_id === "number") return r.server_id;
    } catch {
      /* ignore */
    }
  }
  // last resort: the row itself carries the client_uuid
  for (const table of ["orders", "deliveries", "payments", "customers"]) {
    const hit = db
      .prepare(`SELECT id FROM ${table} WHERE client_uuid = ? AND organization_id = ?`)
      .get(ref, organizationId) as { id: number } | undefined;
    if (hit) return hit.id;
  }
  return undefined;
}

function isTerminal(status: string): boolean {
  return status === "CANCELLED" || status === "RETURNED" || status === "CLOSED";
}

function reminder(db: DatabaseSync, customerId: number, message: string): void {
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO reminders (entity_type, entity_id, due_date, message, resolved, created_at) VALUES ('customer', ?, ?, ?, 0, ?)"
  ).run(customerId, now.slice(0, 10), message, now);
}

/** Apply a batch of offline mutations idempotently. Returns a verdict per client_uuid. */
export function applyMutations(
  organizationId: number,
  userId: number,
  muts: IncomingMutation[],
  /* Who is really behind this session, when it is an impersonation.
   *
   * The driver app is an OFFLINE client, so its writes are queued in a van and land later.
   * If the impersonator is not carried across that queue, a write the founder performs in
   * the driver's browser is recorded as the driver's alone — and attribution lost in a
   * queue is attribution lost for good. Passed in rather than looked up, because the
   * session already resolved it and this module has no cookie. */
  actorId?: number
): Record<string, MutationResult> {
  const db = getDb();
  const auth = rolesForOffline(db, userId);
  /* No recognisable role is "reaches nothing", never "reaches everything" -- the same rule
     groupFilter follows. Defaulting here would be the exact bug this function used to have. */
  if (auth === null) {
    return Object.fromEntries(
      muts.map((m) => [m.client_uuid, { status: "failed", error: "نقش کاربر مشخص نیست" } as MutationResult]),
    );
  }
  const resolved: Resolved = new Map();
  const out: Record<string, MutationResult> = {};
  const now = () => new Date().toISOString();

  for (const mut of toposort(muts)) {
    const cu = mut.client_uuid;

    // Idempotency: a client_uuid already decided is returned as its stored verdict.
    const prior = db
      .prepare(
        "SELECT status, result_json FROM sync_mutations WHERE organization_id = ? AND client_uuid = ?"
      )
      .get(organizationId, cu) as { status: string; result_json: string | null } | undefined;
    if (prior && (prior.status === "applied" || prior.status === "duplicate")) {
      let sid: number | null = null;
      try {
        sid = prior.result_json ? (JSON.parse(prior.result_json).server_id ?? null) : null;
      } catch {
        /* ignore */
      }
      if (sid !== null) resolved.set(cu, sid);
      out[cu] = { status: "duplicate", server_id: sid };
      continue;
    }

    // Record receipt (or reset a prior failed/conflict row for a retry).
    db.prepare(
      `INSERT INTO sync_mutations
         (organization_id, client_uuid, user_id, device_id, op, payload_json, occurred_at,
          clock_skew_ms, received_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'received')
       ON CONFLICT (organization_id, client_uuid) DO UPDATE SET
         status = 'received', result_json = NULL, error = NULL, received_at = excluded.received_at`
    ).run(
      organizationId,
      cu,
      userId,
      mut.device_id ?? null,
      mut.op,
      JSON.stringify(mut.payload),
      mut.occurred_at,
      mut.clock_skew_ms,
      now()
    );

    let result: MutationResult;
    try {
      result = applyOne(db, organizationId, userId, auth.roles, auth.primary, mut, resolved, actorId);
    } catch (e) {
      result =
        e instanceof OrderError || e instanceof PaymentError || e instanceof DeliveryError
          ? { status: "failed", error: e.message }
          : { status: "failed", error: e instanceof Error ? e.message : "خطای ناشناخته" };
    }

    if (result.status === "applied" && result.server_id !== null) {
      resolved.set(cu, result.server_id);
    }
    db.prepare(
      `UPDATE sync_mutations SET status = ?, applied_at = ?, result_json = ?, error = ?
        WHERE organization_id = ? AND client_uuid = ?`
    ).run(
      result.status,
      result.status === "applied" ? now() : null,
      JSON.stringify(result),
      result.status === "failed"
        ? result.error
        : result.status === "conflict"
          ? result.reason
          : null,
      organizationId,
      cu
    );
    out[cu] = result;
  }

  return out;
}

function applyOne(
  db: DatabaseSync,
  organizationId: number,
  userId: number,
  roles: readonly OrderRole[],
  primary: OrderRole,
  mut: IncomingMutation,
  resolved: Resolved,
  actorId?: number
): MutationResult {
  if (!isOfflineOp(mut.op)) return { status: "failed", error: "کنش ناشناخته" };
  const p = mut.payload;
  const deviceTime = () => toServerTime(mut.occurred_at, mut.clock_skew_ms);

  switch (mut.op) {
    case "order.draftCreate": {
      const res = createOrder(db, {
        customer_id: Number(p.customer_id),
        order_date: String(p.order_date ?? deviceTime()),
        created_by: userId,
        organization_id: organizationId,
        salesperson_user_id: (p.salesperson_user_id as number | null) ?? null,
        notes: (p.notes as string | null) ?? null,
        client_uuid: mut.client_uuid,
        lines: (p.lines as never[]) ?? [],
      });
      return { status: "applied", server_id: res.id };
    }

    case "order.draftEdit": {
      const orderId = resolveRef(db, organizationId, p.order_ref as string, resolved);
      if (orderId === undefined) return { status: "failed", error: "سفارش وابسته هنوز اعمال نشده" };
      addLine(db, orderId, p.line as never);
      return { status: "applied", server_id: orderId };
    }

    case "order.submit": {
      const orderId =
        resolveRef(db, organizationId, p.order_ref as string, resolved) ??
        (p.order_id as number | undefined);
      if (orderId === undefined) return { status: "failed", error: "سفارش وابسته هنوز اعمال نشده" };
      const before = db
        .prepare("SELECT status FROM orders WHERE id = ? AND organization_id = ?")
        .get(orderId, organizationId) as { status: string } | undefined;
      if (!before) return { status: "failed", error: "سفارش پیدا نشد" };
      if (isTerminal(before.status)) return { status: "conflict", reason: "سفارش پیش‌تر بسته شده بود" };
      submitOrder(organizationId, orderId, { id: userId, role: primary, roles, actorId });
      return { status: "applied", server_id: orderId };
    }

    case "delivery.start": {
      const orderId =
        resolveRef(db, organizationId, p.order_ref as string, resolved) ??
        (p.order_id as number | undefined);
      if (orderId === undefined) return { status: "failed", error: "سفارش پیدا نشد" };
      advanceOrder(organizationId, orderId, "startRoute", { id: userId, role: primary, roles, actorId });
      return { status: "applied", server_id: orderId };
    }

    case "delivery.complete": {
      const deliveryId =
        resolveRef(db, organizationId, p.delivery_ref as string, resolved) ??
        (p.delivery_id as number | undefined);
      if (deliveryId === undefined) return { status: "failed", error: "تحویل پیدا نشد" };
      const link = db
        .prepare(
          "SELECT d.order_id, o.status, o.customer_id FROM deliveries d JOIN orders o ON o.id = d.order_id WHERE d.id = ? AND d.organization_id = ?"
        )
        .get(deliveryId, organizationId) as
        | { order_id: number; status: string; customer_id: number }
        | undefined;
      if (!link) return { status: "failed", error: "تحویل پیدا نشد" };
      if (isTerminal(link.status)) {
        reminder(
          db,
          link.customer_id,
          `تحویل آفلاین برای سفارش ${link.order_id} که سرور آن را بسته بود — بررسی کنید`
        );
        return { status: "conflict", reason: "سفارش روی سرور بسته یا لغو شده بود" };
      }
      completeDelivery(organizationId, deliveryId, { id: userId }, {
        outcome: (p.outcome as "delivered" | "partial" | "failed") ?? "delivered",
        lines: (p.lines as never[]) ?? undefined,
        fail_reason_id: (p.fail_reason_id as number | null) ?? null,
        receiver_name: (p.receiver_name as string | null) ?? null,
        gps_lat: (p.gps_lat as number | null) ?? null,
        gps_lng: (p.gps_lng as number | null) ?? null,
        collected_toman: (p.collected_toman as number | undefined) ?? 0,
        device_time: deviceTime(),
        notes: (p.notes as string | null) ?? null,
      });
      return { status: "applied", server_id: deliveryId };
    }

    case "payment.record": {
      const orderRef = resolveRef(db, organizationId, p.order_ref as string, resolved);
      const allocations = (p.allocations as { order_id: number | null; amount_toman: number }[] | undefined)?.map(
        (a) => ({
          order_id: a.order_id === null ? null : (orderRef ?? a.order_id),
          amount_toman: a.amount_toman,
        })
      );
      const id = recordPayment(organizationId, {
        customer_id: Number(p.customer_id),
        amount_toman: Number(p.amount_toman),
        method: (p.method as never) ?? "CASH",
        received_at: String(p.received_at ?? deviceTime()),
        received_by: userId,
        delivery_stop_id: (p.delivery_stop_id as number | null) ?? null,
        note: (p.note as string | null) ?? null,
        client_uuid: mut.client_uuid,
        allocations,
        allow_overpay: p.allow_overpay === true,
      });
      return { status: "applied", server_id: id };
    }

    case "customer.capture": {
      const now = new Date().toISOString();
      const id = Number(
        db
          .prepare(
            `INSERT INTO customers (customer_code, business_name, contact_person, phone, address,
                                    lat, lng, lifecycle, client_uuid, synced_at, group_id, organization_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'lead', ?, ?, ?, ?)`
          )
          .run(
            `OFF-${mut.client_uuid.slice(0, 8)}`,
            String(p.business_name ?? "مشتری تازه"),
            (p.contact_person as string | null) ?? null,
            (p.phone as string | null) ?? null,
            (p.address as string | null) ?? null,
            (p.lat as number | null) ?? null,
            (p.lng as number | null) ?? null,
            mut.client_uuid,
            now,
            (p.group_id as number | null) ?? null,
            organizationId
          ).lastInsertRowid
      );
      return { status: "applied", server_id: id };
    }

    // claims never reach the outbox; if one is smuggled in, refuse it here too.
    case "order.approve":
    case "order.plan":
    case "order.freeze":
    case "credit.decide":
      return { status: "failed", error: "این کنش آفلاین اعمال نمی‌شود" };
  }
}
