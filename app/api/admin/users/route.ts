import { NextRequest, NextResponse } from "next/server";
import { ROLES, type Role } from "@/lib/db";
import { groupExists } from "@/lib/repo/groupsAdmin";
import { insertUser, listUsers } from "@/lib/repo/usersAdmin";
import { hashPassword } from "@/lib/auth";
import { requireRole } from "@/lib/session";
import { OWNER_ROLES } from "@/lib/roles";
import { lastSignInByUser } from "@/lib/repo/loginEvents";

const MIN_PASSWORD = 8;

export async function GET(req: NextRequest) {
  const guard = requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;

  // Scoped to the caller's own company: the list carries telegram_chat_id, a live delivery address.
  const lastSignIn = lastSignInByUser(guard.session.organizationId);
  const users = listUsers(guard.session.organizationId).map((u) => ({ ...u, last_sign_in_at: lastSignIn.get(u.id as number) ?? null }));

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
  if (!/^[A-Za-z0-9._-]{3,40}$/.test(username)) {
    return NextResponse.json(
      { ok: false, error: "نام کاربری باید ۳ تا ۴۰ نویسه و فقط شامل حروف انگلیسی، عدد، نقطه، خط تیره یا زیرخط باشد" },
      { status: 400 }
    );
  }
  if (!displayName) return NextResponse.json({ ok: false, error: "نام نمایشی الزامی است" }, { status: 400 });
  if (displayName.length > 80) {
    return NextResponse.json({ ok: false, error: "نام نمایشی حداکثر ۸۰ نویسه است" }, { status: 400 });
  }
  if (password.length < MIN_PASSWORD) {
    return NextResponse.json({ ok: false, error: `رمز عبور باید حداقل ${MIN_PASSWORD} نویسه باشد` }, { status: 400 });
  }
  if (!ROLES.includes(role)) {
    return NextResponse.json({ ok: false, error: "نقش نامعتبر است" }, { status: 400 });
  }
  /* There is exactly ONE platform_owner, the founder, and his account is created by
   * scripts/create-user.mjs — never through this screen. The admin users table lists
   * platform_owner among its choices, so without this a second one is one click away, and
   * lib/impersonation.ts has no UNTOUCHABLE check left to stop it acting as anyone. */
  if (role === "platform_owner") {
    return NextResponse.json(
      { ok: false, error: "این نقش فقط برای بنیان‌گذار سامانه است" },
      { status: 400 }
    );
  }

  const groupId = Number.isInteger(body?.group_id) ? (body!.group_id as number) : null;
  // An owner is unscoped by design. A non-owner with no group reaches nothing at all --
  // scopeGroupIds returns [] and groupFilter becomes " AND 1 = 0" -- so the account would
  // log in successfully and then show an empty app. That is a bug, not a valid state.
  if (role !== "owner" && groupId === null) {
    return NextResponse.json({ ok: false, error: "برای این نقش، انتخاب گروه الزامی است" }, { status: 400 });
  }
  // The group must be this company's: a user placed in another tenant's group would read that tenant's data.
  if (groupId !== null && !groupExists(groupId, guard.session.organizationId)) {
    return NextResponse.json({ ok: false, error: "گروه پیدا نشد" }, { status: 400 });
  }

  const staffCode = typeof body?.staff_code === "string" && body.staff_code.trim() ? body.staff_code.trim() : null;
  const phone = typeof body?.phone === "string" && body.phone.trim() ? body.phone.trim() : null;

  try {
    const id = insertUser({
      username,
      passwordHash: hashPassword(password),
      displayName,
      role,
      groupId,
      staffCode,
      phone,
      organizationId: guard.session.organizationId,
    });
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطا";
    if (msg.includes("UNIQUE")) {
      return NextResponse.json({ ok: false, error: "این نام کاربری از قبل گرفته شده است" }, { status: 409 });
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
