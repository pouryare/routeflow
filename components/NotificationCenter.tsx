"use client";

/** The panel that drops out of the bell: the grouped feed, one row per group, tap a
 *  multi-item group to expand its items. Reads GET /api/notifications on mount and after
 *  every mark-read; PATCH marks a group (or all) read. Browser glue -- not unit-tested,
 *  per repo convention (tests/ has no React-render tests).
 */

import { useRunAfterMount } from "@/lib/useRunAfterMount";
import { Icon } from "@/components/meridian/Icon";
import { useCallback, useState } from "react";
import { faNum } from "@/lib/format";

interface Item {
  id: number;
  title_fa: string;
  body_fa: string | null;
  created_at: string;
  read_at: string | null;
}
interface FeedGroup {
  group_key: string;
  latest_at: string;
  count: number;
  unread_count: number;
  title_fa: string;
  body_fa: string | null;
  entity_type: string | null;
  entity_id: number | null;
  priority: string;
  items: Item[];
}

export default function NotificationCenter({ onUnread }: { onUnread: (n: number) => void }) {
  const [groups, setGroups] = useState<FeedGroup[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications");
      if (!res.ok) {
        setLoading(false);
        return;
      }
      const json = await res.json();
      setGroups(json.groups ?? []);
      onUnread(json.unread ?? 0);
      setLoading(false);
    } catch {
      setLoading(false);
    }
  }, [onUnread]);
  useRunAfterMount(load);

  async function markAll() {
    const res = await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ read: "all" }),
    });
    if (res.ok) {
      const j = await res.json();
      onUnread(j.unread ?? 0);
      void load();
    }
  }
  async function markGroup(key: string) {
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ read: [key] }),
    });
    void load();
  }

  if (loading)
    return (
      <p className="w-[min(92vw,22rem)] p-[var(--space-3)] text-[length:var(--text-xs)] text-[var(--text-muted)]">
        در حال بارگذاری…
      </p>
    );
  if (groups.length === 0)
    return (
      <p className="w-[min(92vw,22rem)] p-[var(--space-4)] text-[length:var(--text-sm)] text-[var(--text-muted)]">
        اعلان تازه‌ای ندارید.
      </p>
    );

  return (
    <div className="flex max-h-[60vh] w-[min(92vw,22rem)] flex-col">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-[var(--space-3)] py-[var(--space-2)]">
        <span className="text-[length:var(--text-sm)] font-medium text-[var(--text)]">اعلان‌ها</span>
        <button type="button" onClick={markAll} className="inline-flex items-center justify-center gap-[var(--space-2)] text-[length:var(--text-xs)] text-[var(--accent)]">
          <Icon name="check" size="sm" />
          خواندنِ همه
        </button>
      </div>
      <ul className="m-0 list-none overflow-y-auto p-0">
        {groups.map((g) => (
          <li key={g.group_key} className="border-b border-[var(--border)] last:border-0">
            <button
              type="button"
              onClick={() => {
                setOpen(open === g.group_key ? null : g.group_key);
                if (g.unread_count) void markGroup(g.group_key);
              }}
              className="flex w-full items-start gap-[var(--space-2)] px-[var(--space-3)] py-[var(--space-2)] text-start"
            >
              <Icon name="bell" size="md" />
              <span
                aria-hidden
                className="mt-[0.35rem] h-2 w-2 shrink-0 rounded-full"
                style={{ background: g.unread_count ? "var(--accent)" : "transparent" }}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-[length:var(--text-sm)] text-[var(--text)]">
                  {g.title_fa}
                  {g.count > 1 ? ` · ${faNum(g.count)}` : ""}
                </span>
                {g.body_fa && (
                  <span className="block truncate text-[length:var(--text-xs)] text-[var(--text-muted)]">
                    {g.body_fa}
                  </span>
                )}
              </span>
            </button>
            {open === g.group_key && g.count > 1 && (
              <ul className="m-0 list-none bg-[var(--surface-raised)] p-0">
                {g.items.map((it) => (
                  <li
                    key={it.id}
                    className="px-[var(--space-5)] py-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--text-muted)]"
                  >
                    {it.body_fa ?? it.title_fa}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
