"use client";

import { Icon } from "@/components/meridian/Icon";
import { noteSuggestions } from "@/lib/noteSuggest";

/** Up to three of the person's own earlier notes that start with what they have typed; a tap fills the box. */
export default function SuggestChips({ typed, past, onPick }: { typed: string; past: string[]; onPick: (s: string) => void }) {
  const list = noteSuggestions(typed, past);
  if (!list.length) return null;
  return (
    <div className="flex flex-col gap-[var(--space-2)]" role="group" aria-label="ادامهٔ پیشنهادی">
      {list.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onPick(s)}
          className="touch inline-flex min-h-11 items-center justify-start gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-3)] text-start text-[length:var(--text-sm)]"
        >
          <Icon name="edit" size="sm" />
          {s}
        </button>
      ))}
    </div>
  );
}
