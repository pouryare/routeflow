import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-notif-sweep-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.COVERAGE_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
process.env.TELEGRAM_BOT_TOKEN = "t";
// VAPID is deliberately unset: configureWebPush() then returns false, so push is off and
// telegram is the only loud channel under test — one send per user, easy to count.
delete process.env.VAPID_PUBLIC_KEY;
delete process.env.VAPID_PRIVATE_KEY;
delete process.env.VAPID_SUBJECT;

// The Bot API wrappers are the seam: a sweep must never reach the network.
vi.mock("@/lib/telegram", () => ({
  telegramConfigured: () => true,
  sendTelegram: vi.fn(),
  editTelegram: vi.fn(),
}));

const { getDb } = await import("@/lib/db");
const { sendTelegram } = await import("@/lib/telegram");
const { runSweepRules, escalateStaleRuns, flushAllNotifications } = await import("@/lib/repo/rules");

const tgSend = vi.mocked(sendTelegram);

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

const ORG = 1;
const OTHER_ORG = 2;
const CHAT = "55384695";
const MIN = 60_000;
const DAY = 86_400_000;

const at = (ms: number) => new Date(ms).toISOString();
const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** A type alias, not an interface: only an alias gets the implicit index signature that
 *  makes `stmt.all(...) as NotifRow[]` a legal cast from node:sqlite's row type. */
type NotifRow = {
  user_id: number;
  entity_type: string | null;
  entity_id: number | null;
  body_fa: string | null;
  title_fa: string;
};

function notifs(typeCode: string): NotifRow[] {
  return getDb()
    .prepare(
      "SELECT user_id, entity_type, entity_id, body_fa, title_fa FROM notifications WHERE type_code = ? ORDER BY user_id, id"
    )
    .all(typeCode) as NotifRow[];
}

