import { describe, expect, test, beforeEach, vi } from "vitest";
import { enqueue, dequeue, queueSize, flush, subscribe } from "@/lib/deliveryQueue";

/** A localStorage good enough to exercise the queue, and one that can be made to fail. */
function installStorage(broken = false) {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => {
      if (broken) throw new Error("unavailable");
      return store.get(k) ?? null;
    },
    setItem: (k: string, v: string) => {
      if (broken) throw new Error("quota");
      store.set(k, v);
    },
    removeItem: (k: string) => store.delete(k),
  });
  return store;
}

const item = (stopId: number) => ({
  stopId,
  body: { lines: [{ line_id: stopId, packs_delivered: 1 }], collected_toman: 1000 },
  recordedAt: "2026-08-26T10:00:00.000Z",
});

const response = (status: number) => new Response(null, { status });

beforeEach(() => {
  installStorage();
});

describe("enqueue", () => {
  test("holds a delivery that could not be sent", () => {
    enqueue(item(1));
    expect(queueSize()).toBe(1);
  });

  test("keeps one entry per stop, replacing rather than stacking", () => {
    // A driver correcting what they typed before it sends should replace the pending
    // record. Stacking would send the wrong figure first and the right one after.
    enqueue(item(1));
    enqueue({ ...item(1), body: { corrected: true } });
    expect(queueSize()).toBe(1);
  });

  test("keeps separate stops apart", () => {
    enqueue(item(1));
    enqueue(item(2));
    expect(queueSize()).toBe(2);
  });
});

describe("dequeue", () => {
  test("removes just that stop", () => {
    enqueue(item(1));
    enqueue(item(2));
    dequeue(1);
    expect(queueSize()).toBe(1);
  });

  test("is harmless for a stop that is not queued", () => {
    expect(() => dequeue(99)).not.toThrow();
  });
});

describe("flush", () => {
  test("sends everything pending and empties the queue", async () => {
    enqueue(item(1));
    enqueue(item(2));
    const result = await flush(async () => response(200));
    expect(result).toEqual({ sent: 2, failed: 0 });
    expect(queueSize()).toBe(0);
  });

  test("keeps a delivery the network could not deliver", async () => {
    enqueue(item(1));
    const result = await flush(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(result.failed).toBe(1);
    expect(queueSize()).toBe(1);
  });

  test("keeps a delivery the server failed on, because those succeed later", async () => {
    enqueue(item(1));
    await flush(async () => response(503));
    expect(queueSize()).toBe(1);
  });

  test("drops a delivery the server refused, rather than retrying it forever", async () => {
    // A 400 means the content is wrong, not that the send failed. Replaying it would
    // block every later delivery behind one bad record for the rest of the round.
    enqueue(item(1));
    const result = await flush(async () => response(400));
    expect(result).toEqual({ sent: 0, failed: 1 });
    expect(queueSize()).toBe(0);
  });

  test("does not let one failure strand the deliveries behind it", async () => {
    enqueue(item(1));
    enqueue(item(2));
    const result = await flush(async (stopId) => (stopId === 1 ? response(503) : response(200)));
    expect(result).toEqual({ sent: 1, failed: 1 });
    expect(queueSize()).toBe(1);
  });

  test("is a no-op on an empty queue", async () => {
    expect(await flush(async () => response(200))).toEqual({ sent: 0, failed: 0 });
  });
});

describe("subscribe", () => {
  test("tells a listener when something is queued", () => {
    let calls = 0;
    const stop = subscribe(() => calls++);
    enqueue(item(1));
    expect(calls).toBe(1);
    stop();
  });

  test("tells a listener when something is sent", () => {
    let calls = 0;
    const stop = subscribe(() => calls++);
    enqueue(item(1));
    dequeue(1);
    expect(calls).toBe(2);
    stop();
  });

  test("stops telling a listener that unsubscribed", () => {
    let calls = 0;
    const stop = subscribe(() => calls++);
    stop();
    enqueue(item(1));
    expect(calls).toBe(0);
  });

  test("gives a size stable enough to read during render", () => {
    // Read through useSyncExternalStore rather than set from an effect. A number
    // compares by value, so repeated snapshots are equal and React does not loop.
    enqueue(item(1));
    expect(queueSize()).toBe(1);
    expect(queueSize()).toBe(queueSize());
  });
});

describe("when storage is unavailable", () => {
  test("reads as empty rather than throwing", () => {
    installStorage(true);
    expect(queueSize()).toBe(0);
  });

  test("does not break the screen the driver needs", () => {
    // Private browsing, or site data blocked. Losing the retry is survivable; a
    // delivery screen that throws on load is not.
    installStorage(true);
    expect(() => enqueue(item(1))).not.toThrow();
  });
});
