"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { faDate } from "@/lib/format";

type Role = "owner" | "group_manager" | "driver";

const ROLE_LABEL: Record<Role, string> = {
  owner: "مالک",
  group_manager: "مدیر گروه",
  driver: "راننده",
};

interface UserRow {
  id: number;
  username: string;
  display_name: string;
  role: Role;
  group_id: number | null;
  group_name: string | null;
  staff_code: string | null;
  phone: string | null;
  active: number;
  location_consent_at: string | null;
  created_at: string;
}

interface GroupRow {
  id: number;
  name: string;
}

const EMPTY = {
  username: "",
  password: "",
  display_name: "",
  role: "driver" as Role,
  group_id: "" as string,
  staff_code: "",
  phone: "",
};

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [uRes, gRes] = await Promise.all([fetch("/api/admin/users"), fetch("/api/admin/groups")]);
    const uData = await uRes.json();
    const gData = await gRes.json();
    setUsers(uData.users ?? []);
    setGroups(gData.groups ?? []);
  }, []);

  useEffect(() => {
    // See the note on the groups page: the setState calls run in load()'s async
    // continuation, which the rule cannot see through.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function send(url: string, method: string, payload: unknown): Promise<boolean> {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      setError(data.error || "انجام نشد");
      return false;
    }
    setError(null);
    await load();
    return true;
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const ok = await send("/api/admin/users", "POST", {
        ...form,
        group_id: form.group_id === "" ? null : Number(form.group_id),
        staff_code: form.staff_code || null,
        phone: form.phone || null,
      });
      if (ok) setForm(EMPTY);
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword(u: UserRow) {
    const pw = window.prompt(`رمز تازه برای «${u.display_name}» (حداقل ۸ نویسه)`);
    if (!pw) return;
    if (await send(`/api/admin/users/${u.id}`, "PATCH", { password: pw })) {
      window.alert("رمز عوض شد. نشست‌های قبلی این کاربر بی‌اعتبار شدند.");
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <div>
          <div className="mb-1 font-mono text-xs tracking-[0.12em] text-accent uppercase">Admin</div>
          <h1 className="text-xl font-bold text-text">حساب‌های کاربری</h1>
        </div>
        <div className="flex gap-3 text-sm text-text-muted">
          <Link href="/admin/groups" className="transition-colors hover:text-accent">گروه‌ها</Link>
          <Link href="/" className="transition-colors hover:text-accent">بازگشت به نقشه</Link>
        </div>
      </header>

      {error && (
        <p role="alert" className="rounded-md border border-crit/40 bg-crit/10 px-3 py-2 text-sm text-crit">
          {error}
        </p>
      )}

      <form onSubmit={create} className="rounded-lg border border-border bg-surface p-4">
        <h2 className="mb-3 text-base font-bold text-text">حساب تازه</h2>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <input
            value={form.display_name}
            onChange={(e) => setForm({ ...form, display_name: e.target.value })}
            placeholder="نام نمایشی"
            className="rounded-md border border-border bg-surface-raised px-3 py-2 text-right text-sm text-text outline-none placeholder:text-text-faint focus:border-accent"
          />
          <input
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
            placeholder="نام کاربری"
            dir="ltr"
            className="rounded-md border border-border bg-surface-raised px-3 py-2 text-left font-mono text-sm text-text outline-none placeholder:text-text-faint focus:border-accent"
          />
          <input
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            placeholder="رمز عبور (حداقل ۸ نویسه)"
            type="password"
            dir="ltr"
            className="rounded-md border border-border bg-surface-raised px-3 py-2 text-left font-mono text-sm text-text outline-none placeholder:text-text-faint focus:border-accent"
          />
          <select
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
            className="rounded-md border border-border bg-surface-raised px-3 py-2 text-sm text-text outline-none focus:border-accent"
          >
            {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
              <option key={r} value={r}>{ROLE_LABEL[r]}</option>
            ))}
          </select>
          <select
            value={form.group_id}
            onChange={(e) => setForm({ ...form, group_id: e.target.value })}
            disabled={form.role === "owner"}
            className="rounded-md border border-border bg-surface-raised px-3 py-2 text-sm text-text outline-none focus:border-accent disabled:opacity-40"
          >
            <option value="">{form.role === "owner" ? "بدون گروه (مالک)" : "گروه را انتخاب کنید"}</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
          <input
            value={form.staff_code}
            onChange={(e) => setForm({ ...form, staff_code: e.target.value })}
            placeholder="شناسه همکار در اکسل"
            dir="ltr"
            className="rounded-md border border-border bg-surface-raised px-3 py-2 text-left font-mono text-sm text-text outline-none placeholder:text-text-faint focus:border-accent"
          />
        </div>
        <p className="mt-2 text-xs text-text-faint">
          «شناسه همکار در اکسل» باید دقیقاً با ستون شناسه در شیت همکاران یکی باشد — کلید اتصال
          پورسانت همین است.
        </p>
        <button
          type="submit"
          disabled={busy}
          className="mt-3 cursor-pointer rounded-md border border-accent bg-accent px-4 py-2 text-sm font-medium text-[#04191c] transition-[filter,opacity] hover:enabled:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
        >
          ساخت حساب
        </button>
      </form>

      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="mb-3 text-base font-bold text-text">حساب‌ها</h2>
        {users === null ? (
          <p className="text-sm text-text-muted">در حال بارگذاری…</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-3xl text-right text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-text-muted">
                  <th className="p-2 font-normal">نام</th>
                  <th className="p-2 font-normal">نام کاربری</th>
                  <th className="p-2 font-normal">نقش</th>
                  <th className="p-2 font-normal">گروه</th>
                  <th className="p-2 font-normal">شناسه اکسل</th>
                  <th className="p-2 font-normal">اجازه موقعیت</th>
                  <th className="p-2 font-normal">وضعیت</th>
                  <th className="p-2 font-normal">کارها</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className={`border-b border-border last:border-b-0 ${u.active ? "" : "opacity-50"}`}>
                    <td className="p-2 text-text">{u.display_name}</td>
                    <td className="p-2 text-left font-mono text-xs text-text-muted" dir="ltr">{u.username}</td>
                    <td className="p-2">
                      <select
                        value={u.role}
                        onChange={(e) =>
                          send(`/api/admin/users/${u.id}`, "PATCH", { role: e.target.value })
                        }
                        className="rounded-md border border-border bg-surface-raised px-2 py-1 text-xs text-text outline-none focus:border-accent"
                      >
                        {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
                          <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                        ))}
                      </select>
                    </td>
                    <td className="p-2">
                      <select
                        value={u.group_id ?? ""}
                        onChange={(e) =>
                          send(`/api/admin/users/${u.id}`, "PATCH", {
                            group_id: e.target.value === "" ? null : Number(e.target.value),
                          })
                        }
                        className="rounded-md border border-border bg-surface-raised px-2 py-1 text-xs text-text outline-none focus:border-accent"
                      >
                        <option value="">—</option>
                        {groups.map((g) => (
                          <option key={g.id} value={g.id}>{g.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="p-2 text-left font-mono text-xs text-text-muted" dir="ltr">
                      {u.staff_code ?? "—"}
                    </td>
                    {/* Unused until Phase 2, but showing it now costs nothing and makes
                        the consent state visible before anything depends on it. */}
                    <td className="p-2 font-mono text-xs text-text-muted">
                      {u.location_consent_at ? faDate(u.location_consent_at) : "—"}
                    </td>
                    <td className="p-2 text-xs">
                      <span className={u.active ? "text-good" : "text-neutral"}>
                        {u.active ? "فعال" : "غیرفعال"}
                      </span>
                    </td>
                    <td className="p-2">
                      <div className="flex gap-2 text-xs">
                        <button
                          type="button"
                          onClick={() => resetPassword(u)}
                          className="cursor-pointer text-text-muted transition-colors hover:text-accent"
                        >
                          رمز تازه
                        </button>
                        <button
                          type="button"
                          onClick={() => send(`/api/admin/users/${u.id}`, "PATCH", { active: !u.active })}
                          className="cursor-pointer text-text-muted transition-colors hover:text-crit"
                        >
                          {u.active ? "غیرفعال کردن" : "فعال کردن"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-text-faint">
          با تغییر رمز، نقش، گروه یا غیرفعال کردن یک حساب، نشست‌های باز آن کاربر بلافاصله
          بی‌اعتبار می‌شوند.
        </p>
      </section>
    </main>
  );
}
