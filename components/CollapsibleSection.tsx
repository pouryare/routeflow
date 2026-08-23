"use client";

import { createContext, useContext, useState } from "react";
import { faNum } from "@/lib/format";
import { matchesQuery } from "@/lib/persian";

// Progressive disclosure for the map sidebar. Originally written for the two customer
// lists that can legitimately run to dozens of rows; now every sidebar section uses it,
// because a panel of thirteen always-open sections is a scroll, not a control surface.
//
// Open state persists per section. The point of folding is that you arrange the panel
// once around the handful of things you actually touch -- an arrangement that resets on
// every page load would be worse than no folding at all.
/** The sidebar's section filter, read by every section so they can hide themselves.
 *
 *  A context rather than props because sections are scattered across the sidebar's
 *  markup at several nesting depths, and threading a query string through all of them
 *  would touch a dozen call sites to add nothing any of them cares about. */
export const SectionFilterContext = createContext<string>("");

export default function CollapsibleSection({
  title,
  icon,
  count,
  titleClassName,
  storageKey,
  defaultOpen = false,
  keywords,
  right,
  children,
}: {
  title: string;
  /** One emoji, shown in a tile before the title.
   *
   *  Twelve headings in the same monospace uppercase are twelve identical grey lines,
   *  and finding one means reading all of them. A glyph is what the eye actually lands
   *  on, and it survives being scanned at arm's length in a vehicle, which the 11px
   *  label does not. */
  icon?: string;
  /** Rendered as "title (count)" when given. Omit for sections that aren't a list. */
  count?: number;
  titleClassName?: string;
  /** localStorage suffix. Omitted means the section does not remember its state --
   *  correct for sections that only appear under some condition. */
  storageKey?: string;
  defaultOpen?: boolean;
  /** Extra words the filter should match. A section called «تنظیمات» is where you go
   *  looking for "GPS" or "اعلان", and its title says neither. */
  keywords?: string;
  /** Small always-visible control shown in the header, for a section whose main
   *  affordance is a single switch that shouldn't need opening to reach. */
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  // Read in the initialiser rather than an effect. The usual reason to defer this is
  // that localStorage doesn't exist during a server render -- but the sidebar lives
  // inside CoverageMap, which is imported with `ssr: false`, so there is no server pass
  // to mismatch. Deferring would render every section closed for one frame and then pop
  // the remembered ones open, which is a visible flicker on every load.
  const [open, setOpen] = useState(() => {
    if (!storageKey || typeof window === "undefined") return defaultOpen;
    try {
      const stored = localStorage.getItem(`coverage_panel_${storageKey}`);
      return stored === "1" ? true : stored === "0" ? false : defaultOpen;
    } catch {
      // Private mode and blocked site data both throw on access.
      return defaultOpen;
    }
  });

  const filter = useContext(SectionFilterContext).trim();
  if (filter && !matchesQuery(`${title} ${keywords ?? ""}`, filter)) return null;

  // While filtering, a matching section is shown open regardless of its stored state:
  // the user has just asked for it by name, and handing back a closed heading answers
  // the search with another click. The stored value is left alone, so the arrangement
  // they set up is still there when the box is cleared.
  const expanded = filter ? true : open;

  function toggle() {
    setOpen((v) => {
      const next = !v;
      try {
        if (storageKey) localStorage.setItem(`coverage_panel_${storageKey}`, next ? "1" : "0");
      } catch {
        // Storage unavailable -- the fold still works, it just won't be remembered.
      }
      return next;
    });
  }

  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <button
          onClick={toggle}
          aria-expanded={expanded}
          className={`group flex min-w-0 flex-1 items-center gap-2.5 rounded-[var(--radius-md)] py-1 text-right transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:bg-white/[0.03] ${
            titleClassName ?? "text-text-muted"
          }`}
        >
          {icon && (
            <span
              aria-hidden="true"
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[length:var(--text-sm)] transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] ${
                expanded ? "bg-accent/15" : "bg-white/5 group-hover:bg-accent/15"
              }`}
            >
              {icon}
            </span>
          )}
          <span className="min-w-0 flex-1 truncate font-mono text-[length:var(--text-xs)] uppercase tracking-wide transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] group-hover:text-accent">
            {title}
          </span>
          {count !== undefined && (
            /* Its own chip rather than "(12)" appended to the label: the count is the
               part you are actually reading when you scan the panel for what needs
               attention, and inside the title it is just more monospace text. */
            <span
              className={`shrink-0 rounded-full px-1.5 py-0.5 font-mono text-[10px] leading-none transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] ${
                count > 0 ? "bg-white/10 text-text" : "text-text-faint"
              }`}
            >
              {faNum(count)}
            </span>
          )}
          <span
            className="shrink-0 text-text-faint transition-transform duration-[var(--dur-base)] ease-[var(--ease-out)]"
            style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}
          >
            ▾
          </span>
        </button>
        {right && <div className="shrink-0">{right}</div>}
      </div>
      {expanded && children}
    </section>
  );
}
