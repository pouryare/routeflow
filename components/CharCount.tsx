import { charCount } from "@/lib/charCount";

/** A small ring that fills as you type and turns red past the limit, with «۶۲/۷۰» beside it
 *  (owner, 2026-11-05). Put it under a text box that has a limit. */
export default function CharCount({ text, max }: { text: string; max: number }) {
  const c = charCount(text, max);
  const r = 7;
  const len = 2 * Math.PI * r;
  return (
    <span className="charcount" data-over={c.over || undefined} aria-live="polite">
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
        <circle cx="9" cy="9" r={r} className="charcount__track" />
        <circle cx="9" cy="9" r={r} className="charcount__fill" strokeDasharray={len} strokeDashoffset={len * (1 - Math.min(1, c.share))} />
      </svg>
      <span dir="ltr">{c.label}</span>
    </span>
  );
}
