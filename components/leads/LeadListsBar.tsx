"use client";

import { useState } from "react";
import CollapsibleSection from "@/components/CollapsibleSection";
import { Icon } from "@/components/meridian/Icon";
import { faNum } from "@/lib/format";

/** The list bar the empty-state copy has been promising all along.
 *
 *  Every handler this needs -- `openList`, `renameList`, `deleteList`, `createList` -- has
 *  existed in the hook for as long as the page has, and none of them was ever rendered.
 *  `openList` was destructured in the page and called nowhere in the codebase, which is what
 *  made a saved list write itself into the database and then vanish from the interface.
 *
 *  Rows rather than chips: a chip row runs out of room once there are more than a handful of
 *  lists, and each of these needs three actions -- load, rename, delete -- on top of a name
 *  written in Persian. */
export interface LeadListsBarProps {
  lists: Array<{ id: number; name: string; location_ids: number[] }>;
  activeListId: number | null;
  onOpen: (id: number) => void;
  onCreate: (name: string) => void;
  onRename: (id: number, name: string) => void;
  onDelete: (id: number) => void;
  newName: string;
  onNewNameChange: (name: string) => void;
  busy: boolean;
}

export default function LeadListsBar({
  lists,
  activeListId,
  onOpen,
  onCreate,
  onRename,
  onDelete,
  newName,
  onNewNameChange,
  busy,
}: LeadListsBarProps) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [confirmingId, setConfirmingId] = useState<number | null>(null);

  return (
    <section className="rounded-[var(--radius-lg)] border border-border bg-surface-raised p-4">
      <CollapsibleSection title="فهرست‌ها" icon="list" storageKey="leads_lists" keywords="فهرست ذخیره">
        {lists.length === 0 ? (
          <p className="py-2 text-[length:var(--text-xs)] text-text-faint">
            هنوز فهرستی ساخته نشده است.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {lists.map((list) => {
              const isActive = list.id === activeListId;
              const isEditing = editingId === list.id;
              return (
                <li
                  key={list.id}
                  className={`flex items-center gap-2 rounded-[var(--radius-md)] border px-3 py-2 transition-colors ${
                    isActive ? "border-accent bg-accent/5" : "border-border bg-surface"
                  }`}
                >
                  {isEditing ? (
                    <input
                      autoFocus
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={() => {
                        if (draft.trim()) onRename(list.id, draft);
                        setEditingId(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      aria-label={`نام جدید برای ${list.name}`}
                      className="flex-1 rounded-[var(--radius-sm)] border border-border bg-bg px-2 py-1 text-[length:var(--text-xs)] text-text outline-none focus:border-accent"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => onOpen(list.id)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-right"
                    >
                      <span className="truncate text-[length:var(--text-sm)] text-text">{list.name}</span>
                      <span className="shrink-0 font-mono text-[length:var(--text-xs)] text-text-faint">
                        {faNum(list.location_ids.length)} مکان
                      </span>
                      {isActive ? (
                        <span className="shrink-0 rounded bg-accent/15 px-1.5 py-0.5 text-[length:var(--text-xs)] text-accent">
                          فعال
                        </span>
                      ) : null}
                    </button>
                  )}

                  {!isEditing && (
                    <span className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setDraft(list.name);
                          setEditingId(list.id);
                        }}
                        aria-label={`تغییر نام ${list.name}`}
                        className="rounded p-1 text-text-faint transition-colors hover:text-accent"
                      >
                        <Icon name="edit" size="sm" />
                      </button>
                      {confirmingId === list.id ? (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              onDelete(list.id);
                              setConfirmingId(null);
                            }}
                            aria-label={`حذف ${list.name}`}
                            className="rounded bg-crit/15 px-1.5 py-0.5 text-[length:var(--text-xs)] text-crit"
                          >
                            مطمئن؟
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmingId(null)}
                            aria-label="انصراف"
                            className="rounded px-1.5 py-0.5 text-[length:var(--text-xs)] text-text-faint"
                          >
                            لغو
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmingId(list.id)}
                          aria-label={`حذف ${list.name}`}
                          className="rounded p-1 text-text-faint transition-colors hover:text-crit"
                        >
                          <Icon name="trash" size="sm" />
                        </button>
                      )}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <div className="mt-3 flex items-center gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => onNewNameChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newName.trim()) onCreate(newName);
            }}
            placeholder="نام فهرست تازه…"
            aria-label="نام فهرست تازه"
            className="flex-1 rounded-[var(--radius-sm)] border border-border bg-bg px-2 py-1.5 text-[length:var(--text-xs)] text-text placeholder:text-text-faint outline-none focus:border-accent"
          />
          <button
            type="button"
            onClick={() => onCreate(newName)}
            disabled={busy || !newName.trim()}
            className="shrink-0 rounded-[var(--radius-sm)] border border-accent px-2 py-1.5 text-[length:var(--text-xs)] text-accent transition-colors hover:bg-accent hover:text-accent-ink disabled:opacity-50"
          >
            ساختن از مسیر فعلی
          </button>
        </div>
      </CollapsibleSection>
    </section>
  );
}
