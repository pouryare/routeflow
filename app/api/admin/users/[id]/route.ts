import { NextRequest, NextResponse } from "next/server";
import { getDb, ROLES, type Role, type UserRow } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { requireRole } from "@/lib/session";
import { OWNER_ROLES } from "@/lib/roles";

const MIN_PASSWORD = 8;

/** Would this change leave the app with no active owner?
 *
 *  The only way back from that is scripts/create-user.mjs over SSH, so it is worth one
 *  extra query on every account edit. */
function wouldStrandTheApp(db: ReturnType<typeof getDb>, target: UserRow, becomingNonOwner: boolean): boolean {
  if (target.role !== "owner" || !target.active || !becomingNonOwner) return false;
  const { n } = db
    .prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'owner' AND active = 1 AND id != ?")
    .get(target.id) as { n: number };
  return n === 0;
}

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/admin/users/[id]">) {
  const guard = requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  const userId = Number(id);
  if (!Number.isInteger(userId)) {
    return NextResponse.json({ ok: false, error: "شناسه نامعتبر است" }, { status: 400 });
  }

  const db = getDb();
  // Tenant-scoped: an owner administers their own organisation's staff and no one else's.
  // A cross-tenant id now reads as "not found" rather than becoming an editable row --
  // which from Phase 2 on would include rebinding that user's telegram delivery address.
  const target = db
    .prepare("SELECT * FROM users WHERE id = ? AND organization_id = ?")
    .get(userId, guard.session.organizationId) as UserRow | undefined;
  if (!target) return NextResponse.json({ ok: false, error: "کاربر پیدا نشد" }, { status: 404 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const sets: string[] = [];
  const values: (string | number | null)[] = [];

  // token_version is the whole revocation mechanism: a token lives 30 days, and
  // getSession() rejects one whose tv no longer matches the row. Every change below that
  // alters what an existing session may do has to bump it, or a password reset leaves the
  // old session working for a month and a deactivation does nothing at all.
  let bumpVersion = false;

  if (body?.password !== undefined) {
    const password = typeof body.password === "string" ? body.password : "";
    if (password.length < MIN_PASSWORD) {
      return NextResponse.json({ ok: false, error: `رمز عبور باید حداقل ${MIN_PASSWORD} نویسه باشد` }, { status: 400 });
    }
    sets.push("password_hash = ?");
    values.push(hashPassword(password));
    bumpVersion = true;
  }

  if (body?.display_name !== undefined) {
    const name = typeof body.display_name === "string" ? body.display_name.trim() : "";
    if (!name) return NextResponse.json({ ok: false, error: "نام نمایشی الزامی است" }, { status: 400 });
    sets.push("display_name = ?");
    values.push(name);
  }

  if (body?.username !== undefined) {
    const username = typeof body.username === "string" ? body.username.trim() : "";
    if (!username) return NextResponse.json({ ok: false, error: "نام کاربری الزامی است" }, { status: 400 });
    // Check for duplicate username within the same organization
    const existing = db
      .prepare("SELECT 1 FROM users WHERE username = ? AND organization_id = ? AND id != ?")
      .get(username, guard.session.organizationId, userId);
    if (existing) return NextResponse.json({ ok: false, error: "نام کاربری تکراری است" }, { status: 409 });
    sets.push("username = ?");
    values.push(username);
  }

  const nextRole = body?.role as Role | undefined;
  if (nextRole !== undefined) {
    if (!ROLES.includes(nextRole)) {
      return NextResponse.json({ ok: false, error: "نقش نامعتبر است" }, { status: 400 });
    }
    /* Same rule as the create route, and for the same reason: there is exactly one
       platform_owner and UNTOUCHABLE is gone from lib/impersonation.ts. Promoting a
       colleague here would hand them the ability to act as anyone in any tenant. */
    if (nextRole === "platform_owner") {
      return NextResponse.json(
        { ok: false, error: "این نقش فقط برای بنیان‌گذار سامانه است" },
        { status: 400 }
      );
    }
    if (wouldStrandTheApp(db, target, nextRole !== "owner")) {
      return NextResponse.json(
        { ok: false, error: "این تنها مالک فعال است. اول یک مالک دیگر بسازید." },
        { status: 409 }
      );
    }
    sets.push("role = ?");
    values.push(nextRole);
    bumpVersion = true;
  }

  if (body?.group_id !== undefined) {
    const groupId = Number.isInteger(body.group_id) ? (body.group_id as number) : null;
    if (groupId !== null && !db.prepare("SELECT 1 FROM groups WHERE id = ?").get(groupId)) {
      return NextResponse.json({ ok: false, error: "گروه پیدا نشد" }, { status: 400 });
    }
    sets.push("group_id = ?");
    values.push(groupId);
    bumpVersion = true;
  }

  // Checked after both, so "role and group in one request" is judged on the final state.
  const finalRole = nextRole ?? target.role;
  const finalGroup = body?.group_id !== undefined ? (Number.isInteger(body.group_id) ? (body.group_id as number) : null) : target.group_id;
  if (finalRole !== "owner" && finalGroup === null) {
    return NextResponse.json({ ok: false, error: "برای این نقش، انتخاب گروه الزامی است" }, { status: 400 });
  }

  if (body?.staff_code !== undefined) {
    const code = typeof body.staff_code === "string" && body.staff_code.trim() ? body.staff_code.trim() : null;
    sets.push("staff_code = ?");
    values.push(code);
  }
  if (body?.phone !== undefined) {
    const phone = typeof body.phone === "string" && body.phone.trim() ? body.phone.trim() : null;
    sets.push("phone = ?");
    values.push(phone);
  }

  // The second way to bind a telegram account, alongside the user's own «/start <nonce>»
  // deep link: an owner can paste an id straight in for someone who cannot manage it
  // themselves. Ids are numeric, and a group or channel id is negative -- hence the
  // optional leading minus. No `bumpVersion`: the chat id gates no session.
  if (body?.telegram_chat_id !== undefined) {
    const raw = typeof body.telegram_chat_id === "string" ? body.telegram_chat_id.trim() : "";
    const chat = raw === "" ? null : raw;
    if (chat !== null && !/^-?\d{1,20}$/.test(chat)) {
      return NextResponse.json({ ok: false, error: "شناسه تلگرام باید عددی باشد" }, { status: 400 });
    }
    sets.push("telegram_chat_id = ?");
    values.push(chat);
    // An admin-set id supersedes any pending self-link; drop the stale nonce so a later
    // «/start» with it cannot rebind the account to a different chat.
    sets.push("telegram_link_nonce = NULL");
  }

  if (body?.active !== undefined) {
    const active = body.active ? 1 : 0;
    if (!active && wouldStrandTheApp(db, target, true)) {
      return NextResponse.json(
        { ok: false, error: "این تنها مالک فعال است. اول یک مالک دیگر بسازید." },
        { status: 409 }
      );
    }
    sets.push("active = ?");
    values.push(active);
    bumpVersion = true;
  }

  if (sets.length === 0) {
    return NextResponse.json({ ok: false, error: "چیزی برای ذخیره نیست" }, { status: 400 });
  }
  if (bumpVersion) sets.push("token_version = token_version + 1");

  values.push(userId);
  try {
    db.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).run(...(values as never[]));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطا";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: RouteContext<"/api/admin/users/[id]">) {
  const guard = requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  const userId = Number(id);
  if (!Number.isInteger(userId)) {
    return NextResponse.json({ ok: false, error: "شناسه نامعتبر است" }, { status: 400 });
  }

  const db = getDb();
  // Same tenant scoping as PATCH -- deactivating is at least as consequential as editing.
  const target = db
    .prepare("SELECT * FROM users WHERE id = ? AND organization_id = ?")
    .get(userId, guard.session.organizationId) as UserRow | undefined;
  if (!target) return NextResponse.json({ ok: false, error: "کاربر پیدا نشد" }, { status: 404 });

  if (wouldStrandTheApp(db, target, true)) {
    return NextResponse.json(
      { ok: false, error: "این تنها مالک فعال است. اول یک مالک دیگر بسازید." },
      { status: 409 }
    );
  }

  // Deactivate, never delete. activity_log.changed_by_user_id points at this row, and
  // history that says who did what is worth more than a tidy table. The bump is what
  // actually ends their session.
  db.prepare("UPDATE users SET active = 0, token_version = token_version + 1 WHERE id = ?").run(userId);
  return NextResponse.json({ ok: true, deactivated: true });
}
