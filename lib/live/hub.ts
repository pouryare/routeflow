/* Live updates (issue #58): one app server's side of every open stream.
 *
 * Example: driver Reza marks order 1042 delivered. His save commits an event row (lib/repo/live.ts)
 * and Postgres sends NOTIFY rf_live. This hub, listening on its one connection, reads every event
 * after the last one it handled and writes each to the open streams that may receive it. Sara's
 * screen has it a few milliseconds later.
 *
 * - One LISTEN connection per server, never one per person: the pool stays free for requests.
 * - Each server listens for itself, so a second app server needs nothing extra.
 * - A NOTIFY can be missed (the listening connection dropped for a moment), so the hub also reads
 *   the log every 15 seconds; reading is by id, so nothing is sent twice.
 * - A person's stream joins first and catches up second, holding live events in a queue while it
 *   catches up, so none falls in the gap between the two.
 * - Heartbeats every 20 seconds keep proxies and phones from dropping a quiet stream, and mark the
 *   person online. Every 5 minutes the session is checked again; a deactivation or a sign-out
 *   everywhere closes the stream at once (NOTIFY rf_live_kick, from a trigger on users).
 * - A stream whose phone cannot keep up is closed; it reconnects and catches up from the log. */
import pg from "pg";
import { databaseUrl } from "@/lib/database/connection";
import { withDbScope } from "@/lib/database/scope";
import {
  allEventsAfter,
  clearPresence,
  eventBounds,
  newestEventId,
  eventsAfter,
  latestFor,
  publishEphemeral,
  pruneEvents,
  touchPresence,
} from "@/lib/repo/live";
import {
  BYE_TOPIC,
  RESET_TOPIC,
  canReceive,
  eventFrame,
  frame,
  needsReset,
  passesFilter,
  type LiveEvent,
  type LiveFilter,
  type LiveListener,
} from "./protocol";

const HEARTBEAT_MS = 20_000;
const RECHECK_EVERY_BEATS = 15; // the session is read again every 5 minutes
const SAFETY_DRAIN_MS = 15_000;
const PRUNE_MS = 60 * 60_000;
const CATCH_UP_MAX = 2000; // further behind than this, the screen refetches instead
/* A phone that drops for a moment and comes back is not announced as gone (idea L2, as Pusher waits
   before member_removed): "offline" goes out only if no stream of theirs is back within this. */
const OFFLINE_GRACE_MS = 5000;
const MAX_STREAMS_PER_USER = 10;
/* Latest values (a van's position every few seconds) are passed on at most this often per stream,
   newest only (idea L5, Centrifugo's batch_flush_latest): a slow phone never gets a queue of old
   positions. */
const LATEST_FLUSH_MS = 250;

/** One open stream, as the hub sees it. `write` returns false when the phone is not keeping up. */
interface LiveSink {
  who: LiveListener;
  write(chunk: string): boolean;
  close(): void;
  /** Reads the session again; null when it has ended. Called every few minutes and on a kick. */
  recheck(): Promise<LiveListener | null>;
  /** Whether this person may see one record (lib/live/visibility.ts). Without it, events about a
   *  record are not sent to this stream at all. */
  canSee?(type: string, id: number): Promise<boolean>;
  /** Whether the phone has fallen behind (its buffer is past the normal high-water mark). Short
   *  notices are skipped while it is, instead of piling up and getting the stream closed. */
  behind?(): boolean;
  /** What this stream asked for: a display link's topics (L9), a screen's ?tags= (L10). */
  filter?: LiveFilter;
}

/** Whether a stream gets an event: its company and audience, and for an event about a record, the
 *  record's own view rule. A failed check counts as no. */
async function allowed(sink: LiveSink, ev: LiveEvent): Promise<boolean> {
  if (!canReceive(sink.who, ev) || !passesFilter(sink.filter, ev)) return false;
  if (!ev.entity_type || ev.entity_id == null) return true;
  if (!sink.canSee) return false;
  return await sink.canSee(ev.entity_type, ev.entity_id).catch(() => false);
}

