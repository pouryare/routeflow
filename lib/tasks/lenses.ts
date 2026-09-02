/** The three lenses of the task Board, and the one function that says what dropping a
 *  card in a lane means. Pure — no DB, no I/O. The API (`moveTask`) and every test call
 *  `movePatch`; the client never re-implements the mapping.
 *
 *  A task carries a canonical `status` (open | in_progress | done) and, for the kinds
 *  that have a pipeline, a `stage`. `stage` is nullable: NULL means "derive it from the
 *  status", so a task made before this feature or by a Phase 7 rule still lands in the
 *  right workflow lane. Any move writes a fresh stage back, so it stays accurate.
 */

export type BoardView = "status" | "time" | "workflow";

export interface Lane {
  id: string;
  label: string;
}

export interface TaskLensFields {
  kind: string;
  status: string;
  stage: string | null;
  due_at: string | null;
}

const STATUS_LANES: Lane[] = [
  { id: "open", label: "باز" },
  { id: "in_progress", label: "در حال انجام" },
  { id: "done", label: "انجام‌شده" },
];

const TIME_LANES: Lane[] = [
  { id: "backlog", label: "بکلاگ" },
  { id: "today", label: "امروز" },
  { id: "week", label: "این هفته" },
  { id: "done", label: "انجام‌شده" },
];

/** Per-kind workflow pipeline. Only these three kinds get one; every other kind shows
 *  under the status columns in the workflow lens. First entry = "just started",
 *  last entry = "closed". */
export const STAGES: Record<string, readonly string[]> = {
  outreach: ["call", "waiting", "scheduled", "done"],
  order: ["pending", "ready", "transit", "delivered"],
  visit: ["plan", "enroute", "done"],
};

const STAGE_LABELS: Record<string, string> = {
  call: "تماس بگیر",
  waiting: "تماس گرفته / منتظر",
  scheduled: "پیگیری زمان‌بندی‌شده",
  pending: "در انتظار",
  ready: "آماده",
  transit: "در مسیر",
  delivered: "تحویل شد",
  plan: "برنامه‌ریزی",
  enroute: "در راه",
  done: "انجام‌شده",
};

export function lanesFor(view: BoardView, kind?: string): Lane[] {
  if (view === "status") return STATUS_LANES;
  if (view === "time") return TIME_LANES;
  const stages = kind ? STAGES[kind] : undefined;
  if (!stages) return STATUS_LANES;
  return stages.map((id) => ({ id, label: STAGE_LABELS[id] ?? id }));
}

export function stageFromStatus(kind: string, status: string): string | null {
  const s = STAGES[kind];
  if (!s) return null;
  if (status === "open") return s[0];
  if (status === "done") return s[s.length - 1];
  return s[Math.min(1, s.length - 2)];
}

export function statusFromStage(kind: string, stage: string): string {
  const s = STAGES[kind];
  if (!s) return "in_progress";
  const i = s.indexOf(stage);
  if (i <= 0) return "open";
  if (i === s.length - 1) return "done";
  return "in_progress";
}

const ymd = (iso: string): string => iso.slice(0, 10);

/** Days from the given instant to the end of its Jalali week (Friday). The Jalali week
 *  runs Saturday→Friday, and Sat/Sun/…/Fri are the same physical days in both calendars,
 *  so the Gregorian weekday is enough — no calendar conversion needed. JS `getUTCDay()`
 *  is Sunday=0…Saturday=6; shift so Saturday=0…Friday=6. */
function daysToWeekEnd(nowIso: string): number {
  const jIndex = (new Date(nowIso).getUTCDay() + 1) % 7; // Sat=0 … Fri=6
  return 6 - jIndex;
}

export function bucket(due_at: string | null, nowIso: string): "backlog" | "today" | "week" {
  if (!due_at) return "backlog";
  const today = ymd(nowIso);
  const due = ymd(due_at);
  if (due <= today) return "today";
  const end = new Date(nowIso);
  end.setUTCDate(end.getUTCDate() + daysToWeekEnd(nowIso));
  return due <= ymd(end.toISOString()) ? "week" : "backlog";
}

export function dateForBucket(
  b: "backlog" | "today" | "week",
  nowIso: string
): string | null {
  if (b === "backlog") return null;
  if (b === "today") return ymd(nowIso);
  const end = new Date(nowIso);
  end.setUTCDate(end.getUTCDate() + daysToWeekEnd(nowIso));
  return ymd(end.toISOString());
}

export function laneOf(t: TaskLensFields, view: BoardView, nowIso: string): string {
  if (view === "status") return t.status;
  if (view === "time") return t.status === "done" ? "done" : bucket(t.due_at, nowIso);
  return t.stage ?? stageFromStatus(t.kind, t.status) ?? t.status;
}

/** What persisting a drop from `toLane` means, as a field patch. The only place this
 *  logic lives. */
export function movePatch(
  t: TaskLensFields,
  view: BoardView,
  toLane: string,
  nowIso: string
): { status?: string; due_at?: string | null; stage?: string | null } {
  if (view === "status") {
    return { status: toLane, stage: stageFromStatus(t.kind, toLane) };
  }
  if (view === "time") {
    if (toLane === "done") return { status: "done" };
    return {
      due_at: dateForBucket(toLane as "backlog" | "today" | "week", nowIso),
      status: t.status === "done" ? "in_progress" : t.status,
    };
  }
  return { stage: toLane, status: statusFromStage(t.kind, toLane) };
}
