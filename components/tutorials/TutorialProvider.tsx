"use client";

import { createPortal } from "react-dom";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { Role } from "@/lib/roles";
import type { Tutorial, TutorialProgress } from "@/lib/tutorials/types";
import { TUTORIALS, tutorialById } from "@/lib/tutorials/catalog";
import { DEMO_SETS } from "@/lib/tutorials/demo";
import { firstSteps, offerFor, wantsGhost, withDone, withOffer } from "@/lib/tutorials/engine";
import { pretendBody, pretendFor, setPretending } from "@/lib/tutorials/pretend";
import { tehranTodayIso } from "@/lib/jalali";
import { playSound } from "@/lib/sound";
import { prefetchVoice } from "./voice";
import { celebrate } from "@/lib/celebrate";
import TourCard from "./TourCard";
import OfferChip from "./OfferChip";

/** One provider in the root layout runs every tutorial (plan docs/plans/tutorials-2026-11-05.md).
 *
 *  - It learns the person's role and progress from GET /api/tutorials; signed out it stays inert.
 *  - The first sign-in starts the bottom-bar tour by itself; every other tutorial offers itself with a
 *    chip the first time its screen opens, twice at most (lib/tutorials/engine.ts).
 *  - While a tutorial runs, writes are answered in the browser and never sent (lib/tutorials/pretend.ts),
 *    unless the tutorial is a real setup job (`real`), and lists show the tutorial's demo set
 *    (useTutorialData). Ending it switches both off: the real rows are still in memory, so they come
 *    back at once, and router.refresh() fetches anything new without reloading the page.
 *  - A job of three taps or more is first played by the ghost hand, then «حالا شما». */

export type TourMode = "ghost" | "learn" | "practice";
/** `shown`: the ghost hand has already played this job once, so the first step says «حالا شما». */
type Active = { t: Tutorial; i: number; mode: TourMode; shown?: boolean };

export type SentTutorial = { id: number; tutorial_id: string; sent_by_name: string };

type Ctx = {
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

const TutorialContext = createContext<Ctx>({
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

function save(progress: TutorialProgress) {
  void fetch("/api/prefs", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tutorials: progress }),
  }).catch(() => undefined);
}

function mark(id: string, what: "seen" | "done") {
  void fetch("/api/tutorials/seen", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, what }),
  }).catch(() => undefined);
}

function count(id: string, step: number, event: "start" | "skip" | "quit" | "done") {
  void fetch("/api/tutorials/stats", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, step, event }),
  }).catch(() => undefined);
}

