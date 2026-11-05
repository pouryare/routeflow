import type { Role } from "@/lib/roles";
import type { Tutorial } from "./types";
import { VAN_TUTORIALS } from "./content/van";
import { SHELL_TUTORIALS } from "./content/shell";
import { SAY } from "./content/say";

/** Every tutorial in the app, one list (plan docs/plans/tutorials-2026-11-05.md). Text is drafted in
 *  plain Persian and reviewed by the owner in the pull request; `say` carries the diacritics for the
 *  voice. A new main button gets its tutorial here (CLAUDE.md, tutorials rule). */
/** A step with no `say` of its own takes the diacritised line from content/say.ts, by its card text. */
export const TUTORIALS: readonly Tutorial[] = [...VAN_TUTORIALS, ...SHELL_TUTORIALS].map((t) => ({
  ...t,
  steps: t.steps.map((s) => (s.say || !SAY[s.text] ? s : { ...s, say: SAY[s.text] })),
}));

export const TUTORIAL_IDS: ReadonlySet<string> = new Set(TUTORIALS.map((t) => t.id));

export const tutorialById = (id: string) => TUTORIALS.find((t) => t.id === id);

/** Who may send a tutorial to a person and see sent, seen and done (idea I7). */
export const TUTOR_ROLES: Role[] = ["platform_owner", "owner", "group_manager", "rep_manager"];
