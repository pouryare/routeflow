"use client";

import { useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/meridian/Icon";
import { useTutorials } from "@/components/tutorials/TutorialProvider";
import type { WhatsNewEntry } from "@/lib/whatsNew/notes";

/** F112: what changed since this person last looked, shown once. «دیدم» remembers the version in
 *  their preferences (so it follows them to another device) and hides the card at once; the
 *  full history stays under settings. */
export default function WhatsNewCard({ entry }: { entry: WhatsNewEntry }) {
  const [hidden, setHidden] = useState(false);
  const { start } = useTutorials();
  if (hidden) return null;

  function dismiss() {
    setHidden(true);
    void fetch("/api/prefs", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ whats_new_seen: entry.version }),
    }).catch(() => undefined);
  }

  return (
    <section
      className="card lightcard mb-3 p-[var(--space-4)]"
      aria-label="تازه‌های برنامه"
      onPointerMove={(e) => {
        // A soft light follows the finger or pointer across the card (CSS reads these two numbers).
        const r = e.currentTarget.getBoundingClientRect();
        e.currentTarget.style.setProperty("--lx", `${e.clientX - r.left}px`);
        e.currentTarget.style.setProperty("--ly", `${e.clientY - r.top}px`);
      }}
    >
      <h2 className="sechead__title">تازه‌های برنامه</h2>
      <ul className="m-0 mt-[var(--space-2)] flex list-disc flex-col gap-[var(--space-1)] pr-[var(--space-4)] text-[length:var(--text-sm)] leading-6 text-[var(--text)]">
        {entry.items.map((i, k) => (
          <li key={k}>
            {i.text}
            {i.tour ? (
              <button type="button" className="btn ms-[var(--space-2)] inline-flex min-h-[44px] items-center gap-[var(--space-1)]" onClick={() => start(i.tour!)}>
                <Icon name="sparkle" size="sm" />
                ببین
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="mt-[var(--space-3)] flex flex-wrap gap-[var(--space-2)]">
        <button type="button" className="btn solid inline-flex min-h-[44px] items-center gap-[var(--space-2)]" onClick={dismiss}>
          <Icon name="check" size="sm" />
          دیدم
        </button>
        <Link href="/settings/updates" className="btn inline-flex min-h-[44px] items-center gap-[var(--space-2)]">
          <Icon name="sparkle" size="sm" />
          همهٔ تازه‌ها
        </Link>
      </div>
    </section>
  );
}