/** Route one type loud on telegram for one user, independent of catalogue defaults. */
function routeLoud(userId: number, typeCode: string): void {
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO notification_prefs (user_id, type_code, channel, enabled, updated_at)
       VALUES (?, ?, 'telegram', 1, ?)`
    )
    .run(userId, typeCode, new Date().toISOString());
}

let owner = 0,
  mgr = 0,
  seller = 0,
  g = 0,
  custId = 0,
  otherCust = 0,
  ord = 0,
  T = 0;

beforeEach(() => {
  const db = getDb();
  db.exec(
    `PRAGMA foreign_keys=OFF;
     DELETE FROM notification_deliveries; DELETE FROM notification_prefs; DELETE FROM notification_channels;
     DELETE FROM notifications; DELETE FROM events; DELETE FROM rule_runs; DELETE FROM tasks; DELETE FROM alerts;
     DELETE FROM cheques; DELETE FROM reminders; DELETE FROM credit_approvals; DELETE FROM orders;
     DELETE FROM customers; DELETE FROM groups; DELETE FROM users WHERE id>0;
     DELETE FROM organizations WHERE id>1;
     PRAGMA foreign_keys=ON;`
  );
  T = Date.now();
  const now = at(T);

  db.prepare(
    "INSERT INTO organizations (id, name, slug, plan, active, created_at) VALUES (?, 'دیگر', 'other', 'standard', 1, ?)"
  ).run(OTHER_ORG, now);

  const u = db.prepare(
    "INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES (?,'x:y',?,?,1,?,?)"
  );
  owner = Number(u.run(`o${T}`, "مالک", "owner", now, ORG).lastInsertRowid);
  mgr = Number(u.run(`m${T}`, "مدیر", "group_manager", now, ORG).lastInsertRowid);
  seller = Number(u.run(`s${T}`, "فروشنده", "salesperson", now, ORG).lastInsertRowid);

  g = Number(
    db.prepare("INSERT INTO groups (name, slug, created_at, organization_id) VALUES ('گ','g',?,?)").run(now, ORG)
      .lastInsertRowid
  );
  db.prepare("UPDATE users SET group_id = ? WHERE id = ?").run(g, mgr);
  // Only the manager is telegram-linked, so a delivery count is unambiguous.
  db.prepare("UPDATE users SET telegram_chat_id = ? WHERE id = ?").run(CHAT, mgr);

  const cust = db.prepare(
    "INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,organization_id) VALUES (?,?,'active',?,?)"
  );
  custId = Number(cust.run(`C${T}`, "مشتری", "2026-01-01", ORG).lastInsertRowid);
  otherCust = Number(cust.run(`X${T}`, "مشتری سازمان دیگر", "2026-01-01", OTHER_ORG).lastInsertRowid);

  // ONE order only: customer_overdue needs >= 3, so the base fixture never trips it.
  ord = Number(
    db
      .prepare(
        `INSERT INTO orders (order_no, customer_id, group_id, salesperson_user_id, status, order_date, created_by, created_at, updated_at, organization_id)
         VALUES (?, ?, ?, ?, 'PENDING_CREDIT', ?, ?, ?, ?, ?)`
      )
      .run(`9${T % 100000}`, custId, g, seller, ymd(T), owner, now, now, ORG).lastInsertRowid
  );

  vi.clearAllMocks();
  tgSend.mockResolvedValue({ message_id: 777 });
});

describe("the sweep fans notifications out", () => {
  it("writes a credit_approval.waiting notification for the org's approvers", () => {
    getDb()
      .prepare(
        `INSERT INTO credit_approvals (organization_id, order_id, requested_by, requested_at, customer_balance_toman, credit_limit_toman, overage_toman, status)
         VALUES (?,?,?,?,1000,0,1000,'pending')`
      )
      .run(ORG, ord, seller, at(T - 90 * MIN));

    const fired = runSweepRules(ORG, at(T)).map((f) => f.rule_code);
    expect(fired).toContain("credit_approval_waiting");
    expect(fired).toContain("notify_credit_approval_waiting");

    const rows = notifs("credit_approval.waiting");
    expect(rows.map((r) => r.user_id).sort()).toEqual([owner, mgr].sort());
    expect(rows[0].entity_type).toBe("credit_approval");
  });

  it("holds the notify rule inside its cooldown on the next tick", () => {
    getDb()
      .prepare(
        `INSERT INTO credit_approvals (organization_id, order_id, requested_by, requested_at, customer_balance_toman, credit_limit_toman, overage_toman, status)
         VALUES (?,?,?,?,1000,0,1000,'pending')`
      )
      .run(ORG, ord, seller, at(T - 90 * MIN));

    runSweepRules(ORG, at(T));
    const again = runSweepRules(ORG, at(T + 5 * MIN)).map((f) => f.rule_code);
    expect(again).not.toContain("notify_credit_approval_waiting");
    expect(notifs("credit_approval.waiting")).toHaveLength(2); // owner + mgr, once
  });

  it("flushAllNotifications delivers the swept rows to telegram once the debounce has passed", async () => {
    routeLoud(mgr, "credit_approval.waiting");
    getDb()
      .prepare(
        `INSERT INTO credit_approvals (organization_id, order_id, requested_by, requested_at, customer_balance_toman, credit_limit_toman, overage_toman, status)
         VALUES (?,?,?,?,1000,0,1000,'pending')`
      )
      .run(ORG, ord, seller, at(T - 90 * MIN));
    runSweepRules(ORG, at(T));

    await flushAllNotifications(ORG, at(Date.now() + 3 * MIN));

    expect(tgSend).toHaveBeenCalledTimes(1);
    expect(tgSend.mock.calls[0][0]).toBe(CHAT);
    const stamped = getDb()
      .prepare("SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND tg_flushed_at IS NOT NULL")
      .get(mgr) as { c: number };
    expect(stamped.c).toBe(1);
  });

  it("notifies the receiver of a cheque falling due within 7 days", () => {
    getDb()
      .prepare(
        `INSERT INTO cheques (organization_id, customer_id, amount_toman, cheque_no, bank_name, due_date, status, received_at, received_by, created_at, updated_at)
         VALUES (?,?,?,?,?,?,'in_hand',?,?,?,?)`
      )
      .run(ORG, custId, 5_000_000, "CH-1", "ملت", ymd(T + 3 * DAY), at(T - 10 * DAY), seller, at(T), at(T));

    const fired = runSweepRules(ORG, at(T)).map((f) => f.rule_code);
    expect(fired).toContain("notify_cheque_due_soon");

    const rows = notifs("cheque.due_soon");
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBe(seller);
    expect(rows[0].entity_type).toBe("cheque");
    expect(rows[0].body_fa).toContain("CH-1");
  });

  it("leaves a cheque due beyond the 7-day window alone", () => {
    getDb()
      .prepare(
        `INSERT INTO cheques (organization_id, customer_id, amount_toman, cheque_no, bank_name, due_date, status, received_at, received_by, created_at, updated_at)
         VALUES (?,?,?,?,?,?,'in_hand',?,?,?,?)`
      )
      .run(ORG, custId, 5_000_000, "CH-2", "ملت", ymd(T + 30 * DAY), at(T - 10 * DAY), seller, at(T), at(T));

    runSweepRules(ORG, at(T));
    expect(notifs("cheque.due_soon")).toHaveLength(0);
  });

  it("notifies the salesperson of a past-due reminder, and skips another org's reminder", () => {
    const db = getDb();
    const rem = db.prepare(
      "INSERT INTO reminders (entity_type, entity_id, due_date, message, resolved, created_at) VALUES ('customer',?,?,?,0,?)"
    );
    rem.run(custId, ymd(T - DAY), "تماس با مشتری", at(T - 5 * DAY));
    rem.run(otherCust, ymd(T - DAY), "مال سازمان دیگر", at(T - 5 * DAY));

    const fired = runSweepRules(ORG, at(T)).map((f) => f.rule_code);
    expect(fired).toContain("notify_reminder_due");

    const rows = notifs("reminder.due");
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBe(seller);
    expect(rows[0].entity_id).toBe(custId);
    expect(rows[0].body_fa).toBe("تماس با مشتری");
  });

  it("ignores a resolved or future reminder", () => {
    const db = getDb();
    db.prepare(
      "INSERT INTO reminders (entity_type, entity_id, due_date, message, resolved, created_at) VALUES ('customer',?,?,?,1,?)"
    ).run(custId, ymd(T - DAY), "انجام شد", at(T - 5 * DAY));
    db.prepare(
      "INSERT INTO reminders (entity_type, entity_id, due_date, message, resolved, created_at) VALUES ('customer',?,?,?,0,?)"
    ).run(custId, ymd(T + 5 * DAY), "بعدا", at(T));

    runSweepRules(ORG, at(T));
    expect(notifs("reminder.due")).toHaveLength(0);
  });

  it("notifies the salesperson of a customer gone quiet", () => {
    const db = getDb();
    const slow = Number(
      db
        .prepare(
          "INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,organization_id) VALUES (?,?,'active',?,?)"
        )
        .run(`S${T}`, "کند", "2026-01-01", ORG).lastInsertRowid
    );
    const o = db.prepare(
      `INSERT INTO orders (order_no, customer_id, group_id, salesperson_user_id, status, order_date, created_by, created_at, updated_at, organization_id)
       VALUES (?, ?, ?, ?, 'CLOSED', ?, ?, ?, ?, ?)`
    );
    for (const [i, days] of [100, 80, 60].entries()) {
      o.run(`8${T % 100000}${i}`, slow, g, seller, ymd(T - days * DAY), owner, at(T), at(T), ORG);
    }

    const fired = runSweepRules(ORG, at(T)).map((f) => f.rule_code);
    expect(fired).toContain("notify_customer_overdue");

    const rows = notifs("customer.overdue");
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBe(seller);
    expect(rows[0].entity_id).toBe(slow);
  });
});

describe("escalateStaleRuns", () => {
  function stageStaleRun(): number {
    const db = getDb();
    db.prepare(
      "UPDATE rules SET escalate_after_min = 60, escalate_to_role = 'owner' WHERE code = 'delivery_failed_retry'"
    ).run();
    const ruleId = (
      db.prepare("SELECT id FROM rules WHERE code = 'delivery_failed_retry'").get() as { id: number }
    ).id;
    const taskId = Number(
      db
        .prepare(
          `INSERT INTO tasks (organization_id, assignee_user_id, kind, title, entity_type, entity_id, priority, status, created_at)
           VALUES (?, ?, 'followup', 'پیگیری تحویل ناموفق', 'order', ?, 'NORMAL', 'open', ?)`
        )
        .run(ORG, seller, ord, at(T - 3 * 60 * MIN)).lastInsertRowid
    );
    db.prepare(
      `INSERT INTO rule_runs (organization_id, rule_id, entity_type, entity_id, fired_at, cooldown_until, task_id)
       VALUES (?, ?, 'order', ?, ?, ?, ?)`
    ).run(ORG, ruleId, ord, at(T - 3 * 60 * MIN), at(T - 2 * 60 * MIN), taskId);
    return taskId;
  }

  it("records a task.escalated event carrying the new assignee", () => {
    stageStaleRun();
    expect(escalateStaleRuns(ORG, at(T))).toBe(1);

    const ev = getDb()
      .prepare("SELECT entity_type, entity_id, metadata_json FROM events WHERE kind = 'task.escalated'")
      .all() as { entity_type: string; entity_id: number; metadata_json: string }[];
    expect(ev).toHaveLength(1);
    expect(ev[0].entity_type).toBe("task");
    const meta = JSON.parse(ev[0].metadata_json) as { assignee_user_id: number; title: string | null };
    expect(meta.assignee_user_id).toBe(owner);
    expect(meta.title).toBe("پیگیری تحویل ناموفق");
  });

  it("notifies the escalation's new owner through the event rules", () => {
    stageStaleRun();
    escalateStaleRuns(ORG, at(T));

    const rows = notifs("task.escalated");
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBe(owner);
    expect(rows[0].body_fa).toBe("پیگیری تحویل ناموفق");
  });
});
