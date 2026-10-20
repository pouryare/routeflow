"use client";

import { useRunAfterMount } from "@/lib/useRunAfterMount";
import { friendlyError } from "@/lib/userMessage";
import { Icon } from "@/components/meridian/Icon";
import { useCallback, useRef, useState } from "react";

import Avatar from "@/components/meridian/Avatar";
import { ROLE_LABEL, ROLES, type Role } from "@/lib/roles";
import { faJalaliDate } from "@/lib/jalali";

interface UserRow {
  id: number;
  username: string;
  display_name: string;
  role: Role;
  group_id: number | null;
  group_name: string | null;
  staff_code: string | null;
  phone: string | null;
  telegram_chat_id: string | null;
  active: number;
  location_consent_at: string | null;
  created_at: string;
  /** The avatar route to render, or null for the initials fallback. */
  avatar_url: string | null;
}

interface GroupRow {
  id: number;
  name: string;
}

/** The admin-driven half of telegram linking: a user who cannot manage their own
 *  «/start» deep link gets their chat id pasted in here instead. Uncontrolled and saved on
 *  blur — a controlled input would re-render the whole table on every keystroke, and a
 *  save per keystroke would PATCH a dozen half-typed ids. `key` on the value means a row
 *  reloaded from the server re-seeds the field instead of holding a stale edit. */
function TelegramCell({ user, onSave }: { user: UserRow; onSave: (v: string | null) => Promise<boolean> }) {
  const current = user.telegram_chat_id ?? "";
  return (
    <input
      key={current}
      defaultValue={current}
      dir="ltr"
      inputMode="numeric"
      placeholder="—"
      aria-label={`شناسه تلگرام ${user.display_name}`}
      onBlur={(e) => {
        const v = e.target.value.trim();
        if (v === current) return;
        onSave(v || null);
      }}
      className="w-32 rounded-md border border-border bg-surface-raised px-2 py-1 text-left font-mono text-xs text-text outline-none placeholder:text-text-faint focus:border-accent"
    />
  );
}

/** The five portraits `scripts/seed-avatars.mjs` encoded from `public/avatars/`. Kept in
 *  sync by hand with `AVATAR_PRESETS` in lib/avatarStore — a mismatch shows as a 404 on
 *  one thumbnail, not as an error. */
const PRESETS = [
  { key: "hossein", label_fa: "حسین" },
  { key: "maryam", label_fa: "مریم" },
  { key: "reza", label_fa: "رضا" },
  { key: "saeed", label_fa: "سعید" },
  { key: "zahra", label_fa: "زهرا" },
];

/** Give one person a real face.
 *
 *  Three deliberate details. The preset grid uses the same `<picture>` chain as an upload —
 *  one avatar, one set of encodings, no second code path to keep in step. "حذف عکس" exists
 *  because `Avatar` falls back to initials BY DESIGN: a missing photo is a fact about the
 *  record, so an owner who picks the wrong picture needs an undo that is not a database
 *  edit. And clearing sends `""`, which the PATCH turns into NULL — never a sentinel
 *  string, because a sentinel is a value some later query has to know about. */
