"use client";

import { useMemo, useState } from "react";
import { friendlyError } from "@/lib/userMessage";
import { Icon } from "@/components/meridian/Icon";
import type { DistrictProperties } from "@/lib/types";
import { faNum } from "@/lib/format";

export interface TerritoryGroup {
  id: number;
  name: string;
  color: string | null;
}

/** Hands districts to a group in bulk.
 *
 *  A list rather than the map: territory is assigned by administrative name ("منطقه ۴",
 *  "محله ونک"), and the question being answered here is "which of these 369 does this
 *  group hold", which a grouped, filterable list answers directly. The map remains the
 *  place to see the result -- each district is tinted by its group's colour there.
 *
 *  Writes through PATCH /api/districts/bulk, which is owner-only for group_id and
 *  recomputes customers.group_id server-side, so the customers follow the territory. */
export default function GroupTerritoryEditor({
  districts,
  groups,
  onSaved,
}: {
  districts: DistrictProperties[];
  groups: TerritoryGroup[];
  onSaved: () => void;
}) {
  const [filter, setFilter] = useState("");
  const [ownerFilter, setOwnerFilter] = useState<number | "all" | "none">("all");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [target, setTarget] = useState<number | "none">(groups[0]?.id ?? "none");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const groupById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);

  const visible = useMemo(() => {
    const q = filter.trim();
    return districts.filter((d) => {
      if (q && !d.name.includes(q) && !(d.parent_name ?? "").includes(q)) return false;
      if (ownerFilter === "none") return d.group_id === null;
      if (ownerFilter !== "all") return d.group_id === ownerFilter;
      return true;
    });
  }, [districts, filter, ownerFilter]);

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function assign() {
    if (selected.size === 0) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/districts/bulk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...selected], group_id: target === "none" ? null : target }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(friendlyError(data.error, "محدودهٔ گروه ذخیره نشد؛ دوباره تلاش کنید"));
        return;
      }
      setSelected(new Set());
      onSaved();
    } catch {
      setError("اتصال برقرار نشد. اینترنت را بررسی کنید و دوباره تلاش کنید.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <h2 className="sechead__title mb-3">تخصیص محدوده</h2>

      <div className="mb-3 flex flex-wrap gap-2">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="جست‌وجوی منطقه یا محله"
          className="min-w-48 flex-1 rounded-md border border-border bg-surface-raised px-3 py-2 text-right text-sm text-text outline-none placeholder:text-text-faint focus:border-accent"
        />
        <select
          value={String(ownerFilter)}
          onChange={(e) =>
            setOwnerFilter(e.target.value === "all" ? "all" : e.target.value === "none" ? "none" : Number(e.target.value))
          }
          className="rounded-md border border-border bg-surface-raised px-3 py-2 text-sm text-text outline-none focus:border-accent"
        >
          <option value="all">همه محدوده‌ها</option>
          <option value="none">بدون گروه</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </div>

      <div className="mb-3 max-h-80 overflow-y-auto rounded-md border border-border">
        {visible.length === 0 ? (
          <p className="p-4 text-center text-sm text-text-muted">محدوده‌ای با این فیلتر پیدا نشد.</p>
        ) : (
          <ul>
            {visible.map((d) => {
              const owner = d.group_id === null ? null : groupById.get(d.group_id);
              return (
                <li key={d.id} className="border-b border-border last:border-b-0">
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-surface-raised">
                    <input
                      type="checkbox"
                      checked={selected.has(d.id)}
                      onChange={() => toggle(d.id)}
                      className="size-4 accent-[var(--accent)]"
                    />
                    <span className="flex-1 text-sm text-text">
                      {d.name}
                      {d.parent_name && <span className="text-text-faint"> — {d.parent_name}</span>}
                    </span>
                    {owner ? (
                      <span className="flex items-center gap-1.5 text-xs text-text-muted">
                        <span
                          aria-hidden="true"
                          className="size-2.5 rounded-full"
                          style={{ background: owner.color ?? "var(--neutral)" }}
                        />
                        {owner.name}
                      </span>
                    ) : (
                      <span className="text-xs text-text-faint">بدون گروه</span>
                    )}
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-text-muted">{faNum(selected.size)} انتخاب شده</span>
        <select
          value={String(target)}
          onChange={(e) => setTarget(e.target.value === "none" ? "none" : Number(e.target.value))}
          className="rounded-md border border-border bg-surface-raised px-3 py-2 text-sm text-text outline-none focus:border-accent"
        >
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
          <option value="none">بدون گروه</option>
        </select>
        <button
          type="button"
          onClick={assign}
          disabled={saving || selected.size === 0}
          className="inline-flex items-center justify-center gap-[var(--space-2)] cursor-pointer rounded-md border border-accent bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition-[filter,opacity] hover:enabled:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Icon name="map" size="md" />
          {saving ? "در حال ذخیره..." : "تخصیص به گروه"}
        </button>
        {error && <span className="text-sm text-crit">{error}</span>}
      </div>

      <p className="mt-2 text-xs text-text-faint">
        با تغییر محدوده، مشتریان همان محدوده هم به گروه جدید منتقل می‌شوند.
      </p>
    </section>
  );
}
