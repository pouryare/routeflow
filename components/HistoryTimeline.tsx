"use client";

import { useEffect, useState } from "react";

interface ActivityEntry {
  id: number;
  entity_type: "district" | "customer";
  entity_id: number;
  event_type: "status_change" | "note" | "assigned";
  old_value: string | null;
  new_value: string | null;
  note: string | null;
  changed_by: string | null;
  created_at: string;
}

function formatDate(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function describe(e: ActivityEntry): string {
  if (e.event_type === "status_change") return `وضعیت از «${e.old_value}» به «${e.new_value}» تغییر کرد`;
  if (e.event_type === "assigned") return e.new_value ? `به «${e.new_value}» محول شد` : "مسئول برداشته شد";
  return e.note ?? "";
}

export default function HistoryTimeline({
  entityType,
  entityId,
}: {
  entityType: "district" | "customer";
  entityId: number;
}) {
  const [items, setItems] = useState<ActivityEntry[] | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetch(`/api/activity?entity_type=${entityType}&entity_id=${entityId}`)
      .then((r) => r.json())
      .then((d) => setItems(d.activity ?? []));
  }, [entityType, entityId]);

  return (
    <div className="mt-4 border-t border-border pt-3">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between font-mono text-[length:var(--text-xs)] uppercase tracking-wide text-text-muted transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:text-text"
      >
        <span>تاریخچه{items && items.length > 0 ? ` (${items.length})` : ""}</span>
        <span
          className="transition-transform duration-[var(--dur-base)] ease-[var(--ease-out)]"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
        >
          ▾
        </span>
      </button>
      {open &&
        (items === null ? (
          <p className="mt-2 text-[length:var(--text-xs)] text-text-faint">در حال بارگذاری…</p>
        ) : items.length === 0 ? (
          <p className="mt-2 text-[length:var(--text-xs)] text-text-faint">هنوز رویدادی ثبت نشده</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {items.map((e) => (
              <li key={e.id} className="text-[length:var(--text-xs)] leading-5 text-text-muted">
                <span dir="ltr" className="inline-block font-mono text-text-faint">
                  {formatDate(e.created_at)}
                </span>{" "}
                — {describe(e)}
                {e.changed_by && <span className="text-text-faint"> ({e.changed_by})</span>}
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}
