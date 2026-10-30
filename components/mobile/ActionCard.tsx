"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { Icon } from "@/components/meridian/Icon";
import { SUPPRESS_DAYS, type Suggestion } from "@/lib/briefingSuggestions";
import { LeavingRow, LeavingRows } from "@/components/meridian/LeavingRows";

/** Clock read kept out of render; used as a lazy state initialiser. */
const stamp = () => Date.now();
const KEY = "rf:suggest:dismissed";
const EVENT = "rf:suggest";

/** Dismissals live on this device: key -> the time it was dismissed. A card stays hidden for
 *  SUPPRESS_DAYS. (Per device, not per account: enough for «not now», and no table to migrate.) */
function read(): string {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}
const subscribe = (notify: () => void) => {
  window.addEventListener(EVENT, notify);
  window.addEventListener("storage", notify);
  return () => {
    window.removeEventListener(EVENT, notify);
    window.removeEventListener("storage", notify);
  };
};

function hiddenKeys(raw: string, now: number): Set<string> {
  try {
    const map = JSON.parse(raw || "{}") as Record<string, number>;
    return new Set(Object.keys(map).filter((k) => now - map[k] < SUPPRESS_DAYS * 86_400_000));
  } catch {
    return new Set();
  }
}

/** Cards that suggest one next move, with the reason in a line so the suggestion can be trusted.
 *  «الان نه» hides a card for a week on this device. */
export default function ActionCards({ cards }: { cards: Suggestion[] }) {
  const raw = useSyncExternalStore(subscribe, read, () => "{}");
  const [now] = useState(stamp);
  const hidden = hiddenKeys(raw, now);
  const shown = cards.filter((c) => !hidden.has(c.key));
  if (shown.length === 0) return null;

  const dismiss = (key: string) => {
    try {
      const map = JSON.parse(read() || "{}") as Record<string, number>;
      map[key] = stamp();
      localStorage.setItem(KEY, JSON.stringify(map));
    } catch {
      /* private mode: the card simply stays */
    }
    window.dispatchEvent(new Event(EVENT));
  };

  return (
    <section className="actioncards" aria-label="پیشنهادهای امروز">
      <LeavingRows>
      {shown.map((c) => (
        <LeavingRow as="article" key={c.key} className={`actioncard actioncard--${c.kind}`}>
          <h3>{c.title}</h3>
          <p>{c.why}</p>
          <div className="actioncard__row">
            <Link href={c.primary.href} className="actioncard__primary">
              <Icon name={c.primary.kind === "call" ? "phone" : "plus"} size="md" />
              {c.primary.label}
            </Link>
            {c.secondary && (
              <Link href={c.secondary.href} className="actioncard__secondary">
                <Icon name={c.primary.kind === "call" ? "plus" : "phone"} size="md" />
                {c.secondary.label}
              </Link>
            )}
            <button type="button" className="actioncard__later" onClick={() => dismiss(c.key)}>
              <Icon name="x" size="md" />
              الان نه
            </button>
          </div>
        </LeavingRow>
      ))}
      </LeavingRows>
    </section>
  );
}
