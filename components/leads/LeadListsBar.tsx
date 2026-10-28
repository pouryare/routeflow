"use client";

import { FieldInput } from "@/components/FieldInput";
import { useState } from "react";
import CollapsibleSection from "@/components/CollapsibleSection";
import { Button } from "@heroui/react";
import { Icon } from "@/components/meridian/Icon";
import { faNum } from "@/lib/format";

/** Saved sets, sitting between the route and the map.
 *
 *  Every handler here -- `openList`, `appendToRun`, `proposeDays`, the assign sheet,
 *  `renameList`, `deleteList` -- existed in the hook before any of it was reachable from a
 *  screen. `openList` was destructured in the page and called nowhere in the codebase, which
 *  is how a saved list could be written to the database and then vanish.
 *
 *  Rows rather than chips: there are already nine of these, each needs five actions, and a
 *  name written in Persian needs the width. */
export interface LeadListsBarProps {
  lists: Array<{ id: number; name: string; location_ids: number[] }>;
  activeListId: number | null;
  /** Replaces the route with this list. Destructive, so the caller decides about confirming. */
  onOpen: (id: number) => void;
  /** Appends to the route, keeping what is there. Returns how many were actually added. */
  onAppend: (ids: number[]) => number;
  /** Runs the day-split on this list alone, replacing پیشنهادات روز. */
  onSplit: (id: number) => void;
  onSendToDriver: (id: number) => void;
  onCreate: (name: string) => void;
  onRename: (id: number, name: string) => void;
  onDelete: (id: number) => void;
  newName: string;
  onNewNameChange: (name: string) => void;
  busy: boolean;
  /** Whether loading a list would throw work away, and so whether to ask first. */
  routeIsEmpty: boolean;
  /** The open list's name, so the append button can say whose membership it is editing. */
  openListName: string | null;
}

type ActionId = "load" | "append" | "split" | "send" | "rename" | "delete";

const ACTIONS: Array<{ id: ActionId; label: string; icon: "route" | "list" | "folders" | "truck" | "edit" | "trash"; destructive?: boolean }> = [
  { id: "load", label: "بارگذاری در مسیر", icon: "route" },
  { id: "append", label: "افزودن به مسیر", icon: "list" },
  { id: "split", label: "تقسیم به روزها", icon: "folders" },
  { id: "send", label: "سپردن به راننده", icon: "truck" },
  { id: "rename", label: "تغییر نام فهرست", icon: "edit" },
  { id: "delete", label: "حذف فهرست", icon: "trash", destructive: true },
];

