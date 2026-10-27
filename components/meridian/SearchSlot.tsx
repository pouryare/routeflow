"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Kbd } from "@heroui/react";
import { Icon } from "@/components/meridian/Icon";
import SearchOverlay from "@/components/meridian/SearchOverlay";
import type { AppTab } from "@/lib/appNav";

const noSubscribe = () => () => {};

/** The header's search button, and the owner of Ctrl-K / ⌘K.
 *
 *  Opens the one search overlay (spec D4). It lives in the shell header, so every shell
 *  page, /map included, gets the same search from the same key. Only Ctrl-K is bound: the
 *  map already uses "/" for its own box. Focus returns here on close, so a keyboard user
 *  is not dropped at the top of the document. */
export default function SearchSlot({ tabs }: { tabs: AppTab[] }) {
  const btn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  /* "1" only once hydrated, when the Ctrl-K listener exists. The smoke suite waits on it:
     /map hydrates well after its load event, and a key pressed before then goes nowhere. */
  const ready = useSyncExternalStore(noSubscribe, () => "1", () => undefined);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const close = () => {
    setOpen(false);
    btn.current?.focus();
  };

  return (
    <>
      <button
        ref={btn}
        type="button"
        className="searchslot"
        data-ready={ready}
        aria-label="جستجو"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <Icon name="search" size="sm" />
        <span className="searchslot__label">جستجو…</span>
        <Kbd className="searchslot__kbd" aria-hidden="true"><Kbd.Content>Ctrl K</Kbd.Content></Kbd>
      </button>
      <SearchOverlay open={open} onClose={close} tabs={tabs} />
    </>
  );
}