interface Sub {
  sink: LiveSink;
  lastId: number;
  /** Live frames held while the stream catches up; null once it is live. */
  queue: { id?: number; text: string }[] | null;
  beats: number;
  closed: boolean;
  /** Latest values waiting for the next flush, by topic; newer ones replace older (L5). */
  latest: Map<string, string>;
  flush: ReturnType<typeof setTimeout> | null;
}

class Hub {
  private subs = new Set<Sub>();
  private cursor = 0;
  private started: Promise<void> | null = null;
  private client: pg.Client | null = null;
  private listening = false;
  private draining: Promise<void> = Promise.resolve();
  private drainAgain = false;
  private timers: ReturnType<typeof setInterval>[] = [];
  private retryDelay = 1000;
  private leaving = new Map<number, ReturnType<typeof setTimeout>>();
  private stopped = false;
  delivered = 0;
  dropped = 0;
  skipped = 0;

  start(): Promise<void> {
    return (this.started ??= (async () => {
      this.stopped = false;
      this.cursor = await withDbScope("system", () => newestEventId());
      await this.listen();
      const every = (ms: number, fn: () => void) => {
        const t = setInterval(fn, ms);
        t.unref?.();
        this.timers.push(t);
      };
      every(SAFETY_DRAIN_MS, () => this.drain());
      every(HEARTBEAT_MS, () => void this.heartbeat());
      every(PRUNE_MS, () => void withDbScope("system", () => pruneEvents()).catch((e) => console.warn("[live] prune failed", e)));
    })());
  }

  private async listen(): Promise<void> {
    if (this.stopped) return;
    const client = new pg.Client({ connectionString: await databaseUrl() });
    client.on("notification", (n) => {
      if (n.channel === "rf_live") this.drain();
      else if (n.channel === "rf_live_eph" && n.payload) this.ephemeral(n.payload);
      else if (n.channel === "rf_live_kick" && n.payload) void this.kick(Number(n.payload));
    });
    const lost = () => {
      if (this.client !== client) return;
      this.client = null;
      this.listening = false;
      if (this.stopped) return;
      const wait = this.retryDelay;
      this.retryDelay = Math.min(this.retryDelay * 2, 30_000);
      setTimeout(() => void this.listen().catch(() => lost()), wait).unref?.();
    };
    client.on("error", lost);
    client.on("end", lost);
    this.client = client;
    try {
      await client.connect();
      await client.query("LISTEN rf_live; LISTEN rf_live_eph; LISTEN rf_live_kick");
    } catch (e) {
      console.warn("[live] listen failed, retrying", e);
      lost();
      return;
    }
    this.listening = true;
    this.retryDelay = 1000;
    this.drain(); // whatever committed while nobody was listening
  }

  /** Reads and sends everything after the cursor. Runs one at a time; a call while one is running
   *  makes it go round once more, so a NOTIFY during a read is not lost. */
  drain(): void {
    this.drainAgain = true;
    this.draining = this.draining.then(async () => {
      while (this.drainAgain) {
        this.drainAgain = false;
        try {
          for (;;) {
            const rows = await withDbScope("system", () => allEventsAfter(this.cursor));
            for (const ev of rows) {
              const targets = [...this.subs].filter((sub) => ev.id > sub.lastId);
              const ok = await Promise.all(targets.map((sub) => allowed(sub.sink, ev)));
              targets.forEach((sub, i) => ok[i] && this.send(sub, eventFrame(ev), ev.id));
              this.cursor = ev.id;
            }
            if (rows.length < 1000) break;
          }
        } catch (e) {
          console.warn("[live] drain failed; the next notice or the 15 s read retries", e);
        }
      }
    });
  }

  private ephemeral(payload: string): void {
    let msg: { o: number; t: string; u: number[] | null; r: string[] | null; g?: string[] | null; d: unknown; l?: 1 };
    try {
      msg = JSON.parse(payload);
    } catch {
      return;
    }
    const ev = { organization_id: msg.o, audience_users: msg.u, audience_roles: msg.r, topic: msg.t, tags: msg.g ?? null };
    const text = frame(msg.t, msg.d);
    for (const sub of this.subs) {
      if (!canReceive(sub.sink.who, ev) || !passesFilter(sub.sink.filter, ev)) continue;
      if (msg.l) this.later(sub, msg.t, text);
      else this.send(sub, text, undefined, true);
    }
  }

