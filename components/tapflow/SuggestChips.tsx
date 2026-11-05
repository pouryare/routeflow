"use client";

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
          className="touch min-h-11 rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-3)] text-start text-[length:var(--text-sm)]"
        >
          {s}
        </button>
      ))}
    </div>
  );
}