function AvatarCell({
  user,
  onSave,
}: {
  user: UserRow;
  onSave: (v: string | null) => Promise<boolean>;
}) {
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function upload(file: File) {
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("user_id", String(user.id));
      const res = await fetch("/api/photos/avatar", { method: "POST", body: form });
      // The upload route already wrote the row, so on failure there is nothing to undo
      // here; on success the value is already correct and this is belt-and-braces for the
      // case where the row was edited between the two requests.
      await onSave(res.ok ? `/api/users/${user.id}/avatar` : null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Avatar userId={user.id} name={user.display_name} src={user.avatar_url} size={34} />
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`انتخاب عکس برای ${user.display_name}`}
        className="flex cursor-pointer items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-text transition-colors hover:border-accent"
      >
        <Icon name="camera" size="md" />
        انتخاب
      </button>
      {open ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-2">
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => onSave(`/api/users/${user.id}/avatar?key=${p.key}`)}
                className="cursor-pointer overflow-hidden rounded-lg border border-border transition-colors hover:border-accent"
                title={p.label_fa}
                aria-label={`عکس ${p.label_fa} برای ${user.display_name}`}
              >
                <picture>
                  <source
                    srcSet={`/api/users/${user.id}/avatar?key=${p.key}&format=avif`}
                    type="image/avif"
                  />
                  {/* Plain <img>: these are 40px thumbnails of files this app already serves
                      in exactly the right size, so the optimiser would cost a request to
                      resize nothing. Exempted in eslint.config.mjs, not silenced inline. */}
                  <img
                    src={`/api/users/${user.id}/avatar?key=${p.key}&format=webp`}
                    alt={p.label_fa}
                    width={40}
                    height={40}
                    className="block h-10 w-10 object-cover"
                  />
                </picture>
              </button>
            ))}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            aria-label={`بارگذاری عکس برای ${user.display_name}`}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
              e.target.value = "";
            }}
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              className="cursor-pointer rounded-md border border-border px-2 py-1 text-xs text-text transition-colors hover:border-accent disabled:opacity-50"
            >
              <Icon name="image" size="md" />
              {busy ? "در حال بارگذاری…" : "بارگذاری عکس"}
            </button>
            {user.avatar_url ? (
              <button
                type="button"
                onClick={() => onSave("")}
                className="cursor-pointer rounded-md border border-border px-2 py-1 text-xs text-text-muted transition-colors hover:border-crit"
              >
                <Icon name="trash" size="md" />
                حذف عکس
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
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

  useRunAfterMount(load);

  async function send(url: string, method: string, payload: unknown): Promise<boolean> {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      setError(friendlyError(data.error, "کاربر ذخیره نشد؛ دوباره تلاش کنید"));
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

  /** The account whose password is being replaced, with the text typed so far. An in-page,
   *  masked field rather than a browser prompt: a prompt shows what is typed in the clear. */
  const [resetting, setResetting] = useState<{ id: number; name: string; pw: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function resetPassword(u: { id: number; name: string }, pw: string) {
    if (!pw) return;
    if (await send(`/api/admin/users/${u.id}`, "PATCH", { password: pw })) {
      setResetting(null);
      setNotice(`رمز «${u.name}» عوض شد. نشست‌های قبلی این کاربر بی‌اعتبار شدند.`);
    }
  }

  return (
    <>
    <div className="flex flex-col gap-[var(--space-4)]">

      {error && (
        <p role="alert" className="rounded-md border border-crit/40 bg-crit/10 px-3 py-2 text-sm text-crit">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-md border border-good/40 bg-good/10 px-3 py-2 text-sm text-good">
          {notice}
        </p>
      )}

      <form onSubmit={create} className="rounded-lg border border-border bg-surface p-4">
        <h2 className="sechead__title mb-3">حساب تازه</h2>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <label className="flex flex-col gap-1 text-xs text-text-muted">نام نمایشی<input
            value={form.display_name}
            onChange={(e) => setForm({ ...form, display_name: e.target.value })}
           
            className="rounded-md border border-border bg-surface-raised px-3 py-2 text-right text-sm text-text outline-none placeholder:text-text-faint focus:border-accent w-full"
          /></label>
          <label className="flex flex-col gap-1 text-xs text-text-muted">نام کاربری<input
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
           
            dir="ltr"
            className="rounded-md border border-border bg-surface-raised px-3 py-2 text-left font-mono text-sm text-text outline-none placeholder:text-text-faint focus:border-accent w-full"
          /></label>
          <label className="flex flex-col gap-1 text-xs text-text-muted">رمز عبور<input
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            placeholder="حداقل ۸ نویسه"
            type="password"
            dir="ltr"
            className="rounded-md border border-border bg-surface-raised px-3 py-2 text-left font-mono text-sm text-text outline-none placeholder:text-text-faint focus:border-accent w-full"
          /></label>
          <label className="flex flex-col gap-1 text-xs text-text-muted">نقش<select
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
            className="w-full rounded-md border border-border bg-surface-raised px-3 py-2 text-sm text-text outline-none focus:border-accent"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>{ROLE_LABEL[r]}</option>
            ))}
          </select></label>
          <label className="flex flex-col gap-1 text-xs text-text-muted">گروه<select
            value={form.group_id}
            onChange={(e) => setForm({ ...form, group_id: e.target.value })}
            disabled={form.role === "owner"}
            className="w-full rounded-md border border-border bg-surface-raised px-3 py-2 text-sm text-text outline-none focus:border-accent disabled:opacity-40"
          >
            <option value="">{form.role === "owner" ? "بدون گروه (مالک)" : "گروه را انتخاب کنید"}</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select></label>
          <label className="flex flex-col gap-1 text-xs text-text-muted">شناسه همکار<input
            value={form.staff_code}
            onChange={(e) => setForm({ ...form, staff_code: e.target.value })}
           
            dir="ltr"
            className="rounded-md border border-border bg-surface-raised px-3 py-2 text-left font-mono text-sm text-text outline-none placeholder:text-text-faint focus:border-accent w-full"
          /></label>
        </div>
        <button
          type="submit"
          disabled={busy}
          className="inline-flex items-center justify-center gap-[var(--space-2)] mt-3 cursor-pointer rounded-md border border-accent bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition-[filter,opacity] hover:enabled:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Icon name="plus" size="md" />
          ساخت حساب
        </button>
      </form>

      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="sechead__title mb-3">حساب‌ها</h2>
        {users === null ? (
          <p className="text-sm text-text-muted">در حال بارگذاری…</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-3xl text-right text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-text-muted">
                  <th className="p-2 font-normal">عکس</th>
                  <th className="p-2 font-normal">نام</th>
                  <th className="p-2 font-normal">نام کاربری</th>
                  <th className="p-2 font-normal">نقش</th>
                  <th className="p-2 font-normal">گروه</th>
                  <th className="p-2 font-normal">شناسه همکار</th>
                  <th className="p-2 font-normal">تلگرام</th>
                  <th className="p-2 font-normal">اجازه موقعیت</th>
                  <th className="p-2 font-normal">وضعیت</th>
                  <th className="p-2 font-normal">کارها</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className={`border-b border-border last:border-b-0 ${u.active ? "" : "opacity-50"}`}>
                    <td className="p-2">
                      <AvatarCell
                        user={u}
                        onSave={(v) => send(`/api/admin/users/${u.id}`, "PATCH", { avatar_url: v ?? "" })}
                      />
                    </td>
                    <td className="p-2">
                      <input
                        key={u.display_name}
                        defaultValue={u.display_name}
                        dir="rtl"
                        placeholder="—"
                        aria-label={`نام نمایشی ${u.display_name}`}
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v === u.display_name) return;
                          send(`/api/admin/users/${u.id}`, "PATCH", { display_name: v });
                        }}
                        className="w-32 rounded-md border border-border bg-surface-raised px-2 py-1 text-right text-xs text-text outline-none placeholder:text-text-faint focus:border-accent"
                      />
                    </td>
                    <td className="p-2">
                      <input
                        key={u.username}
                        defaultValue={u.username}
                        dir="ltr"
                        placeholder="—"
                        aria-label={`نام کاربری ${u.username}`}
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v === u.username) return;
                          send(`/api/admin/users/${u.id}`, "PATCH", { username: v });
                        }}
                        className="w-28 rounded-md border border-border bg-surface-raised px-2 py-1 text-left font-mono text-xs text-text outline-none placeholder:text-text-faint focus:border-accent"
                      />
                    </td>
                    <td className="p-2">
                      <select
                        value={u.role}
                        onChange={(e) =>
                          send(`/api/admin/users/${u.id}`, "PATCH", { role: e.target.value })
                        }
                        className="rounded-md border border-border bg-surface-raised px-2 py-1 text-xs text-text outline-none focus:border-accent"
                      >
                        {ROLES.map((r) => (
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
                    <td className="p-2">
                      <input
                        key={u.staff_code ?? ""}
                        defaultValue={u.staff_code ?? ""}
                        dir="ltr"
                        placeholder="—"
                        aria-label={`شناسه همکار ${u.display_name}`}
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v === (u.staff_code ?? "")) return;
                          send(`/api/admin/users/${u.id}`, "PATCH", { staff_code: v || null });
                        }}
                        className="w-24 rounded-md border border-border bg-surface-raised px-2 py-1 text-left font-mono text-xs text-text outline-none placeholder:text-text-faint focus:border-accent"
                      />
                    </td>
                    <td className="p-2">
                      <TelegramCell
                        user={u}
                        onSave={(v) => send(`/api/admin/users/${u.id}`, "PATCH", { telegram_chat_id: v })}
                      />
                    </td>
                    {/* Unused until Phase 2, but showing it now costs nothing and makes
                        the consent state visible before anything depends on it. */}
                    <td className="p-2 font-mono text-xs text-text-muted">
                      {u.location_consent_at ? faJalaliDate(u.location_consent_at) : "—"}
                    </td>
                    <td className="p-2 text-xs">
                      <span className={u.active ? "text-good" : "text-neutral"}>
                        {u.active ? "فعال" : "غیرفعال"}
                      </span>
                    </td>
                    <td className="p-2">
                      <div className="flex gap-2 text-xs">
                        {resetting?.id === u.id ? (
                          <span className="flex flex-wrap items-center gap-2">
                            <input
                              type="password"
                              autoComplete="new-password"
                              autoFocus
                              value={resetting.pw}
                              onChange={(e) => setResetting({ ...resetting, pw: e.target.value })}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") void resetPassword(resetting, resetting.pw);
                                if (e.key === "Escape") setResetting(null);
                              }}
                              placeholder="رمز تازه (حداقل ۸ نویسه)" aria-label={`رمز تازه برای ${u.display_name}`}
                              className="rounded border border-border bg-bg px-2 py-1 text-sm"
                            />
                            <button
                              type="button"
                              onClick={() => void resetPassword(resetting, resetting.pw)}
                              className="cursor-pointer text-accent transition-colors hover:underline"
                            >
                              <Icon name="check" size="md" />
                              ذخیرهٔ رمز تازه
                            </button>
                            <button
                              type="button"
                              onClick={() => setResetting(null)}
                              className="cursor-pointer text-text-muted transition-colors hover:text-text"
                            >
                              <Icon name="x" size="md" />
                              انصراف از تغییر رمز
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => { setNotice(null); setResetting({ id: u.id, name: u.display_name, pw: "" }); }}
                            className="cursor-pointer text-text-muted transition-colors hover:text-accent"
                          >
                            <Icon name="undo" size="md" />
                            تعیین رمز تازه
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => send(`/api/admin/users/${u.id}`, "PATCH", { active: !u.active })}
                          className="cursor-pointer text-text-muted transition-colors hover:text-crit"
                        >
                          <Icon name="ban" size="md" />
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
    </div>    </>
  );
}
