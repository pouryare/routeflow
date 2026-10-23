/** Validation for an owner's edit of one account, apart from the HTTP handling: which columns change,
 *  what each is set to, and whether the change must end the person's existing sessions. Pure apart from
 *  the lookups it names (group, username and last-owner checks), so each rule can be read and tested on
 *  its own. */

import { ROLES, type Role, type UserRow } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { groupExists } from "@/lib/repo/groupsAdmin";
import { otherActiveOwners, usernameTakenInOrg } from "@/lib/repo/usersAdmin";

export const MIN_PASSWORD = 8;

export type UserPatchPlan =
  | { ok: true; sets: string[]; values: (string | number | null)[] }
  | { ok: false; error: string; status: number };

const fail = (error: string, status: number): UserPatchPlan => ({ ok: false, error, status });

/** Would this change leave this organisation with no active owner? (Another company's owners do not count.)
 *  The only way back from that is scripts/create-user.mjs over SSH. */
async function wouldStrandTheApp(target: UserRow, becomingNonOwner: boolean): Promise<boolean> {
  if (target.role !== "owner" || !target.active || !becomingNonOwner) return false;
  return await otherActiveOwners(target.id, target.organization_id) === 0;
}

export async function planUserPatch(
  body: Record<string, unknown> | null,
  target: UserRow,
  organizationId: number,
  actorId?: number
): Promise<UserPatchPlan> {
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
      return fail(`رمز عبور باید حداقل ${MIN_PASSWORD} نویسه باشد`, 400);
    }
    sets.push("password_hash = ?");
    values.push(hashPassword(password));
    // A password an owner set for someone else is a one-time key: they replace it at next
    // sign-in (F35). An owner changing their own here already chose it.
    if (target.id !== actorId) sets.push("must_change_password = 1");
    bumpVersion = true;
  }

  if (body?.display_name !== undefined) {
    const name = typeof body.display_name === "string" ? body.display_name.trim() : "";
    if (!name) return fail("نام نمایشی الزامی است", 400);
    sets.push("display_name = ?");
    values.push(name);
  }

  if (body?.username !== undefined) {
    const username = typeof body.username === "string" ? body.username.trim() : "";
    if (!username) return fail("نام کاربری الزامی است", 400);
    // Check for duplicate username within the same organization
    const existing = await usernameTakenInOrg(username, organizationId, target.id);
    if (existing) return fail("نام کاربری تکراری است", 409);
    sets.push("username = ?");
    values.push(username);
  }

  const nextRole = body?.role as Role | undefined;
  if (nextRole !== undefined) {
    if (!ROLES.includes(nextRole)) {
      return fail("نقش نامعتبر است", 400);
    }
    /* Same rule as the create route, and for the same reason: there is exactly one
       platform_owner and UNTOUCHABLE is gone from lib/impersonation.ts. Promoting a
       colleague here would hand them the ability to act as anyone in any tenant. */
    if (nextRole === "platform_owner") {
      return fail("این نقش فقط برای بنیان‌گذار سامانه است", 400);
    }
    if (await wouldStrandTheApp(target, nextRole !== "owner")) {
      return fail("این تنها مالک فعال است. اول یک مالک دیگر بسازید.", 409);
    }
    sets.push("role = ?");
    values.push(nextRole);
    bumpVersion = true;
  }

  if (body?.group_id !== undefined) {
    const groupId = Number.isInteger(body.group_id) ? (body.group_id as number) : null;
    if (groupId !== null && !await groupExists(groupId, organizationId)) {
      return fail("گروه پیدا نشد", 400);
    }
    sets.push("group_id = ?");
    values.push(groupId);
    bumpVersion = true;
  }

  // Checked after both, so "role and group in one request" is judged on the final state.
  const finalRole = nextRole ?? target.role;
  const finalGroup = body?.group_id !== undefined ? (Number.isInteger(body.group_id) ? (body.group_id as number) : null) : target.group_id;
  if (finalRole !== "owner" && finalGroup === null) {
    return fail("برای این نقش، انتخاب گروه الزامی است", 400);
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
      return fail("شناسه تلگرام باید عددی باشد", 400);
    }
    sets.push("telegram_chat_id = ?");
    values.push(chat);
    // An admin-set id supersedes any pending self-link; drop the stale nonce so a later
    // «/start» with it cannot rebind the account to a different chat.
    sets.push("telegram_link_nonce = NULL");
  }

  /* The photo a person's face is shown as, everywhere in the app.
   *
   *  Only ever an app-relative `/api/users/<id>/avatar` (optionally with a `?key=` preset
   *  query). An arbitrary URL is refused rather than sanitised: this column is rendered as
   *  an <img src> on every page showing a person, so accepting one would make every
   *  reader's browser fetch a third party on login, and a `javascript:` value would make
   *  the admin screen an XSS sink. Validating at the door is cheaper than defending the
   *  renderer.
   *
   *  An empty string clears it — the Avatar component's initials fallback is the correct
   *  answer for "we have no photo", and it says so honestly. */
  if (body?.avatar_url !== undefined) {
    const raw = typeof body.avatar_url === "string" ? body.avatar_url.trim() : "";
    if (raw === "") {
      sets.push("avatar_url = NULL");
    } else if (/^\/api\/users\/\d+\/avatar(\?[a-z0-9=&_-]*)?$/i.test(raw)) {
      sets.push("avatar_url = ?");
      values.push(raw);
    } else {
      return fail("نشانی تصویر نامعتبر است", 400);
    }
    /* No bumpVersion: a photo is not an authorisation surface, and bumping it would sign
     * everyone out of their session each time an owner tidied the staff list. */
  }

  if (body?.active !== undefined) {
    const active = body.active ? 1 : 0;
    if (!active && await wouldStrandTheApp(target, true)) {
      return fail("این تنها مالک فعال است. اول یک مالک دیگر بسازید.", 409);
    }
    sets.push("active = ?");
    values.push(active);
    bumpVersion = true;
  }

  if (sets.length === 0) {
    return fail("چیزی برای ذخیره نیست", 400);
  }
  if (bumpVersion) sets.push("token_version = token_version + 1");
  return { ok: true, sets, values };
}