  /** Holds a latest value for the stream's next flush, replacing an older one of the same topic. */
  private later(sub: Sub, topic: string, text: string): void {
    if (sub.closed) return;
    if (sub.latest.has(topic)) this.skipped++; // replaced before it went out
    sub.latest.set(topic, text);
    if (sub.flush || sub.queue) return; // a flush is due, or the catch-up flushes when it ends
    sub.flush = setTimeout(() => this.flushLatest(sub), this.stopped ? 0 : LATEST_FLUSH_MS);
    sub.flush.unref?.();
  }

  private flushLatest(sub: Sub): void {
    sub.flush = null;
    const out = [...sub.latest.values()];
    sub.latest.clear();
    for (const text of out) this.send(sub, text, undefined, true);
  }

  /** `droppable`: a short notice (typing, online, a GPS ping) that a phone which is behind simply
   *  skips (idea L3, Socket.IO's volatile events). Losing "Sara is typing" costs nothing; closing
   *  the stream over it would cost a reconnect and a catch-up. */
  private send(sub: Sub, text: string, id?: number, droppable = false): void {
    if (sub.closed) return;
    if (droppable && sub.sink.behind?.()) {
      this.skipped++;
      return;
    }
    if (sub.queue) {
      sub.queue.push({ id, text });
      return;
    }
    if (id !== undefined) sub.lastId = id;
    this.delivered++;
    if (!sub.sink.write(text)) {
      this.dropped++;
      this.remove(sub); // too slow: it reconnects and catches up from the log
    }
  }

  /** Opens a stream: joins, catches up from `lastSeen`, then goes live. */
  async add(sink: LiveSink, lastSeen: number): Promise<() => void> {
    await this.start();
    const sub: Sub = { sink, lastId: lastSeen, queue: [], beats: 0, closed: false, latest: new Map(), flush: null };
    const same = [...this.subs].filter((s) => s.sink.who.userId === sink.who.userId);
    const firstHere = same.length === 0;
    this.subs.add(sub);
    if (same.length >= MAX_STREAMS_PER_USER) this.remove(same[0]); // the oldest gives way
    try {
      await withDbScope("system", async () => {
        const { oldest, newest } = await eventBounds(sink.who.organizationId);
        if (needsReset(lastSeen, oldest, newest)) {
          sink.write(frame(RESET_TOPIC, null));
          sub.lastId = newest ?? 0;
          return;
        }
        let sent = 0;
        for (;;) {
          const rows = await eventsAfter(sink.who, sub.lastId, 500);
          for (const ev of rows) {
            if (await allowed(sink, ev)) sink.write(eventFrame(ev));
            sub.lastId = ev.id;
          }
          sent += rows.length;
          if (rows.length < 500) break;
          if (sent >= CATCH_UP_MAX) {
            sink.write(frame(RESET_TOPIC, null));
            sub.lastId = Math.max(sub.lastId, newest ?? 0);
            break;
          }
        }
        // The current value of each "latest" topic, so the screen is not blank until the next
        // change (idea L4). A newer one that arrived meanwhile is already held and wins.
        for (const row of await latestFor(sink.who)) {
          if (!passesFilter(sink.filter, { topic: row.topic, tags: null }) || sub.latest.has(row.topic)) continue;
          sink.write(`data: {"t":${JSON.stringify(row.topic)},"d":${row.data_json ?? "null"}}\n\n`);
        }
      });
    } catch (e) {
      this.remove(sub);
      throw e;
    }
    const held = sub.queue ?? [];
    sub.queue = null;
    for (const m of held) if (m.id === undefined || m.id > sub.lastId) this.send(sub, m.text, m.id);
    if (sub.latest.size) this.flushLatest(sub);
    const wasLeaving = this.leaving.get(sink.who.userId);
    if (wasLeaving) {
      // Back within the grace period: still online, nobody was told otherwise.
      clearTimeout(wasLeaving);
      this.leaving.delete(sink.who.userId);
    } else if (firstHere) void this.presence(sink.who, true);
    return () => this.remove(sub);
  }

