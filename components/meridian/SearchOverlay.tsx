"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Icon, type IconName } from "@/components/meridian/Icon";
import type { AppTab } from "@/lib/appNav";
import { DUR, EASE } from "@/lib/motion";
import { normalisePersian } from "@/lib/persian";
import {
  MAP_FOCUS_EVENT, MIN_REMOTE_QUERY, RECENT_KEY, moveActive, parseRecent, pushRecent, rankPages,
  type SearchHit, type SearchKind,
} from "@/lib/searchModel";

const KIND_ICON: Record<SearchKind, IconName> = { page: "link", customer: "building", order: "receipt" };
const SECTION: Record<SearchKind | "recent", string> = {
  recent: "اخیر", page: "صفحه‌ها", customer: "مشتریان", order: "سفارش‌ها",
};

type Section = { key: SearchKind | "recent"; hits: SearchHit[] };
type Remote = { customers: SearchHit[]; orders: SearchHit[] };
const NO_REMOTE: Remote = { customers: [], orders: [] };

/** One search for the whole app (spec D4): pages, customers and orders, full-screen.
 *
 *  Portalled into the `.meridian` root. Rendered in place it would sit inside `.chrome`,
 *  whose `will-change: transform` makes it the containing block for position:fixed, so
 *  a "full-screen" overlay came out header-sized. document.body escapes that but is
 *  outside `.meridian`, where every token lives. The smoke suite measures the box.
 *
 *  Mounted only while open (SearchSlot), so every opening starts clean: empty box, fresh
 *  recents, nothing highlighted. Decisions (ranking, recents, cursor) are in
 *  lib/searchModel.ts; this file renders. */
export default function SearchOverlay({ open, onClose, tabs }: { open: boolean; onClose: () => void; tabs: AppTab[] }) {
  const host = useSyncExternalStore(noSubscribe, portalHost, () => null);
  if (!host) return null;
  return createPortal(
    <AnimatePresence>{open && <Panel key="sov" onClose={onClose} tabs={tabs} />}</AnimatePresence>,
    host,
  );
}

/** The portal target never changes after hydration, so there is nothing to subscribe to;
 *  the server snapshot (null) is what keeps the first client render matching the HTML. */
const noSubscribe = () => () => {};
const portalHost = () => document.querySelector<HTMLElement>(".meridian") ?? document.body;

/** Storage can throw (private mode, blocked site data); a search box that works without
 *  recents beats none. Read once, at mount, which is each opening. */
function readRecent(): SearchHit[] {
  try {
    return parseRecent(localStorage.getItem(RECENT_KEY));
  } catch {
    return [];
  }
}

