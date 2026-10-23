/** Organisation, groups, one login per role, and the facility stock movements need.
 *
 *  The facility is not optional decoration: `stock_movements.facility_id` is
 *  `NOT NULL REFERENCES facilities(id)` and `getDb()` creates no default one, so every stock
 *  row in phase 06 fails without it. It also needs real lat/lng — both NOT NULL — because
 *  the routing screens measure distance from here.
 */

import { hashPassword } from "@/lib/auth";
import type { SeedContext } from "../context";
import { mapSeq } from "@/lib/seq";

const PASSWORD = "demo1234";

/** All seven roles from lib/roles.ts:13-20. NOT 'salesperson'/'driver' — the users.role
 *  CHECK still permits those two legacy values, but `getDb()` DELETEs them from `user_roles`
 *  (lib/db.ts:3912), and `createRun` checks `user_roles` rather than `users.role`
 *  (lib/delivery.ts:88). An account on either legacy role can therefore never drive. */
const STAFF: { username: string; name: string; role: string; group: number | null }[] = [
  { username: "demo.platform", name: "مدیر پلتفرم", role: "platform_owner", group: null },
  { username: "demo.owner", name: "مالک شرکت", role: "owner", group: null },
  { username: "demo.gm", name: "مدیر گروه شمال", role: "group_manager", group: 0 },
  { username: "demo.rep_lead", name: "سرپرست نمایندگان", role: "rep_manager", group: 0 },
  { username: "demo.sales", name: "فروشنده تلفنی", role: "phone_sales", group: 0 },
  { username: "demo.field", name: "نماینده میدانی", role: "field_rep", group: 1 },
  { username: "demo.driver", name: "راننده", role: "delivery_driver", group: 2 },
];

const GROUP_NAMES = ["شمال", "جنوب", "رانندگان"];

export async function run(ctx: SeedContext): Promise<void> {
  const { db } = ctx;
  const now = ctx.stamp(0);

  /* ADOPT the organisation the migration already created, do not add a second.
   *
   *  `getDb()` seeds one row at boot — `lib/db.ts:3027` — with a HARDCODED id of 1, because
   *  "every backfill below needs an id to point at". In a fresh demo database that row is
   *  `طعمینو` / `tameeno`: the real tenant. Inserting a demo org alongside it would leave an
   *  empty orphan tenant, and the cross-tenant invariants would count three organisations
   *  instead of two.
   *
   *  Measured on a fresh database: `facilities` (2 rows) is the ONLY table holding
   *  organization_id = 1, and those two are deleted below. `accounts` (27) and `app_meta` (5)
   *  are not org-scoped. So renaming this row is safe and leaves nothing pointing at a
   *  tenant that no longer exists. */
  const adopt = await db.prepare(`SELECT id FROM organizations WHERE slug = ?`).get("tameeno") as
    | { id: number }
    | undefined;

  let orgId: number;
  if (adopt) {
    await db.prepare(`UPDATE organizations SET name = ?, slug = ? WHERE id = ?`).run(
      "شرکت پخش طعمینو (دمو)", "tameeno-demo", adopt.id,
    );
    orgId = adopt.id;
  } else {
    orgId = Number(
      (await db.prepare(
        `INSERT INTO organizations (name, slug, plan, active, contact_name, created_at)
         VALUES ('شرکت پخش طعمینو (دمو)', 'tameeno-demo', 'standard', 1, 'مدیر دمو', ?)`,
      ).run(now)).lastInsertRowid,
    );
  }
  ctx.orgId = orgId;

  const groupIds = await mapSeq(GROUP_NAMES, async (name, i) =>
      Number(
        (await db.prepare(
          `INSERT INTO groups (name, slug, active, created_at, organization_id)
           VALUES (?, ?, 1, ?, ?)`,
        ).run(name, `demo-g${i + 1}`, now, orgId)).lastInsertRowid,
      ));
  ctx.ids.groupIds = groupIds;

  /* One hash for all seven. scrypt is deliberately slow, so hashing once and reusing the
     digest is the difference between a fast seed and a 30-second one — and every account
     sharing a password is the point of a demo. */
  const hash = hashPassword(PASSWORD);

  const insUser = db.prepare(
    `INSERT INTO users (username, password_hash, display_name, role, group_id,
                        organization_id, staff_code, phone, active, token_version, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?)`,
  );
  for (const s of STAFF) {
    const id = Number(
      (await insUser.run(
        s.username,
        hash,
        s.name,
        s.role,
        s.group === null ? null : groupIds[s.group],
        orgId,
        `DEMO-${s.role.slice(0, 3).toUpperCase()}`,
        `0912${String(1000000 + ctx.rng.int(0, 8999999)).slice(0, 7)}`,
        now,
      )).lastInsertRowid,
    );
    ctx.staff[s.role] = id;
    ctx.logins.push({ username: s.username, role: s.role, password: PASSWORD });
  }

  /* GONE: this used to DELETE the two facilities getDb() seeded on every boot -- the real
   * company's warehouse and its home base, written into lib/db.ts by address and pinned to
   * organization_id = 1. It had to, because in a throwaway demo the first organisation IS
   * the demo org, so real addresses appeared in a database whose entire purpose is
   * believable-but-not-real data. One of them was a residential address.
   *
   * The seed is gone, so there is nothing to purge: every facility in a demo database is
   * invented by the phases below. The "lat/lng are NOT NULL" note went with it. */

  const facilityId = Number(
    (await db.prepare(
      `INSERT INTO facilities (slug, kind, name, address, lat, lng, is_default_origin,
                               owner_username, created_at, updated_at, organization_id)
       VALUES ('demo-depot', 'warehouse', 'انبار مرکزی دمو', 'تهران، خیابان آزادی',
               35.7350, 51.4010, 1, 'demo.platform', ?, ?, ?)`,
    ).run(now, now, orgId)).lastInsertRowid,
  );
  ctx.ids.facility = facilityId;

  ctx.progress(
    `org ${orgId}, ${groupIds.length} groups, ${STAFF.length} logins, facility ${facilityId}`,
  );
}

