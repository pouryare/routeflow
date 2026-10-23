import { describe, it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { sqliteDb } from "@/lib/database/client";
import { everySeq, filterSeq, mapSeq, someSeq } from "@/lib/seq";

/* The asynchronous handle (Wave P, phase 1). What it must keep from the synchronous days: a
 * transaction is all or nothing, and nobody else's statement lands inside it. */
function fresh() {
  const raw = new DatabaseSync(":memory:");
  raw.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT NOT NULL)");
  return { raw, db: sqliteDb(() => raw) };
}
const count = async (db: ReturnType<typeof fresh>["db"]) =>
  Number(((await db.prepare("SELECT COUNT(*) AS n FROM t").get()) as { n: number }).n);

describe("tx()", () => {
  it("commits everything inside it", async () => {
    const { db } = fresh();
    const out = await db.tx(async () => {
      await db.prepare("INSERT INTO t (v) VALUES (?)").run("a");
      await db.prepare("INSERT INTO t (v) VALUES (?)").run("b");
      return "done";
    });
    expect(out).toBe("done");
    expect(await count(db)).toBe(2);
  });

  it("rolls everything back when the function throws, and rethrows", async () => {
    const { db, raw } = fresh();
    await expect(
      db.tx(async () => {
        await db.prepare("INSERT INTO t (v) VALUES (?)").run("a");
        throw new Error("refused");
      })
    ).rejects.toThrow("refused");
    expect(await count(db)).toBe(0);
    expect(raw.isTransaction).toBe(false);
  });

  it("joins an outer transaction instead of opening a second one", async () => {
    const { db } = fresh();
    await expect(
      db.tx(async () => {
        await db.tx(async () => {
          await db.prepare("INSERT INTO t (v) VALUES (?)").run("inner");
        });
        throw new Error("outer fails");
      })
    ).rejects.toThrow("outer fails");
    expect(await count(db)).toBe(0);
  });

  it("keeps another caller's statement out of an open transaction", async () => {
    const { db } = fresh();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const failing = db.tx(async () => {
      await db.prepare("INSERT INTO t (v) VALUES (?)").run("inside");
      await gate;
      throw new Error("rolled back");
    });
    // Started while the transaction is open; must not be swept into its rollback.
    const outside = db.prepare("INSERT INTO t (v) VALUES (?)").run("outside");
    release();
    await expect(failing).rejects.toThrow("rolled back");
    await outside;
    const rows = (await db.prepare("SELECT v FROM t").all()) as { v: string }[];
    expect(rows.map((r) => r.v)).toEqual(["outside"]);
  });

  it("runs two transactions one after the other, not interleaved", async () => {
    const { db } = fresh();
    const order: string[] = [];
    const one = db.tx(async () => {
      order.push("one:start");
      await db.prepare("INSERT INTO t (v) VALUES ('1')").run();
      await new Promise((r) => setTimeout(r, 5));
      order.push("one:end");
    });
    const two = db.tx(async () => {
      order.push("two:start");
      await db.prepare("INSERT INTO t (v) VALUES ('2')").run();
      order.push("two:end");
    });
    await Promise.all([one, two]);
    expect(order).toEqual(["one:start", "one:end", "two:start", "two:end"]);
  });
});

describe("lib/seq", () => {
  const isEven = async (n: number) => n % 2 === 0;
  it("maps, filters and tests in order, one at a time", async () => {
    const seen: number[] = [];
    expect(await mapSeq([1, 2, 3], async (n, i) => (seen.push(n), n * 10 + i))).toEqual([10, 21, 32]);
    expect(seen).toEqual([1, 2, 3]);
    expect(await filterSeq([1, 2, 3, 4], isEven)).toEqual([2, 4]);
  });
  it("answers some/every with the callback's value, not with a truthy Promise", async () => {
    expect(await someSeq([1, 3], isEven)).toBe(false);
    expect(await someSeq([1, 2], isEven)).toBe(true);
    expect(await everySeq([2, 4], isEven)).toBe(true);
    expect(await everySeq([2, 3], isEven)).toBe(false);
  });
});
