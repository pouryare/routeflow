import type { Role } from "@/lib/roles";

/** One step of a tutorial: a short Persian line on the bottom card, and usually a button to point at.
 *
 *  - `target` is a `data-tour` id on the screen (`<button data-tour="run-start">`). With no target the
 *    step is a plain card with «ادامه».
 *  - `advance` says what moves the tutorial on: the person really tapping the target (`"tap"`, the
 *    default when there is a target), or «ادامه» on the card (`"next"`, the default without one).
 *  - `path` is the page the step lives on. When the person is elsewhere, the card offers «برو».
 */
type TutorialStep = {
  text: string;
  /** The same line with diacritics («بَرایِ ثَبتِ چِک»), read by the voice only; the card shows `text`. */
  say?: string;
  target?: string;
  advance?: "tap" | "next";
  path?: string;
};

export type Tutorial = {
  id: string;
  title: string;
  /** Who it is for. A tutorial never shows to a role outside this list. */
  roles: readonly Role[];
  /** The page (or page prefix) where it belongs: the first visit there offers it once (idea I1). */
  screen: string;
  /** Extra words people may type into «چطور…؟» search besides the title. */
  keywords?: readonly string[];
  /** Part of the role's «اولین قدم‌ها» checklist on the today page. */
  firstSteps?: boolean;
  /** Demo set the page shows while this tutorial runs (lib/tutorials/demo.ts). */
  demo?: string;
  /** A real setup job (add a product, add a staff account): saves go through for real. Never set on a
   *  tutorial that records money or sends a message. Practice runs stay pretend. */
  real?: boolean;
  /** false: no ghost demo, because a step needs typing or a real choice the hand cannot make. */
  ghost?: boolean;
  /** Starts by itself on the first sign-in (the bottom-bar tour), instead of offering a chip. */
  autoStart?: boolean;
  steps: readonly TutorialStep[];
};

/** What one person has done with tutorials, kept in `users.prefs_json.tutorials`. */
export type TutorialProgress = {
  /** Finished tutorial ids. */
  done?: string[];
  /** When the just-in-time chip was shown for a tutorial (Tehran dates, at most two). */
  offered?: Record<string, string[]>;
  /** The role sets whose badge and confetti have already played. */
  celebrated?: string[];
};
