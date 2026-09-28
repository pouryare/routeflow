import { NextRequest, NextResponse } from "next/server";
import { getDb, ROLES, type Role } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { requireRole } from "@/lib/session";
import { OWNER_ROLES } from "@/lib/roles";

const MIN_PASSWORD = 8;

export async function GET(req: NextRequest) {
  const guard = requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;

  // Never password_hash. It is a scrypt digest rather than a password, but there is no
  // reason for it to cross the wire and every reason for it not to.
  //
  // Scoped to the caller's own tenant. This list was unscoped before Phase 2 -- tolerable
  // while every column was local bookkeeping, not once it carries telegram_chat_id, which
  // is a live delivery address for another tenant's staff.
  const users = getDb()
    .prepare(
      `SELECT u.id, u.username, u.display_name, u.role, u.group_id, u.staff_code, u.phone,
              u.telegram_chat_id, u.active, u.location_consent_at, u.created_at, g.name AS group_name
       FROM users u LEFT JOIN groups g ON g.id = u.group_id
       WHERE u.organization_id = ?
       ORDER BY u.active DESC, u.display_name`
    )
    .all(guard.session.organizationId) as unknown as Record<string, unknown>[];

  return NextResponse.json({ ok: true, users, roles: ROLES });
}

export async function POST(req: NextRequest) {
  const guard = requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const username = typeof body?.username === "string" ? body.username.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const displayName = typeof body?.display_name === "string" ? body.display_name.trim() : "";
  const role = body?.role as Role;

  if (!username) return NextResponse.json({ ok: false, error: "نام کاربری الزامی است" }, { status: 400 });
  if (!displayName) return NextResponse.json({ ok: false, error: "نام نمایشی الزامی است" }, { status: 400 });
  if (password.length < MIN_PASSWORD) {
    return NextResponse.json({ ok: false, error: `رمز عبور باید حداقل ${MIN_PASSWORD} نویسه باشد` }, { status: 400 });
  }
  if (!ROLES.includes(role)) {
    return NextResponse.json({ ok: false, error: "نقش نامعتبر است" }, { status: 400 });
  }

  const groupId = Number.isInteger(body?.group_id) ? (body!.group_id as number) : null;
  // An owner is unscoped by design. A non-owner with no group reaches nothing at all --
  // scopeGroupIds returns [] and groupFilter becomes " AND 1 = 0" -- so the account would
  // log in successfully and then show an empty app. That is a bug, not a valid state.
  if (role !== "owner" && groupId === null) {
    return NextResponse.json({ ok: false, error: "برای این نقش، انتخاب گروه الزامی است" }, { status: 400 });
  }
  const db = getDb();
  if (groupId !== null && !db.prepare("SELECT 1 FROM groups WHERE id = ?").get(groupId)) {
    return NextResponse.json({ ok: false, error: "گروه پیدا نشد" }, { status: 400 });
  }

  const staffCode = typeof body?.staff_code === "string" && body.staff_code.trim() ? body.staff_code.trim() : null;
  const phone = typeof body?.phone === "string" && body.phone.trim() ? body.phone.trim() : null;

  try {
    // organization_id was missing here: a user created through this screen landed with a
    // NULL tenant and was only rescued by getDb()'s NULL -> 1 backfill on the next boot.
    // Harmless with one tenant, wrong with two -- and now load-bearing, because the list
    // and the edit routes above are tenant-scoped.
    const result = db
      .prepare(
        `INSERT INTO users (username, password_hash, display_name, role, group_id, staff_code, phone, active, token_version, created_at, organization_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`
      )
      .run(
        username,
        hashPassword(password),
        displayName,
        role,
        groupId,
        staffCode,
        phone,
        new Date().toISOString(),
        guard.session.organizationId
      );
    return NextResponse.json({ ok: true, id: Number(result.lastInsertRowid) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطا";
    if (msg.includes("UNIQUE")) {
      return NextResponse.json({ ok: false, error: "این نام کاربری از قبل گرفته شده است" }, { status: 409 });
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
