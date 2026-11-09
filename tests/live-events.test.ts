import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import path from "node:path";
import pg from "pg";

/* Live updates (issue #58) against the real database: commit order, audience, the notification
 * trigger, pruning, presence, the kick, and the hub that sends it all to open streams. */

process.env.ROUTEFLOW_DB_PATH = path.join(os.tmpdir(), `rf-live-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);

const { getDb } = await import("@/lib/db");
const { databaseUrl } = await import("@/lib/database/connection");
const live = await import("@/lib/repo/live");
const { liveHub } = await import("@/lib/live/hub");
const { canSeeRecord } = await import("@/lib/live/visibility");
type Sink = Parameters<typeof liveHub.add>[0];

const NOW = "2026-01-01T00:00:00.000Z";
let reza = 0;
let sara = 0;
let other = 0; // a person in the second company

async function user(name: string, role: string, org: number): Promise<number> {
  return Number(
    (await getDb()
      .prepare("INSERT INTO users (username, password_hash, display_name, role, organization_id, created_at) VALUES (?, 'x:y', ?, ?, ?, ?)")
      .run(name, name, role, org, NOW)).lastInsertRowid
  );
}

/** A plain connection as the tables' owner, for holding a transaction open by hand. */
async function rawClient(): Promise<pg.Client> {
  const c = new pg.Client({ connectionString: await databaseUrl() });
  await c.connect();
  return c;
}

beforeAll(async () => {
  await getDb().prepare("INSERT INTO organizations (id, name, slug, created_at) VALUES (2, 'Org B', 'org-b', ?) ON CONFLICT DO NOTHING").run(NOW);
  reza = await user("reza", "delivery_driver", 1);
  sara = await user("sara", "phone_sales", 1);
  other = await user("other", "owner", 2);
});

afterAll(async () => {
  await liveHub.stop();
});

const who = (userId: number, roles: string[], organizationId = 1) => ({ userId, organizationId, roles: roles as never });

describe("the event log", () => {
  it("keeps each event to its company and audience", async () => {
    const all = await live.publishLive(1, { topic: "orders", data: { id: 1042 } });
    const onlySara = await live.publishLive(1, { topic: "orders", users: [sara] });
    const drivers = await live.publishLive(1, { topic: "runs", roles: ["delivery_driver"] });
    const otherCo = await live.publishLive(2, { topic: "orders" });
    const ids = (rows: { id: number }[]) => rows.map((r) => r.id);

    expect(ids(await live.eventsAfter(who(sara, ["phone_sales"]), all - 1))).toEqual([all, onlySara]);
    expect(ids(await live.eventsAfter(who(reza, ["delivery_driver"]), all - 1))).toEqual([all, drivers]);
    expect(ids(await live.eventsAfter(who(other, ["owner"], 2), all - 1))).toEqual([otherCo]);
    const [first] = await live.eventsAfter(who(sara, ["phone_sales"]), all - 1);
    expect(first.data_json).toBe('{"id":1042}');
    expect(first.audience_users).toBeNull();
    const [, second] = await live.eventsAfter(who(sara, ["phone_sales"]), all - 1);
    expect(second.audience_users).toEqual([sara]); // numbers, not the driver's strings
  });

  it("refuses a bad topic, a bad audience value and oversized data", async () => {
    await expect(live.publishLive(1, { topic: "Bad Topic" })).rejects.toThrow(/topic/);
    await expect(live.publishLive(1, { topic: "x", roles: ["owner'}"] })).rejects.toThrow(/audience/);
    await expect(live.publishLive(1, { topic: "x", data: "a".repeat(5000) })).rejects.toThrow(/send an id/);
  });

  it("numbers events in the order their transactions commit", async () => {
    const a = await rawClient();
    const b = await rawClient();
    try {
      await a.query("BEGIN");
      const idA = Number((await a.query("SELECT rf_live_publish(1, 'order', NULL, NULL, NULL) AS id")).rows[0].id);
      await b.query("BEGIN");
      let bDone = false;
      const pending = b.query("SELECT rf_live_publish(1, 'order', NULL, NULL, NULL) AS id").then((r) => {
        bDone = true;
        return Number(r.rows[0].id);
      });
      await new Promise((r) => setTimeout(r, 300));
      expect(bDone).toBe(false); // waits for A to commit before it takes an id
      await a.query("COMMIT");
      const idB = await pending;
      await b.query("COMMIT");
      expect(idB).toBeGreaterThan(idA);
    } finally {
      await a.end();
      await b.end();
    }
  });

  it("publishes a new notification to its person's bell, whichever code wrote it", async () => {
    const before = (await live.eventBounds(1)).newest ?? 0;
    await getDb()
      .prepare(
        `INSERT INTO notifications (organization_id, user_id, type_code, title_fa, group_key, priority, created_at)
         VALUES (1, ?, 't', 'سفارش تازه', 'g', 'normal', ?)`
      )
      .run(sara, NOW);
    const forSara = await live.eventsAfter(who(sara, ["phone_sales"]), before);
    expect(forSara.map((e) => [e.topic, e.audience_users])).toEqual([["notifications", [sara]]]);
    expect(await live.eventsAfter(who(reza, ["delivery_driver"]), before)).toEqual([]);
  });

  it("prunes old events but keeps the newest, so the bounds still say where the log got to", async () => {
    await getDb().prepare("UPDATE live_events SET created_at = now() - interval '8 days'").run();
    const { newest } = await live.eventBounds(1);
    expect(await live.pruneEvents(7)).toBeGreaterThan(0);
    expect(await live.eventBounds(1)).toEqual({ oldest: newest, newest });
    expect(await live.eventBounds(2)).toEqual({ oldest: null, newest: null }); // its only event was older
    expect(await live.newestEventId()).toBe(newest);
  });
});

describe("live record changes (L1)", () => {
  it("publishes each changed order with its status, naming the record, and a bulk change as one event", async () => {
    const before = (await live.eventBounds(1)).newest ?? 0;
    const customer = Number(
      (await getDb()
        .prepare("INSERT INTO customers (customer_code, business_name, synced_at, organization_id) VALUES ('L1', 'فروشگاه', ?, 1)")
        .run(NOW)).lastInsertRowid
    );
    const order = Number(
      (await getDb()
        .prepare(
          `INSERT INTO orders (order_no, customer_id, order_date, created_by, created_at, updated_at, organization_id, salesperson_user_id)
           VALUES ('S-1', ?, '2026-01-01', ?, ?, ?, 1, ?)`
        )
        .run(customer, sara, NOW, NOW, sara)).lastInsertRowid
    );
    await getDb().prepare("UPDATE orders SET status = 'CONFIRMED' WHERE id = ?").run(order);
    const owner = who(sara, ["owner"]);
    const evs = (await live.eventsAfter(owner, before)).filter((e) => e.topic === "orders");
    expect(evs.map((e) => [e.entity_type, e.entity_id, JSON.parse(e.data_json ?? "{}").status])).toEqual([
      ["order", order, "DRAFT"],
      ["order", order, "CONFIRMED"],
    ]);
    const customerEvs = (await live.eventsAfter(owner, before)).filter((e) => e.topic === "customers");
    expect(customerEvs.map((e) => e.entity_id)).toEqual([customer]);

    // The check is the orders list's own filter: Sara sold it, so she sees it; Reza has no run with it.
    const session = (id: number, role: string) =>
      ({ user: { id }, role, roles: [role], groupId: null, organizationId: 1, hasRole: (r: string) => r === role }) as never;
    expect(await canSeeRecord(session(sara, "phone_sales"), "order", order)).toBe(true);
    expect(await canSeeRecord(session(reza, "delivery_driver"), "order", order)).toBe(false);
    expect(await canSeeRecord(session(other, "owner"), "order", order)).toBe(true);
    expect(await canSeeRecord(session(sara, "phone_sales"), "invoice", order)).toBe(false); // no rule, no event

    const mid = (await live.eventBounds(1)).newest ?? 0;
    await getDb().prepare("INSERT INTO customers (customer_code, business_name, synced_at, organization_id) SELECT 'B' || g, 'b', ?, 1 FROM generate_series(1, 201) g").run(NOW);
    const bulk = (await live.eventsAfter(owner, mid)).filter((e) => e.topic === "customers");
    expect(bulk.map((e) => [e.entity_type, e.data_json])).toEqual([[null, '{"bulk":true}']]);
  });
});

describe("presence", () => {
  it("lists who was seen in the last minute, per company", async () => {
    await live.touchPresence(sara, 1);
    await live.touchPresence(other, 2);
    expect(await live.onlineUserIds(1)).toEqual([sara]);
    await getDb().prepare("UPDATE live_presence SET last_seen = now() - interval '2 minutes' WHERE user_id = ?").run(sara);
    expect(await live.onlineUserIds(1)).toEqual([]);
    await live.clearPresence(other);
    expect(await live.onlineUserIds(2)).toEqual([]);
  });
});

describe("the kick", () => {
  it("tells every server when a person is deactivated or signed out everywhere", async () => {
    const c = await rawClient();
    try {
      const got: string[] = [];
      c.on("notification", (n) => n.channel === "rf_live_kick" && got.push(n.payload ?? ""));
      await c.query("LISTEN rf_live_kick");
      await getDb().prepare("UPDATE users SET token_version = token_version + 1 WHERE id = ?").run(reza);
      await getDb().prepare("UPDATE users SET display_name = 'Reza' WHERE id = ?").run(reza); // not a kick
      await new Promise((r) => setTimeout(r, 200));
      expect(got).toEqual([String(reza)]);
    } finally {
      await c.end();
    }
  });
});

/** A stream as the hub sees it, collecting what it is sent. */
function fakeSink(userId: number, roles: string[], session: { alive: boolean } = { alive: true }) {
  const frames: string[] = [];
  const sink: Sink & { frames: string[]; closed: boolean } = {
    who: who(userId, roles),
    frames,
    closed: false,
    write(chunk: string) {
      frames.push(chunk);
      return true;
    },
    close() {
      sink.closed = true;
    },
    async recheck() {
      return session.alive ? who(userId, roles) : null;
    },
  };
  return sink;
}
const until = async (ok: () => boolean) => {
  for (let i = 0; i < 100 && !ok(); i++) await new Promise((r) => setTimeout(r, 20));
};
const topics = (frames: string[]) =>
  frames.filter((f) => f.includes("data: ")).map((f) => (JSON.parse(f.slice(f.indexOf("data: ") + 6)) as { t: string }).t);

describe("the hub", () => {
  it("catches a stream up, then sends it new events as they commit, to the right people only", async () => {
    const start = (await live.eventBounds(1)).newest ?? 0;
    const missed = await live.publishLive(1, { topic: "while-away" });
    const s = fakeSink(sara, ["phone_sales"]);
    const r = fakeSink(reza, ["delivery_driver"]);
    const leaveS = await liveHub.add(s, start);
    const leaveR = await liveHub.add(r, missed);
    expect(s.frames[0]).toContain(`id: ${missed}`); // caught up

    await live.publishLive(1, { topic: "chat:1", users: [sara] });
    await until(() => topics(s.frames).includes("chat:1"));
    await liveHub.settled();
    expect(topics(s.frames).filter((t) => t !== "presence")).toEqual(["while-away", "chat:1"]);
    expect(topics(s.frames)).toContain("presence"); // Reza came online
    expect(topics(r.frames).filter((t) => t !== "presence")).toEqual([]); // not for Reza

    await live.publishEphemeral(1, { topic: "typing", users: [reza], data: { u: sara } });
    await until(() => topics(r.frames).includes("typing"));
    expect(r.frames.find((f) => f.includes("typing"))).not.toContain("id:"); // never stored
    leaveS();
    leaveR();
  });

  it("sends an event about a record only to streams whose check lets them see it", async () => {
    const start = (await live.eventBounds(1)).newest ?? 0;
    const sees = fakeSink(sara, ["owner"]);
    sees.canSee = async (type, id) => type === "order" && id === 77;
    const blind = fakeSink(reza, ["owner"]);
    blind.canSee = async () => false;
    const noCheck = fakeSink(other, ["owner"]);
    noCheck.who = who(other, ["owner"], 1);
    const leaves = [await liveHub.add(sees, start), await liveHub.add(blind, start), await liveHub.add(noCheck, start)];
    await live.publishLive(1, { topic: "orders", data: { id: 77 }, entity: { type: "order", id: 77 } });
    await until(() => topics(sees.frames).includes("orders"));
    await liveHub.settled();
    expect(topics(sees.frames)).toContain("orders");
    expect(topics(blind.frames)).not.toContain("orders");
    expect(topics(noCheck.frames)).not.toContain("orders"); // no check means no record events
    leaves.forEach((l) => l());
  });

  it("does not announce someone gone when their phone is back within 5 seconds (L2)", async () => {
    const mina = await user("mina", "phone_sales", 1); // nobody else's stream left a grace timer for her
    const start = (await live.eventBounds(1)).newest ?? 0;
    const watcher = fakeSink(reza, ["delivery_driver"]);
    const leaveW = await liveHub.add(watcher, start);
    const said = (on: boolean) => watcher.frames.filter((f) => f.includes(`"u":${mina},"on":${on}`)).length;
    const leave1 = await liveHub.add(fakeSink(mina, ["phone_sales"]), start);
    await until(() => said(true) > 0);
    leave1(); // the signal drops...
    const leave2 = await liveHub.add(fakeSink(mina, ["phone_sales"]), start); // ...and is back a moment later
    await new Promise((r) => setTimeout(r, 300));
    expect([said(true), said(false)]).toEqual([1, 0]);
    leave2();
    leaveW();
  });

  it("skips short notices for a phone that is behind, without closing its stream (L3)", async () => {
    const start = (await live.eventBounds(1)).newest ?? 0;
    const s = Object.assign(fakeSink(sara, ["phone_sales"]), { behind: () => true });
    const leave = await liveHub.add(s, start);
    const before = liveHub.stats().skipped;
    await live.publishEphemeral(1, { topic: "typing", data: { u: reza } });
    await until(() => liveHub.stats().skipped > before);
    expect(liveHub.stats().skipped).toBeGreaterThan(before);
    expect(topics(s.frames)).not.toContain("typing");
    expect(s.closed).toBe(false);
    const id = await live.publishLive(1, { topic: "orders" }); // a stored event still goes out
    await until(() => s.frames.some((f) => f.startsWith(`id: ${id}\n`)));
    expect(s.frames.some((f) => f.startsWith(`id: ${id}\n`))).toBe(true);
    leave();
  });

  it("gives a screen that opens the latest value at once (L4)", async () => {
    await live.publishLatest(1, { topic: "import.progress", data: { done: 3 } });
    await live.publishLatest(1, { topic: "import.progress", data: { done: 7 } });
    await live.publishLatest(1, { topic: "van.position", users: [reza], data: { lat: 35.7 } }); // not Sara's
    const s = fakeSink(sara, ["phone_sales"]);
    const leave = await liveHub.add(s, (await live.eventBounds(1)).newest ?? 0);
    const got = s.frames.filter((f) => f.includes('"t":"import.progress"'));
    expect(got).toEqual(['data: {"t":"import.progress","d":{"done":7}}\n\n']);
    expect(topics(s.frames)).not.toContain("van.position");
    leave();
  });

  it("passes on only the newest of a quick run of positions (L5)", async () => {
    const s = fakeSink(sara, ["phone_sales"]);
    const leave = await liveHub.add(s, (await live.eventBounds(1)).newest ?? 0);
    const mine = () => s.frames.filter((f) => f.includes('"t":"van.7"'));
    for (let i = 1; i <= 5; i++) await live.publishLatest(1, { topic: "van.7", data: { i } });
    await until(() => mine().some((f) => f.includes('"i":5')));
    await new Promise((r) => setTimeout(r, 400));
    expect(mine().length).toBeLessThan(5);
    expect(mine().at(-1)).toContain('"i":5');
    leave();
  });

  it("tells a phone that is too far behind to refetch", async () => {
    const { newest } = await live.eventBounds(1);
    const s = fakeSink(sara, ["phone_sales"]);
    const leave = await liveHub.add(s, (newest ?? 0) + 1000);
    expect(topics(s.frames).filter((t) => t !== "presence")).toEqual(["live.reset"]);
    leave();
  });

  it("closes a stream with a goodbye when its session ends", async () => {
    const session = { alive: true };
    const s = fakeSink(reza, ["delivery_driver"], session);
    await liveHub.add(s, (await live.eventBounds(1)).newest ?? 0);
    session.alive = false;
    await getDb().prepare("UPDATE users SET active = 0 WHERE id = ?").run(reza);
    await until(() => s.closed);
    expect(s.closed).toBe(true);
    expect(topics(s.frames)).toContain("live.bye");
  });

  it("drops a stream that cannot keep up, and marks presence while one is open", async () => {
    const s = fakeSink(sara, ["phone_sales"]);
    await liveHub.add(s, (await live.eventBounds(1)).newest ?? 0);
    await liveHub.beat();
    expect(await live.onlineUserIds(1)).toContain(sara);
    s.write = () => false; // the phone stopped reading
    await liveHub.beat();
    expect(s.closed).toBe(true);
    await until(() => liveHub.stats().streams === 0);
    expect(liveHub.stats().dropped).toBeGreaterThan(0);
  });
});