function Panel({ onClose, tabs }: { onClose: () => void; tabs: AppTab[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const reduce = useReducedMotion();
  const [q, setQ] = useState("");
  const [remote, setRemote] = useState<Remote & { for: string }>({ ...NO_REMOTE, for: "" });
  const [recent] = useState<SearchHit[]>(readRecent);
  const [cursor, setCursor] = useState<{ i: number; for: string }>({ i: -1, for: "" });

  /* The page behind must not scroll under the overlay. */
  useEffect(() => {
    const html = document.documentElement;
    const prev = html.style.overflow;
    html.style.overflow = "hidden";
    return () => { html.style.overflow = prev; };
  }, []);

  const wantsRemote = normalisePersian(q.trim()).length >= MIN_REMOTE_QUERY;

  /* Debounced; each keystroke aborts the request before it, so a slow early answer
     cannot overwrite a later one. The answer is tagged with the query it answers, so a
     stale one is simply not shown rather than cleared with a setState in this effect. */
  useEffect(() => {
    if (!wantsRemote) return;
    const ctl = new AbortController();
    const t = window.setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctl.signal })
        .then((r) => (r.ok ? r.json() : NO_REMOTE))
        .then((j) => setRemote({ customers: j.customers ?? [], orders: j.orders ?? [], for: q }))
        .catch(() => { /* aborted by the next keystroke, or offline: pages still answer */ });
    }, 180);
    return () => { window.clearTimeout(t); ctl.abort(); };
  }, [q, wantsRemote]);

  const fresh = wantsRemote && remote.for === q;
  const loading = wantsRemote && !fresh;

  const sections: Section[] = useMemo(() => {
    if (!q.trim()) return recent.length ? [{ key: "recent", hits: recent }] : [];
    return ([
      { key: "page", hits: rankPages(tabs, q) },
      { key: "customer", hits: fresh ? remote.customers : [] },
      { key: "order", hits: fresh ? remote.orders : [] },
    ] as Section[]).filter((s) => s.hits.length > 0);
  }, [q, recent, remote, fresh, tabs]);

  const flat = useMemo(() => sections.flatMap((s) => s.hits), [sections]);
  /* The highlight belongs to one result list; a new list starts with nothing highlighted. */
  const listKey = flat.map((h) => h.id).join("|");
  const active = cursor.for === listKey ? cursor.i : -1;
  const setActive = (i: number) => setCursor({ i, for: listKey });

  const choose = (hit: SearchHit) => {
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(pushRecent(recent, hit))); } catch { /* per-viewer nicety only */ }
    onClose();
    /* Already on the map: hand the customer to it. A push to /map?c= from /map changes
       the address bar and nothing else, because the map reads ?c= once, at mount. */
    if (hit.kind === "customer" && pathname === "/map") {
      window.dispatchEvent(new CustomEvent(MAP_FOCUS_EVENT, { detail: Number(hit.id.split(":")[1]) }));
      return;
    }
    router.push(hit.href);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); onClose(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setActive(moveActive(active, 1, flat.length)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive(moveActive(active, -1, flat.length)); }
    else if (e.key === "Enter") {
      const hit = flat[active >= 0 ? active : 0];
      if (hit) { e.preventDefault(); choose(hit); }
    }
  };

  const optionId = (i: number) => `sov-opt-${i}`;
  const offsets = sections.map((_, si) => sections.slice(0, si).reduce((n, s) => n + s.hits.length, 0));

  return (
    <motion.div
      className="sov"
      role="dialog"
      aria-modal="true"
      aria-label="جستجو"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduce ? 0 : DUR.slow, ease: EASE.out }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={onKey}
    >
      <motion.div
        className="sov__panel"
        initial={reduce ? false : { y: -12, scale: 0.98 }}
        animate={{ y: 0, scale: 1 }}
        exit={reduce ? undefined : { y: -8, scale: 0.98 }}
        transition={{ duration: reduce ? 0 : DUR.slow, ease: EASE.out }}
      >
        <div className="sov__field">
          <Icon name="search" size="md" />
          <input
            autoFocus
            className="sov__input"
            role="combobox"
            aria-expanded={flat.length > 0}
            aria-controls="sov-list"
            aria-activedescendant={active >= 0 ? optionId(active) : undefined}
            placeholder="جستجوی صفحه، مشتری یا سفارش…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button type="button" className="sov__close" aria-label="بستن" onClick={onClose}>
            <Icon name="x" size="sm" />
          </button>
        </div>

        <div id="sov-list" role="listbox" className="sov__list" aria-label="نتیجه‌ها">
          {sections.map((s, si) => (
            <div key={s.key} role="group" aria-label={SECTION[s.key]} className="sov__section">
              <div className="sov__heading">{SECTION[s.key]}</div>
              {s.hits.map((h, hi) => {
                const i = offsets[si] + hi;
                return (
                  <a
                    key={h.id}
                    id={optionId(i)}
                    role="option"
                    aria-selected={i === active}
                    href={h.href}
                    className="sov__opt"
                    onMouseEnter={() => setActive(i)}
                    onClick={(e) => { e.preventDefault(); choose(h); }}
                  >
                    <Icon name={KIND_ICON[h.kind]} size="sm" />
                    <span className="sov__label">{h.label}</span>
                    {h.sub ? <span className="sov__sub">{h.sub}</span> : null}
                  </a>
                );
              })}
            </div>
          ))}
          {q.trim() && flat.length === 0 ? (
            <p className="sov__empty">{loading ? "در حال جستجو…" : "چیزی پیدا نشد"}</p>
          ) : null}
          {!q.trim() && flat.length === 0 ? (
            <p className="sov__empty">نام صفحه، مشتری یا شمارهٔ سفارش را بنویسید</p>
          ) : null}
        </div>
      </motion.div>
    </motion.div>
  );
}
