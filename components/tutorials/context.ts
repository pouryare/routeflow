"use client";

import { createContext, useContext } from "react";
import type { Role } from "@/lib/roles";
import type { Tutorial, TutorialProgress } from "@/lib/tutorials/types";
import { DEMO_SETS } from "@/lib/tutorials/demo";

/** The tutorial context, apart from the provider so the tour card can read it without a cycle. */

type TourMode = "ghost" | "learn" | "practice";
/** `shown`: the ghost hand has already played this job once, so the first step says «حالا شما». */
export type Active = { t: Tutorial; i: number; mode: TourMode; shown?: boolean };

export type SentTutorial = { id: number; tutorial_id: string; sent_by_name: string };

export type Ctx = {
  role: Role | null;
  progress: TutorialProgress;
  /** Tutorials a manager sent this person and they have not finished (idea I7). */
  assignments: SentTutorial[];
  active: Active | null;
  start: (id: string, mode?: "learn" | "practice") => void;
  stop: (how: "done" | "skip" | "quit") => void;
  next: () => void;
  /** Leave the ghost demo and do the job yourself from step 1. */
  toLearn: () => void;
};

export const TutorialContext = createContext<Ctx>({
  role: null,
  progress: {},
  assignments: [],
  active: null,
  start: () => undefined,
  stop: () => undefined,
  next: () => undefined,
  toLearn: () => undefined,
});

export const useTutorials = () => useContext(TutorialContext);

/** Demo rows while a tutorial with a demo set runs, the real ones otherwise. One line per list:
 *  `const tasks = useTutorialData("tasks", props.tasks)`. */
export function useTutorialData<T>(key: string, real: T): T {
  const { active } = useContext(TutorialContext);
  const set = active?.t.demo ? DEMO_SETS[active.t.demo] : undefined;
  return set && key in set ? (set[key] as T) : real;
}

