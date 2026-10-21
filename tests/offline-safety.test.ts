import { describe, it, expect } from "vitest";
import {
  OFFLINE_OPS,
  OFFLINE_OP_LIST,
  offlineClass,
  mayQueueOffline,
  isOfflineOp,
  type OfflineOp,
} from "@/lib/offline/safety";

const FACTS: OfflineOp[] = [
  "order.draftCreate",
  "order.draftEdit",
  "order.submit",
  "delivery.start",
  "delivery.complete",
  "payment.record",
  "cheque.record",
  "complaint.record",
  "customer.capture",
];
const CLAIMS: OfflineOp[] = ["order.approve", "order.plan", "order.freeze", "credit.decide"];

describe("offline safety", () => {
  it("classes every fact op as a fact", () => {
    for (const op of FACTS) {
      expect(offlineClass(op), op).toBe("fact");
      expect(mayQueueOffline(op), op).toBe(true);
    }
  });

  it("classes every claim op as a claim and refuses to queue it", () => {
    for (const op of CLAIMS) {
      expect(offlineClass(op), op).toBe("claim");
      expect(mayQueueOffline(op), op).toBe(false);
    }
  });

  it("covers exactly the op union with a Persian label each", () => {
    expect(OFFLINE_OP_LIST.sort()).toEqual([...FACTS, ...CLAIMS].sort());
    for (const op of OFFLINE_OP_LIST) {
      expect(OFFLINE_OPS[op].label_fa.length).toBeGreaterThan(3);
    }
  });

  it("recognises its own ops and rejects strangers", () => {
    expect(isOfflineOp("payment.record")).toBe(true);
    expect(isOfflineOp("order.nuke")).toBe(false);
  });
});
