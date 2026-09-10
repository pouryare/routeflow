"use client";

import { useCallback, useEffect, useState } from "react";
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

  useEffect(() => {
    // Fetch-on-mount. The setState calls happen in load()'s async continuation, not
    // synchronously in the effect body, so there is no cascading render here -- but the
    // rule cannot see through the await. Same disable the gallery page uses.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

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
        setError(data.error || "ساخته نشد");
        return;
      }
      setName("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function rename(g: GroupRow) {
    const next = window.prompt("نام تازه گروه", g.name);
    if (next === null || !next.trim() || next.trim() === g.name) return;
    const res = await fetch(`/api/admin/groups/${g.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: next.trim() }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) setError(data.error || "تغییر نام ناموفق بود");
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
    if (!window.confirm(`گروه «${g.name}» حذف شود؟ محدوده‌هایش بدون گروه می‌شوند.`)) return;
    const res = await fetch(`/api/admin/groups/${g.id}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok || !data.ok) setError(data.error || "حذف ناموفق بود");
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
            placeholder="نام گروه"
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
                className={`size-7 rounded-full transition-transform ${
                  color === c ? "scale-110 ring-2 ring-text ring-offset-2 ring-offset-[var(--surface)]" : "opacity-70"
                }`}
              />
            ))}
          </div>
          <button
            type="submit"
            disabled={busy || !name.trim()}
            className="cursor-pointer rounded-md border border-accent bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition-[filter,opacity] hover:enabled:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            ساخت گروه
          </button>
        </div>
      </form>

      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="sechead__title mb-3">گروه‌های موجود</h2>
        {groups === null ? (
          <p className="text-sm text-text-muted">در حال بارگذاری…</p>
        ) : groups.length === 0 ? (
          <p className="text-sm text-text-muted">هنوز گروهی ساخته نشده است.</p>
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
                      className={`size-5 rounded-full ${g.color === c ? "ring-2 ring-text" : "opacity-60"}`}
                    />
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => rename(g)}
                  className="cursor-pointer text-xs text-text-muted transition-colors hover:text-accent"
                >
                  تغییر نام
                </button>
                <button
                  type="button"
                  onClick={() => remove(g)}
                  className="cursor-pointer text-xs text-text-muted transition-colors hover:text-crit"
                >
                  حذف
                </button>
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
