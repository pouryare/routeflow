"use client";

import { MAX_STARS } from "@/lib/leadScore";
import { faNum } from "@/lib/format";
import { Icon } from "@/components/meridian/Icon";

/** A row of stars for one criterion.
 *
 *  Tapping the star you already gave clears the score rather than re-setting it to the
 *  same value. Without that there is no way back to "not judged" once you have touched
 *  it by accident, and "not judged" is a state this genuinely needs -- a place you have
 *  not been to is not a place you rated one star.
 */
export default function StarRating({
  value,
  onChange,
  label,
  disabled = false,
}: {
  value: number | null;
  onChange: (next: number | null) => void;
  /** Names the criterion to a screen reader, which otherwise hears five identical buttons. */
  label: string;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex items-center gap-0.5">
      {Array.from({ length: MAX_STARS }, (_, i) => {
        const star = i + 1;
        const filled = value !== null && star <= value;
        return (
          <button
            key={star}
            type="button"
            role="radio"
            aria-checked={value === star}
            aria-label={`${label}: ${faNum(star)} از ${faNum(MAX_STARS)}`}
            disabled={disabled}
            onClick={() => onChange(value === star ? null : star)}
            className={`inline-flex min-h-11 min-w-9 items-center justify-center px-0.5 text-[length:var(--text-md)] leading-none transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)] disabled:opacity-40 ${
              filled ? "text-warn" : "text-text-faint hover:text-warn"
            }`}
          >
            <Icon name="star" size="sm" filled={filled} />
          </button>
        );
      })}
    </div>
  );
}
