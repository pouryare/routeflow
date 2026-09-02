import { describe, it, expect, beforeEach } from "vitest";
import { Outbox, MemoryOutboxStore, OfflineError } from "@/lib/offline/outbox";

let clock = 1_700_000_000_000;
const now = () => clock;

let store: MemoryOutboxStore;
let box: Outbox;

beforeEach(() => {
  clock = 1_700_000_000_000;
  store = new MemoryOutboxStore();
  box = new Outbox(store, now);
});

describe("Outbox", () => {
  it("queues a fact as held and refuses a claim", async () => {
    const r = await box.enqueue("payment.record", { amount: 1000 });
    expect(r.status).toBe("held");
    await expect(box.enqueue("order.approve", {})).rejects.toBeInstanceOf(OfflineError);
  });

  it("releases a held record to pending only after the hold time", async () => {
    await box.enqueue("delivery.complete", {});
    expect(await box.releaseHeld()).toBe(0);
    clock += 9000;
    expect(await box.releaseHeld()).toBe(1);
    expect((await box.list())[0].status).toBe("pending");
  });

  it("undo deletes a held record and refuses a released one", async () => {
    const r = await box.enqueue("payment.record", {});
    expect(await box.undo(r.id)).toBe(true);
    expect(await store.get(r.id)).toBeUndefined();

    const r2 = await box.enqueue("payment.record", {});
    clock += 9000;
    await box.releaseHeld();
    expect(await box.undo(r2.id)).toBe(false);
  });

  it("orders a dependent payment after its offline-created order and holds it until the order applies", async () => {
    const order = await box.enqueue("order.draftCreate", { lines: [] });
    clock += 1;
    const pay = await box.enqueue("payment.record", { amount: 500 }, { depends_on: [order.id] });
    clock += 9000;
    await box.releaseHeld();

    let batch = await box.nextBatch();
    expect(batch.map((r) => r.id)).toEqual([order.id]); // payment withheld

    await box.applyResults({ [order.id]: { status: "applied", server_id: 42 } });
    batch = await box.nextBatch();
    expect(batch.map((r) => r.id)).toEqual([pay.id]);
  });

  it("marks results and backs off on failure", async () => {
    const r = await box.enqueue("payment.record", { amount: -1 });
    clock += 9000;
    await box.releaseHeld();
    await box.applyResults({ [r.id]: { status: "failed", error: "مبلغ نامعتبر" } });
    const after = await store.get(r.id);
    expect(after?.status).toBe("failed");
    expect(after?.attempts).toBe(1);
    expect(after?.retry_after).toBeGreaterThan(clock);
    expect(after?.error).toBe("مبلغ نامعتبر");

    // conflict is terminal-ish -- shown to the user, not retried automatically
    const c = await box.enqueue("delivery.complete", {});
    clock += 9000;
    await box.releaseHeld();
    await box.applyResults({ [c.id]: { status: "conflict", reason: "سفارش لغو شده بود" } });
    expect((await store.get(c.id))?.status).toBe("conflict");
  });

  it("pendingCount counts held + pending + sending", async () => {
    await box.enqueue("payment.record", {});
    await box.enqueue("payment.record", {});
    expect(await box.pendingCount()).toBe(2);
    clock += 9000;
    await box.releaseHeld();
    const [a] = await box.nextBatch(1);
    await box.markSending([a.id]);
    expect(await box.pendingCount()).toBe(2);
    await box.applyResults({ [a.id]: { status: "applied", server_id: 1 } });
    expect(await box.pendingCount()).toBe(1);
  });
});
