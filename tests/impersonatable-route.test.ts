import { describe, it, expect, afterAll, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rf-imp-")), "t.db");
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { readImpersonatable } = await import("@/lib/repo/impersonation");
const { setRoles } = await import("@/lib/repo/userRoles");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

beforeAll(async () => {
  const d = getDb();
  for (const [id, slug] of [[8, "o8"], [9, "o9"]] as const) {
    await d.exec(`INSERT INTO organizations (id,name,slug,created_at) VALUES (${id},'O${id}','${slug}','2026-01-01') ON CONFLICT DO NOTHING`);
  }
  await d.prepare(
    "INSERT INTO users (id,username,password_hash,display_name,role,organization_id,active,token_version,created_at) VALUES (?,?,?,?,?,?,1,0,'2026-01-01') ON CONFLICT DO NOTHING"
  ).run(1, "founder", "x", "founder", "platform_owner", 8);
  await d.prepare(
    "INSERT INTO users (id,username,password_hash,display_name,role,organization_id,active,token_version,created_at) VALUES (?,?,?,?,?,?,1,0,'2026-01-01') ON CONFLICT DO NOTHING"
  ).run(5, "driver", "x", "driver", "delivery_driver", 8);
  await d.prepare(
    "INSERT INTO users (id,username,password_hash,display_name,role,organization_id,active,token_version,created_at) VALUES (?,?,?,?,?,?,1,0,'2026-01-01') ON CONFLICT DO NOTHING"
  ).run(9, "other.owner", "x", "other", "owner", 9);
  /* A DEACTIVATED account must never be offered: the session it minted would die on the
     next request, and the founder would blame the app. */
  await d.prepare(
    "INSERT INTO users (id,username,password_hash,display_name,role,organization_id,active,token_version,created_at) VALUES (?,?,?,?,?,?,0,0,'2026-01-01') ON CONFLICT DO NOTHING"
  ).run(12, "gone", "x", "gone", "phone_sales", 8);
  await setRoles(9, ["owner"]);
});

/* The list behind BOTH mounts of the switcher: every active account in EVERY
 * organisation. Cross-tenant from the first commit — diagnosing a customer you do not work
 * for is what the founder is for, and the audit trail is what makes that accountable
 * rather than invisible. */

describe("readImpersonatable", () => {
  it("lists users from every organisation, not just the caller's", async () => {
    const rows = await readImpersonatable(getDb(), null);
    const orgs = new Set(rows.map((r) => r.organization_id));
    expect(orgs.has(8)).toBe(true);
    expect(orgs.has(9)).toBe(true);
  });

  it("never offers a deactivated account", async () => {
    expect((await readImpersonatable(getDb(), null)).map((r) => r.id)).not.toContain(12);
  });

  it("carries the fields the switcher renders", async () => {
    const r = (await readImpersonatable(getDb(), null))[0];
    expect(r).toHaveProperty("organization_name");
    expect(r).toHaveProperty("display_name");
    expect(r).toHaveProperty("role");
    expect(r).toHaveProperty("group_id");
  });

  it("carries the FULL role set, so a dual-hat person is not reduced to one hat", async () => {
    await setRoles(5, ["field_rep", "delivery_driver"]);
    const row = (await readImpersonatable(getDb(), null)).find((r) => r.id === 5)!;
    expect(row.roles.sort()).toEqual(["delivery_driver", "field_rep"]);
  });
});
