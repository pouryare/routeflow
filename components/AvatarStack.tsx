import { faNum } from "@/lib/format";

export interface StackPerson {
  /** Used for the initials and the accessible name. */
  name: string;
  /** Shown as a small badge on the corner. Omit when there is nothing to report --
   *  a badge reading zero is worse than no badge, because it draws the eye to say
   *  nothing. */
  count?: number;
}

/** Initials in a squircle.
 *
 *  The users table has display names and no images. Filling that gap with stock
 *  photography or a generated face would attach a likeness to a real employee that is not
 *  theirs, and a letter avatar is honest about exactly what the system knows. Squircle
 *  rather than a circle for the same reason MASTER.md picks it elsewhere -- a grid of
 *  perfect circles is the most generic shape an interface can wear.
 */
export function Avatar({
  name,
  size = 28,
  count,
  title,
}: {
  name: string;
  size?: number;
  count?: number;
  title?: string;
}) {
  // Two initials from the first two words. Persian names split on whitespace the same way
  // Latin ones do, and taking the first letter of each survives both.
  const initials = name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("");

  return (
    <span className="relative inline-flex shrink-0" title={title ?? name}>
      <span
        aria-hidden="true"
        style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
        className="inline-flex items-center justify-center rounded-[35%] border border-[var(--border-strong)] bg-[var(--surface)] font-medium text-[var(--text-muted)]"
      >
        {initials}
      </span>
      <span className="sr-only">{name}</span>
      {count !== undefined && count > 0 && (
        <span
          aria-hidden="true"
          style={{ fontSize: Math.max(9, Math.round(size * 0.3)) }}
          className="absolute -bottom-1 -left-1 inline-flex min-w-[14px] items-center justify-center rounded-full border border-[var(--surface)] bg-[var(--accent)] px-[3px] font-mono leading-[14px] text-accent-ink"
        >
          {faNum(count)}
        </span>
      )}
    </span>
  );
}

/** A row of people, overlapping.
 *
 *  Capped at five with a `+N` chip. Past that the row stops being a set of faces and turns
 *  into a texture -- and on a phone it simply runs out of card to sit on.
 */
export default function AvatarStack({
  people,
  size = 28,
  max = 5,
  className = "",
}: {
  people: StackPerson[];
  size?: number;
  max?: number;
  className?: string;
}) {
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;

  return (
    // The negative inline margin is what produces the overlap. A logical property, so the
    // stack leans the same way the text reads: in RTL the first person is rightmost and
    // each subsequent one tucks under the one before it.
    <span className={`inline-flex items-center ${className}`} style={{ gap: 0 }}>
      {shown.map((p, i) => (
        <span
          key={`${p.name}-${i}`}
          style={{ marginInlineStart: i === 0 ? 0 : -8, zIndex: shown.length - i }}
          className="relative"
        >
          <Avatar name={p.name} size={size} count={p.count} />
        </span>
      ))}

      {rest > 0 && (
        <span
          style={{ width: size, height: size, fontSize: Math.round(size * 0.34), marginInlineStart: -8 }}
          className="relative inline-flex items-center justify-center rounded-[35%] border border-[var(--border-strong)] bg-[var(--surface-raised)] font-mono text-[var(--text-muted)]"
        >
          +{faNum(rest)}
        </span>
      )}
    </span>
  );
}