export default function TutorialProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [role, setRole] = useState<Role | null>(null);
  const [progress, setProgress] = useState<TutorialProgress>({});
  const [assignments, setAssignments] = useState<SentTutorial[]>([]);
  const [active, setActive] = useState<Active | null>(null);
  const [offer, setOffer] = useState<Tutorial | null>(null);
  const progressRef = useRef(progress);
  // Idea I11: once the role is known and the page has settled, download its own clips for offline.
  useEffect(() => {
    if (!role) return;
    const clips = TUTORIALS.filter((t) => t.roles.includes(role)).flatMap((t) => t.steps.map((_, i) => `${t.id}-${i}`));
    const id = window.setTimeout(() => void prefetchVoice(clips), 8000);
    return () => window.clearTimeout(id);
  }, [role]);

  useEffect(() => {
    progressRef.current = progress;
  }, [progress]);

  useEffect(() => {
    let stopped = false;
    void fetch("/api/tutorials", { cache: "no-store" })
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as { ok?: boolean; role?: Role; progress?: TutorialProgress; assignments?: SentTutorial[] } | null;
        if (stopped || !res.ok || !data?.ok || !data.role) return;
        setRole(data.role);
        setProgress(data.progress ?? {});
        setAssignments(data.assignments ?? []);
      })
      .catch(() => undefined);
    return () => {
      stopped = true;
    };
  }, []);

  const update = useCallback((next: TutorialProgress) => {
    setProgress(next);
    save(next);
  }, []);

  const start = useCallback((id: string, mode: "learn" | "practice" = "learn") => {
    const t = tutorialById(id);
    if (!t) return;
    setOffer(null);
    count(t.id, 0, "start");
    mark(t.id, "seen");
    // Started from the list or the search, the tutorial first walks to the screen it is about.
    const first = t.steps[0]?.path ?? t.screen;
    if (first && !location.pathname.startsWith(first.split("?")[0])) router.push(first);
    setActive({ t, i: 0, mode: mode === "learn" && wantsGhost(t) ? "ghost" : mode });
  }, [router]);

  const stop = useCallback(
    (how: "done" | "skip" | "quit") => {
      setActive((a) => {
        if (!a) return null;
        count(a.t.id, a.i, how);
        if (how === "done" && a.mode !== "practice") {
          mark(a.t.id, "done");
          setAssignments((list) => list.filter((x) => x.tutorial_id !== a.t.id));
          const next = withDone(progressRef.current, a.t.id);
          update(next);
          playSound("action.done");
          if (role) {
            const fs = firstSteps(role, next, TUTORIALS);
            if (fs.complete && !(next.celebrated ?? []).includes(role)) {
              update({ ...next, celebrated: [...(next.celebrated ?? []), role] });
              void celebrate();
              playSound("badge.shown");
            }
          }
        }
        return null;
      });
      // The real rows are back in memory already; this only fetches what changed meanwhile.
      router.refresh();
    },
    [role, router, update],
  );

  const next = useCallback(() => {
    setActive((a) => {
      if (!a) return a;
      if (a.i + 1 < a.t.steps.length) {
        playSound("progress.step");
        return { ...a, i: a.i + 1 };
      }
      if (a.mode === "ghost") {
        // The hand has shown the whole job: back to the first screen, «حالا شما».
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        const first = a.t.steps[0]?.path ?? a.t.screen;
        if (first && location.pathname !== first) router.push(first);
        return { ...a, i: 0, mode: "learn", shown: true };
      }
      queueMicrotask(() => stop("done"));
      return a;
    });
  }, [router, stop]);

  const toLearn = useCallback(() => {
    setActive((a) => {
      if (!a || a.mode !== "ghost") return a;
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      const first = a.t.steps[0]?.path ?? a.t.screen;
      if (first && location.pathname !== first) router.push(first);
      return { ...a, i: 0, mode: "learn", shown: true };
    });
  }, [router]);

  /* Pretend saves: while a tutorial runs, a write never leaves the phone. */
  const pretend = active !== null && !(active.t.real && active.mode === "learn");
  useEffect(() => {
    if (!pretend) return;
    setPretending(true);
    const real = window.fetch;
    let n = 0;
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? (input instanceof Request ? input.method : "GET");
      if (pretendFor(method, url) === "fake") {
        n += 1;
        return Promise.resolve(new Response(JSON.stringify(pretendBody(n)), { status: 200, headers: { "Content-Type": "application/json" } }));
      }
      return real(input, init);
    };
    return () => {
      window.fetch = real;
      setPretending(false);
    };
  }, [pretend]);

  /* The bottom-bar tour starts by itself once; other screens offer theirs with the chip. Both wait a
     moment after a page opens, so the chip does not jump in while the page is still drawing. */
  useEffect(() => {
    if (!role || active) return;
    const id = window.setTimeout(() => {
      const p = progressRef.current;
      const today = tehranTodayIso();
      const bar = TUTORIALS.find((t) => t.autoStart && t.roles.includes(role) && (pathname === t.screen || pathname.startsWith(`${t.screen}/`)));
      if (bar && !(p.done ?? []).includes(bar.id) && !p.offered?.[bar.id]?.length) {
        update(withOffer(p, bar.id, today));
        start(bar.id);
        return;
      }
      const t = offerFor(pathname, role, p, today, TUTORIALS);
      setOffer(t);
      if (t) update(withOffer(p, t.id, today));
    }, 600);
    return () => window.clearTimeout(id);
  }, [role, pathname, active, start, update]);

  const value = useMemo<Ctx>(() => ({ role, progress, assignments, active, start, stop, next, toLearn }), [role, progress, assignments, active, start, stop, next, toLearn]);

  return (
    <TutorialContext.Provider value={value}>
      {children}
      <Layer>
        {active ? <TourCard key={`${active.t.id}:${active.mode}:${active.i}`} /> : null}
        {!active && offer ? <OfferChip t={offer} onStart={() => start(offer.id)} onLater={() => setOffer(null)} /> : null}
      </Layer>
    </TutorialContext.Provider>
  );
}

/** Drawn inside the `.meridian` root, where the tokens live (the same host HeroUI's overlays use). */
const noop = () => () => undefined;

function Layer({ children }: { children: ReactNode }) {
  // Nothing on the server or in the first client render (no hydration mismatch); after that, the
  // current root, looked up on every render because the shell and the bare pages each draw their own.
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  const host = mounted ? (document.querySelector<HTMLElement>(".meridian") ?? document.body) : null;
  return host ? createPortal(children, host) : null;
}
