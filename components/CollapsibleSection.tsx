"use client";

import { createContext, useContext, useState, useSyncExternalStore } from "react";
import { faNum } from "@/lib/format";
import { matchesQuery } from "@/lib/persian";
import { Icon, type IconName } from "@/components/meridian/Icon";

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

/* The remembered fold state is an external store (localStorage), so it is read as one rather
   than copied into state by an effect: the server snapshot is `null` ("nothing remembered"),
   so a server render and the hydrating render agree, and the stored value takes over in the
   same commit instead of a frame later. Same-tab writes notify through `panelListeners`
   because the browser only fires `storage` in OTHER tabs. */
const PANEL_PREFIX = "coverage_panel_";
const panelListeners = new Set<() => void>();

function subscribePanels(onChange: () => void): () => void {
  panelListeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    panelListeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readPanel(storageKey: string | undefined): string | null {
  if (!storageKey) return null;
  try {
    return localStorage.getItem(PANEL_PREFIX + storageKey);
  } catch {
    // Private mode and blocked site data both throw on access.
    return null;
  }
}

export default function CollapsibleSection({
  title,
  icon,
  count,
  storageKey,
  defaultOpen = false,
  forceOpen,
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
  icon?: IconName;
  /** Rendered as "title (count)" when given. Omit for sections that aren't a list. */
  count?: number;
  /** localStorage suffix. Omitted means the section does not remember its state --
   *  correct for sections that only appear under some condition. */
  storageKey?: string;
  defaultOpen?: boolean;
  /** Forces the fold open, beating the remembered state in both directions.
   *
   *  For a section holding something the reader must not miss -- a day split waiting to be
   *  looked at. `defaultOpen` cannot do this: it only seeds the local state, and a remembered
   *  choice then overrides it, so a section the reader collapsed once would keep a
   *  live proposal hidden inside it. Omitted everywhere else, so nothing else changes. */
  forceOpen?: boolean;
  /** Extra words the filter should match. A section called «تنظیمات» is where you go
   *  looking for "GPS" or "اعلان", and its title says neither. */
  keywords?: string;
  /** Small always-visible control shown in the header, for a section whose main
   *  affordance is a single switch that shouldn't need opening to reach. */
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  // Initial state is `defaultOpen` (server-safe); a remembered choice, once the client can
  // read it, wins. A section that remembers nothing (no storageKey, or storage blocked) just
  // keeps its local state, so the fold still works -- it simply is not persisted.
  const [local, setLocal] = useState(defaultOpen);
  const stored = useSyncExternalStore(subscribePanels, () => readPanel(storageKey), () => null);
  const open = stored === "1" ? true : stored === "0" ? false : local;

  const filter = useContext(SectionFilterContext).trim();
  if (filter && !matchesQuery(`${title} ${keywords ?? ""}`, filter)) return null;

  // While filtering, a matching section is shown open regardless of its stored state:
  // the user has just asked for it by name, and handing back a closed heading answers
  // the search with another click. The stored value is left alone, so the arrangement
  // they set up is still there when the box is cleared.
  // `??` and not `||`, so an explicit `false` means "no" rather than falling through to the
  // remembered state. A truthiness check here would be the same mistake as testing a click
  // event for truth to decide it was a list of ids.
  const expanded = filter ? true : (forceOpen ?? open);

  function toggle() {
    const next = !open;
    setLocal(next);
    if (!storageKey) return;
    try {
      localStorage.setItem(PANEL_PREFIX + storageKey, next ? "1" : "0");
    } catch {
      // Storage unavailable -- the fold still works, it just won't be remembered.
    }
    panelListeners.forEach((notify) => notify());
  }

  return (
    <section className="sect">
      <div className="sect__head">
        <button
          onClick={toggle}
          aria-expanded={expanded}
          className={`sect__btn${expanded ? " on" : ""}`}
        >
          {icon && (
            <span aria-hidden="true" className="sect__icon">
              <Icon name={icon} size="sm" />
            </span>
          )}
          <span className="sect__title">{title}</span>
          {count !== undefined && <span className="sect__count mono">{faNum(count)}</span>}
          <span aria-hidden="true" className="sect__chev">
            <Icon name="chevron-down" size="sm" />
          </span>
        </button>
        {right}
      </div>
      {expanded && <div className="sect__body">{children}</div>}
    </section>
  );
}