  private remove(sub: Sub): void {
    if (sub.closed) return;
    sub.closed = true;
    if (sub.flush) clearTimeout(sub.flush);
    this.subs.delete(sub);
    try {
      sub.sink.close();
    } catch {
      /* already closed by the browser */
    }
    const who = sub.sink.who;
    if ([...this.subs].some((s) => s.sink.who.userId === who.userId) || this.leaving.has(who.userId)) return;
    const t = setTimeout(() => {
      this.leaving.delete(who.userId);
      if (![...this.subs].some((s) => s.sink.who.userId === who.userId)) void this.presence(who, false);
    }, this.stopped ? 0 : OFFLINE_GRACE_MS);
    t.unref?.();
    this.leaving.set(who.userId, t);
  }

  private async presence(who: LiveListener, online: boolean): Promise<void> {
    if (who.userId <= 0) return; // a display link (L9) is a screen, not a person
    try {
      await withDbScope("system", async () => {
        if (online) await touchPresence(who.userId, who.organizationId);
        else await clearPresence(who.userId);
        await publishEphemeral(who.organizationId, { topic: "presence", data: { u: who.userId, on: online } });
      });
    } catch (e) {
      console.warn("[live] presence update failed", e);
    }
  }

  private async heartbeat(): Promise<void> {
    const seen = new Map<number, LiveListener>();
    for (const sub of [...this.subs]) {
      if (sub.queue) continue; // still catching up; it writes soon enough
      if (!sub.sink.write(": hb\n\n")) {
        this.dropped++;
        this.remove(sub);
        continue;
      }
      seen.set(sub.sink.who.userId, sub.sink.who);
      if (++sub.beats % RECHECK_EVERY_BEATS === 0) void this.recheck(sub);
    }
    for (const who of seen.values()) {
      if (who.userId <= 0) continue;
      await withDbScope("system", () => touchPresence(who.userId, who.organizationId)).catch(() => undefined);
    }
  }

  private async recheck(sub: Sub): Promise<void> {
    let who: LiveListener | null = null;
    try {
      who = await sub.sink.recheck();
    } catch {
      return; // the database blinked; the next check decides
    }
    if (!who) {
      sub.sink.write(frame(BYE_TOPIC, null));
      this.remove(sub);
    } else sub.sink.who = who; // roles may have changed
  }

  private async kick(userId: number): Promise<void> {
    await Promise.all([...this.subs].filter((s) => s.sink.who.userId === userId).map((s) => this.recheck(s)));
  }

  stats(): { listening: boolean; streams: number; people: number; delivered: number; dropped: number; skipped: number } {
    return {
      listening: this.listening,
      streams: this.subs.size,
      people: new Set([...this.subs].map((s) => s.sink.who.userId)).size,
      delivered: this.delivered,
      dropped: this.dropped,
      skipped: this.skipped,
    };
  }

  /** Tests only: closes every stream and the listening connection. */
  async stop(): Promise<void> {
    this.stopped = true;
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    for (const sub of [...this.subs]) this.remove(sub);
    for (const t of this.leaving.values()) clearTimeout(t);
    this.leaving.clear();
    await this.draining;
    const c = this.client;
    this.client = null;
    this.listening = false;
    this.started = null;
    await c?.end().catch(() => undefined);
  }

  /** Tests only: runs one heartbeat now. */
  beat(): Promise<void> {
    return this.heartbeat();
  }

  /** Tests only: resolves when the current reads have finished. */
  settled(): Promise<void> {
    return this.draining;
  }
}

/* One hub per server process. Next can load this module more than once in development, so the
 * instance lives on globalThis. */
const g = globalThis as unknown as { __rfLiveHub?: Hub };
export const liveHub: Hub = (g.__rfLiveHub ??= new Hub());
