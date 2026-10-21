import type { FlowConfig, FlowContext, FlowOption } from "@/lib/crm/flows/types";
import { ROLE_LABEL, type Role } from "@/lib/roles";

/** Creating an account: pick the role, pick the group, type the person's name, optionally a phone.
 *  The username and the one-time password are made by the host (lib/credentials) and shown once on
 *  the done screen. Nothing here asks for a password.
 *
 *  An owner belongs to no group (the server requires a group for every other role), so choosing
 *  «owner» skips the group question. The platform owner is never offered: that account is made by
 *  a script, not a screen.
 *
 *  Contract with `userAddRequest`: values.role, values.group (id, absent for an owner),
 *  values.display_name, values.phone (optional); vars.username, vars.password; ctx.lists.group. */
type Vals = { values: Record<string, string> };

export const ASSIGNABLE_ROLES = (roles: readonly Role[]): Role[] => roles.filter((r) => r !== "platform_owner");

export function userAddFlow(roles: readonly Role[]): FlowConfig {
  return {
    id: "user_add",
    start: () => "role",
    budget: { common: 4, longest: 5 },
    steps: {
      role: {
        id: "role",
        kind: "choice",
        q: "این حساب برای چه نقشی است؟",
        options: ASSIGNABLE_ROLES(roles).map(
          (r): FlowOption => ({ id: r, label: ROLE_LABEL[r], put: { role: r }, next: r === "owner" ? "name" : "group" }),
        ),
      },
      group: {
        id: "group",
        kind: "choice",
        q: "در کدام گروه کار می‌کند؟",
        options: (ctx): FlowOption[] => (ctx.lists?.group ?? []).map((g) => ({ id: `g${g.id}`, label: g.label, put: { group: String(g.id) }, next: "name" })),
      },
      name: {
        id: "name",
        kind: "input",
        q: "نام او چیست؟",
        input: { field: "display_name", placeholder: "نام و نام خانوادگی" },
        options: [{ id: "ok", label: "ادامه", tone: "rec", next: "phone" }],
      },
      phone: {
        id: "phone",
        kind: "choice",
        q: "شمارهٔ تماس را ثبت کنیم؟",
        options: [
          { id: "addphone", label: "بله، شماره را وارد می‌کنم", next: "phonenum" },
          { id: "nophone", label: "بدون شماره", save: true },
        ],
      },
      phonenum: {
        id: "phonenum",
        kind: "input",
        q: "شمارهٔ تماس",
        input: { field: "phone", placeholder: "۰۹۱۲…", ltr: true },
        options: [{ id: "ok", label: "ثبت حساب", tone: "rec", save: true }],
      },
    },
  };
}

/** The body POST /api/admin/users expects. */
export function userAddRequest(ctx: FlowContext, st: Vals) {
  return {
    username: ctx.vars.username,
    password: ctx.vars.password,
    display_name: (st.values.display_name ?? "").trim(),
    role: st.values.role,
    group_id: st.values.group ? Number(st.values.group) : null,
    staff_code: null,
    phone: st.values.phone ? st.values.phone.trim() : null,
  };
}

/** What the new person is told: enough to sign in, nothing else. */
export function credentialsMessage(name: string, username: string, password: string): string {
  return `${name}\nنام کاربری: ${username}\nرمز عبور: ${password}`;
}

export function userAddChips(ctx: FlowContext, st: Vals): string[] {
  const group = (ctx.lists?.group ?? []).find((g) => String(g.id) === st.values.group)?.label;
  return [(st.values.display_name ?? "").trim(), ROLE_LABEL[st.values.role as Role] ?? "نامشخص", ...(group ? [group] : [])];
}
