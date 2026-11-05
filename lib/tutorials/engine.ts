/** The rules of tutorials, kept pure so they are tested: who sees which tutorial, when the
 *  just-in-time chip may ask (twice at most, idea I1), what counts as done, and the «چطور…؟»
 *  search (idea I2). The screen parts in components/tutorials only call these. */
import type { Role } from "@/lib/roles";
import type { Tutorial, TutorialProgress } from "./types";

export function tutorialsFor(role: Role, all: readonly Tutorial[]): Tutorial[] {
  return all.filter((t) => t.roles.includes(role));
}

export const isDone = (p: TutorialProgress, id: string) => (p.done ?? []).includes(id);

/** The chip asks the first time, once more on a later day after «بعداً», and then never again. */
export function mayOffer(p: TutorialProgress, id: string, today: string): boolean {
  if (isDone(p, id)) return false;
  const seen = p.offered?.[id] ?? [];
  if (seen.length === 0) return true;
  if (seen.length === 1) return seen[0] < today;
  return false;
}

/** The tutorial to offer on this page: the one whose screen is the longest match for the path
 *  (so /sales/payments beats /sales), among those this role may see and has not been asked twice. */
export function offerFor(pathname: string, role: Role, p: TutorialProgress, today: string, all: readonly Tutorial[]): Tutorial | null {
  const matches = tutorialsFor(role, all)
    .filter((t) => pathname === t.screen || pathname.startsWith(`${t.screen}/`))
    .filter((t) => mayOffer(p, t.id, today))
    .sort((a, b) => b.screen.length - a.screen.length);
  return matches[0] ?? null;
}

export function withOffer(p: TutorialProgress, id: string, today: string): TutorialProgress {
  const seen = p.offered?.[id] ?? [];
  if (seen.includes(today) || seen.length >= 2) return p;
  return { ...p, offered: { ...p.offered, [id]: [...seen, today] } };
}

export function withDone(p: TutorialProgress, id: string): TutorialProgress {
  if (isDone(p, id)) return p;
  return { ...p, done: [...(p.done ?? []), id] };
}

/** The role's «اولین قدم‌ها» checklist and how far the person is through it. */
export function firstSteps(role: Role, p: TutorialProgress, all: readonly Tutorial[]) {
  const items = tutorialsFor(role, all).filter((t) => t.firstSteps);
  const done = items.filter((t) => isDone(p, t.id)).length;
  return { items, done, total: items.length, complete: items.length > 0 && done === items.length };
}

/** The ghost hand plays a job once before «حالا شما» when it takes three taps or more (idea I5). */
export const wantsGhost = (t: Tutorial) => t.steps.filter((s) => s.target && (s.advance ?? "tap") === "tap").length >= 3;

/** Persian text as people type it: Arabic ي and ك become ی and ک, the half-space and extra spaces
 *  fold, so «ثبت چك» finds «ثبت چک». */
export function foldPersian(s: string): string {
  return s
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[‌‏‎]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** «چطور…؟»: every word typed must appear in the title or keywords. A leading «چطور» is ignored. */
export function searchTutorials(query: string, role: Role, all: readonly Tutorial[]): Tutorial[] {
  const words = foldPersian(query).replace(/^چطور\s*/, "").replace(/[؟?]/g, "").split(" ").filter(Boolean);
  if (words.length === 0) return [];
  return tutorialsFor(role, all).filter((t) => {
    const hay = foldPersian([t.title, ...(t.keywords ?? [])].join(" "));
    return words.every((w) => hay.includes(w));
  });
}

const ID = /^[a-z0-9-]{1,60}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Whether a value may be stored as `prefs_json.tutorials`: known shape, short lists, no stray keys. */
export function isProgress(v: unknown, known: ReadonlySet<string>): v is TutorialProgress {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  if (Object.keys(o).some((k) => !["done", "offered", "celebrated"].includes(k))) return false;
  const ids = (x: unknown, max: number) => Array.isArray(x) && x.length <= max && x.every((i) => typeof i === "string" && ID.test(i));
  if (o.done !== undefined && !(ids(o.done, 300) && (o.done as string[]).every((i) => known.has(i)))) return false;
  // Roles, which carry an underscore («delivery_driver»).
  if (o.celebrated !== undefined && !(Array.isArray(o.celebrated) && o.celebrated.length <= 20 && o.celebrated.every((r) => typeof r === "string" && /^[a-z_]{1,30}$/.test(r)))) return false;
  if (o.offered !== undefined) {
    if (!o.offered || typeof o.offered !== "object" || Array.isArray(o.offered)) return false;
    const entries = Object.entries(o.offered as Record<string, unknown>);
    if (entries.length > 300) return false;
    for (const [k, days] of entries) {
      if (!known.has(k)) return false;
      if (!Array.isArray(days) || days.length > 2 || !days.every((d) => typeof d === "string" && DAY.test(d))) return false;
    }
  }
  return true;
}
