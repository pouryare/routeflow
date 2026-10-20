"use client";

import { useRunAfterMount } from "@/lib/useRunAfterMount";
import { friendlyError } from "@/lib/userMessage";
import { Icon } from "@/components/meridian/Icon";
import { useCallback, useState } from "react";
import GroupTerritoryEditor from "@/components/GroupTerritoryEditor";
import type { DistrictProperties } from "@/lib/types";
import { faNum } from "@/lib/format";

interface GroupRow {
  id: number;
  name: string;
  slug: string;
  color: string | null;
  active: number;
  district_count: number;
  user_count: number;
}

export default function AdminGroupsPage() {
  const [groups, setGroups] = useState<GroupRow[] | null>(null);
  const [palette, setPalette] = useState<string[]>([]);
  const [districts, setDistricts] = useState<DistrictProperties[]>([]);
  const [name, setName] = useState("");
  // Deleting a group cannot be undone, so it takes a second tap on an explicitly worded button.
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  // The group being renamed, with the name as typed. An in-page form, not a browser prompt,
  // so its buttons can say what they do.
  const [renaming, setRenaming] = useState<{ id: number; name: string } | null>(null);
  const [color, setColor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [gRes, dRes] = await Promise.all([fetch("/api/admin/groups"), fetch("/api/districts")]);
    const gData = await gRes.json();
    const dData = await dRes.json();
    setGroups(gData.groups ?? []);
    setPalette(gData.palette ?? []);
    setColor((c) => c ?? gData.palette?.[0] ?? null);
    setDistricts(dData.districts ?? []);
  }, []);

  useRunAfterMount(load);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), color }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(friendlyError(data.error, "گروه ساخته نشد؛ دوباره تلاش کنید"));
        return;
      }
      setName("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function rename(g: GroupRow, nextName: string) {
    const next = nextName.trim();
    setRenaming(null);
    if (!next || next === g.name) return;
    const res = await fetch(`/api/admin/groups/${g.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: next }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) setError(friendlyError(data.error, "نام گروه تغییر نکرد؛ دوباره تلاش کنید"));
    else await load();
  }

  async function recolor(g: GroupRow, next: string) {
    const res = await fetch(`/api/admin/groups/${g.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ color: next }),
    });
    if (res.ok) await load();
  }

  async function remove(g: GroupRow) {
    setConfirmingId(null);
    const res = await fetch(`/api/admin/groups/${g.id}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok || !data.ok) setError(friendlyError(data.error, "گروه حذف نشد؛ دوباره تلاش کنید"));
    else {
      setError(null);
      await load();
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

      <form onSubmit={create} className="rounded-lg border border-border bg-surface p-4">
        <h2 className="sechead__title mb-3">گروه تازه</h2>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="نام گروه" aria-label="نام گروه"
            className="min-w-48 flex-1 rounded-md border border-border bg-surface-raised px-3 py-2 text-right text-sm text-text outline-none placeholder:text-text-faint focus:border-accent"
          />
          {/* Fixed palette, not a colour picker: these tints share the map with the
              coverage-status colours, and a free-form choice could land on the exact red
              that already means "not allowed" there. */}
          <div className="flex gap-1.5" role="radiogroup" aria-label="رنگ گروه">
            {palette.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color === c}
                aria-label={c}
                onClick={() => setColor(c)}
                style={{ background: c }}
                className={`grid place-items-center transition-transform ${
                  color === c ? "scale-110 ring-2 ring-text ring-offset-2 ring-offset-[var(--surface)]" : "opacity-70"
                }`}
              >
                {color === c ? <Icon name="check" size="sm" className="text-[var(--surface)]" /> : null}
              </button>
            ))}
          </div>
          <button
            type="submit"
            disabled={busy || !name.trim()}
            className="inline-flex items-center justify-center gap-[var(--space-2)] cursor-pointer rounded-md border border-accent bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition-[filter,opacity] hover:enabled:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Icon name="plus" size="md" />
            ساخت گروه
          </button>
        </div>
      </form>

      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="sechead__title mb-3">گروه‌های موجود</h2>
        {groups === null ? (
          <p className="text-sm text-text-muted">در حال بارگذاری…</p>
        ) : groups.length === 0 ? (
          <p className="text-sm text-text-muted">هنوز گروهی نساخته‌اید. نام گروه را بنویسید و «ساخت گروه» را بزنید.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {groups.map((g) => (
              <li
                key={g.id}
                className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-surface-raised px-3 py-2"
              >
                <span
                  aria-hidden="true"
                  className="size-3 shrink-0 rounded-full"
                  style={{ background: g.color ?? "var(--neutral)" }}
                />
                <span className="flex-1 text-sm font-medium text-text">{g.name}</span>
                <span className="font-mono text-xs text-text-muted">
                  {faNum(g.district_count)} محدوده · {faNum(g.user_count)} کاربر
                </span>
                <div className="flex gap-1">
                  {palette.map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-label={`رنگ ${c} برای ${g.name}`}
                      onClick={() => recolor(g, c)}
                      style={{ background: c }}
                      className={`grid size-5 place-items-center rounded-full ${g.color === c ? "ring-2 ring-text" : "opacity-60"}`}
                    >
                      {g.color === c ? <Icon name="check" size="sm" className="text-[var(--surface)]" /> : null}
                    </button>
                  ))}
                </div>
                {renaming?.id === g.id ? (
                  <span className="flex flex-wrap items-center gap-[var(--space-2)] text-xs">
                    <input
                      autoFocus
                      value={renaming.name}
                      onChange={(e) => setRenaming({ id: g.id, name: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void rename(g, renaming.name);
                        if (e.key === "Escape") setRenaming(null);
                      }}
                      placeholder="نام تازهٔ گروه" aria-label="نام تازهٔ گروه"
                      className="rounded border border-border bg-bg px-2 py-1 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => void rename(g, renaming.name)}
                      className="cursor-pointer text-accent transition-colors hover:underline"
                    >
                      <Icon name="check" size="md" />
                      ذخیرهٔ نام گروه
                    </button>
                    <button
                      type="button"
                      onClick={() => setRenaming(null)}
                      className="cursor-pointer text-text-muted transition-colors hover:text-text"
                    >
                      <Icon name="x" size="md" />
                      انصراف از تغییر نام
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setRenaming({ id: g.id, name: g.name })}
                    className="cursor-pointer text-xs text-text-muted transition-colors hover:text-accent"
                  >
                    <Icon name="edit" size="md" />
                    تغییر نام گروه
                  </button>
                )}
                {confirmingId === g.id ? (
                  <span className="flex flex-wrap items-center gap-[var(--space-2)] text-xs">
                    <span className="text-text-muted">محدوده‌های «{g.name}» بدون گروه می‌شوند و این کار برگشت ندارد.</span>
                    <button
                      type="button"
                      onClick={() => remove(g)}
                      className="cursor-pointer text-crit transition-colors hover:underline"
                    >
                      <Icon name="trash" size="md" />
                      حذف همیشگی گروه «{g.name}»
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingId(null)}
                      className="cursor-pointer text-text-muted transition-colors hover:text-text"
                    >
                      <Icon name="x" size="md" />
                      انصراف از حذف گروه
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmingId(g.id)}
                    className="cursor-pointer text-xs text-text-muted transition-colors hover:text-crit"
                  >
                    <Icon name="trash" size="md" />
                    حذف گروه
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {groups && groups.length > 0 && (
        <GroupTerritoryEditor districts={districts} groups={groups} onSaved={load} />
      )}
    </div>    </>
  );
}
