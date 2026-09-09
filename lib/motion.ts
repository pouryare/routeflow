/** framer-motion presets, mirroring MASTER.md "Motion".
 *
 *  MASTER.md is the single source for every curve and duration. This file restates the
 *  subset that framer-motion drives, in framer-motion's units (seconds, and a
 *  cubic-bezier as a 4-tuple). The pure-CSS entrance (RevealRoute / RouteFade) keeps its
 *  own copy in app/globals.css — the two must not drift, so any change here is a change
 *  there.
 *
 *  Nothing in this module touches the DOM, so it is safe to import from a server
 *  component that only reads the constants.
 */

/** Curves. Values are cubic-bezier control points, verbatim from MASTER.md "Curves". */
export const EASE = {
  /** The default. Fast out, soft landing, no overshoot. `--ease-out`. */
  out: [0.16, 1, 0.3, 1] as [number, number, number, number],
  /** Slight overshoot. Small controls, toggles, chips. `--spring-snap`. */
  snap: [0.34, 1.26, 0.64, 1] as [number, number, number, number],
  /** Clear overshoot. Shape morphs, sheets, entrances. `--spring-pop`. */
  pop: [0.34, 1.56, 0.64, 1] as [number, number, number, number],
  /** Heavy settle. A dragged object landing. `--spring-drop`. */
  drop: [0.22, 1.61, 0.36, 1] as [number, number, number, number],
};

/** Durations in SECONDS (framer-motion's unit), from MASTER.md "Durations" (ms / 1000). */
export const DUR = {
  fast: 0.12, // --dur-fast: press/active feedback
  base: 0.18, // --dur-base: hover, focus, small transitions
  slow: 0.3, // --dur-slow: panel/modal enter-exit
  morph: 0.42, // --dur-morph: island collapse↔expand
  settle: 0.32, // --dur-settle: drag release, card landing
  draw: 0.7, // --dur-draw: chart line draw, number count-up
} as const;

/** Stagger gaps in SECONDS, from MASTER.md "Durations". */
export const STAGGER = {
  tight: 0.02, // table rows
  base: 0.04, // board cards, list items
  loose: 0.06, // bento tiles, sidebar sections
} as const;

/** MASTER.md "Interaction thesis": a sequence past ten items stops reading as rhythm, so
 *  item eleven onward shares item ten's delay. */
export const STAGGER_CAP = 10;

/** Given a reduced-motion flag, either the transition as written or an instant one.
 *  MASTER.md "Reduced motion": the entrance becomes an immediate paint, not a slow one. */
export function withReducedMotion<T extends object>(
  transition: T,
  reduced: boolean,
): T | { duration: 0 } {
  return reduced ? { duration: 0 } : transition;
}

/** The standard panel/popover enter-exit, for AnimatePresence children. */
export const popover = {
  initial: { opacity: 0, y: -4 },
  animate: { opacity: 1, y: 0, transition: { duration: DUR.slow, ease: EASE.out } },
  exit: { opacity: 0, y: -4, transition: { duration: DUR.fast, ease: EASE.out } },
} as const;

/** The Tier-0 "rise 16px and fade" entrance, as a variants pair. */
export const riseIn = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: DUR.slow, ease: EASE.out } },
} as const;