export default function LeadListsBar({
  lists, activeListId, onOpen, onAppend, onSplit, onSendToDriver,
  onCreate, onRename, onDelete, newName, onNewNameChange, busy, routeIsEmpty, openListName,
}: LeadListsBarProps) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [menuFor, setMenuFor] = useState<number | null>(null);
  const [confirming, setConfirming] = useState<{ kind: "load" | "delete"; id: number } | null>(null);

  function run(listId: number, ids: number[], name: string, action: ActionId) {
    setMenuFor(null);
    switch (action) {
      case "load":
        // Asking first is the whole point of the confirm: this throws the route away, and a
        // single tap on a name is exactly how that happens by accident. An empty route has
        // nothing to lose, so it does not interrupt.
        if (!routeIsEmpty) { setConfirming({ kind: "load", id: listId }); return; }
        onOpen(listId);
        return;
      case "append": {
        const added = onAppend(ids);
        if (added === 0) return;
        return;
      }
      case "split":
        onSplit(listId);
        return;
      case "send":
        onSendToDriver(listId);
        return;
      case "rename":
        setDraft(name);
        setEditingId(listId);
        return;
      case "delete":
        setConfirming({ kind: "delete", id: listId });
    }
  }

  /* No wrapper. `CollapsibleSection` renders `.sect`, which already carries a background, a
   * border, a radius and a shadow -- wrapping it in another bordered section put a box
   * inside a box and read as two surfaces where there is one. */
  return (
    /* The title names the COMMIT, not just the storage. Since spec
       2026-09-29-one-lead-one-place, adding a pin to a list is what MAKES it a lead --
       the fold promotes it to `customers` and it leaves /leads. So this box is not
       where pins are filed away; it is the decision.
       Copy only: the «تبدیل به مشتری» button keeps its place, because the page's
       structure is spec 1's business. */
    <CollapsibleSection help="card.map-lists"
      title="فهرست‌ها — با افزودن پین به فهرست، سرنخ می‌شود"
      icon="list"
      storageKey="leads_lists"
      keywords="فهرست ذخیره"
    >
      {lists.length === 0 ? (
        <p className="py-2 text-[length:var(--text-xs)] text-text-faint">هنوز فهرستی نساخته‌اید. مسیر را آماده کنید، نام فهرست را بنویسید و «ساختن از مسیر فعلی» را بزنید.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {lists.map((list) => {
            const isActive = list.id === activeListId;
            const isEditing = editingId === list.id;
            const count = list.location_ids.length;
            const isOpen = confirming?.id === list.id;
            return (
              <li key={list.id} className={`rounded-[var(--radius-md)] border px-3 py-2 ${isActive ? "border-accent bg-accent/5" : "border-border bg-surface"}`}>
                {isEditing ? (
                  <FieldInput
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={() => { if (draft.trim()) onRename(list.id, draft); setEditingId(null); }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    aria-label={`نام جدید برای ${list.name}`}
                    className="w-full text-[length:var(--text-xs)] text-text"
                  />
                ) : (
                  <>
                    <div className="flex items-center gap-2">
                      {/* The row is the load action on every screen, so a window resize never
                          changes what tapping a list does. */}
                      <Button variant="ghost" onPress={() => run(list.id, list.location_ids, list.name, "load")} className="leadlist__row">
                        <Icon name="map-pin" size="md" />
                        <span className="truncate text-[length:var(--text-sm)] text-text">{list.name}</span>
                        <span className="shrink-0 font-mono text-[length:var(--text-xs)] text-text-faint">{faNum(count)} مکان</span>
                        {isActive ? (
                          <span className="shrink-0 rounded bg-accent/15 px-1.5 py-0.5 text-[length:var(--text-xs)] text-accent">فعال</span>
                        ) : null}
                      </Button>

                      {/* Mobile: one button, and the menu carries all six so it stands on
                          its own even though the row already loads. */}
                      <Button
                        isIconOnly
                        variant="ghost"
                        size="sm"
                        onPress={() => setMenuFor(menuFor === list.id ? null : list.id)}
                        aria-label={`کارهای ${list.name}`}
                        aria-expanded={menuFor === list.id}
                        className="md:hidden"
                      >
                        <Icon name="more" size="sm" />
                      </Button>
                    </div>

                    {isOpen ? (
                      <p className="mt-1.5 flex flex-wrap items-center gap-2 text-[length:var(--text-xs)] text-text-muted">
                        <span>{confirming?.kind === "delete" ? "این فهرست حذف شود؟" : "مسیر فعلی جایگزین شود؟"}</span>
                        <Button
                          variant="danger-soft"
                          size="sm"
                          onPress={() => {
                            const kind = confirming?.kind;
                            setConfirming(null);
                            if (kind === "delete") onDelete(list.id);
                            else onOpen(list.id);
                          }}
                        >
                          <Icon name="x" size="md" />
                          {confirming?.kind === "delete" ? "حذف فهرست" : "جایگزینی مسیر"}
                        </Button>
                        <Button variant="tertiary" size="sm" onPress={() => setConfirming(null)}>
                          <Icon name="x" size="md" />
                          {confirming?.kind === "delete" ? "انصراف از حذف" : "انصراف از جایگزینی"}
                        </Button>
                      </p>
                    ) : null}

                    {/* Desktop: all six, wrapping rather than overflowing. Same idiom as the
                        route's own action row. */}
                    <div className="mt-1.5 hidden flex-wrap items-center gap-1.5 md:flex">
                      {ACTIONS.map((a) => (
                        <Button
                          key={a.id}
                          variant={a.destructive ? "danger-soft" : "secondary"}
                          size="sm"
                          onPress={() => run(list.id, list.location_ids, list.name, a.id)}
                          isDisabled={busy || (a.id === "send" && count === 0) || (a.id === "split" && count === 0)}
                          aria-description={a.id === "append" && openListName ? `به «${openListName}» افزوده می‌شود` : undefined}
                        >
                          <Icon name={a.icon} size="sm" />
                          {a.label}
                        </Button>
                      ))}
                    </div>

                    {menuFor === list.id ? (
                      <div className="mt-1.5 flex flex-col gap-0.5 md:hidden">
                        {ACTIONS.map((a) => (
                          <Button
                            key={a.id}
                            variant={a.destructive ? "danger-soft" : "ghost"}
                            className="leadlist__act"
                            onPress={() => run(list.id, list.location_ids, list.name, a.id)}
                            isDisabled={busy || ((a.id === "send" || a.id === "split") && count === 0)}
                          >
                            <Icon name={a.icon} size="sm" />
                            {a.label}
                          </Button>
                        ))}
                      </div>
                    ) : null}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-3 flex items-center gap-2">
        <FieldInput
          type="text"
          value={newName}
          onChange={(e) => onNewNameChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && newName.trim()) onCreate(newName); }}
          placeholder="نام فهرست تازه…"
          aria-label="نام فهرست تازه"
          className="flex-1 text-[length:var(--text-xs)] text-text"
        />
        <Button variant="outline" size="sm" onPress={() => onCreate(newName)} isDisabled={busy || !newName.trim()}>
          <Icon name="plus" size="sm" />
          ساختن از مسیر فعلی
        </Button>
      </div>
    </CollapsibleSection>
  );
}
