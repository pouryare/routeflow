/** The three lenses of the task Board, and the one function that says what dropping a
 *  card in a lane means. Pure — no DB, no I/O. The API (`moveTask`) and every test call
 *  `movePatch`; the client never re-implements the mapping.
 *
 *  A task's canonical `status` is Phase 7's: `open | done | dismissed`. There is no
 *  "in progress" status — instead a task is *in progress* when `started_at` is set and
 *  it is not yet done. That keeps `listTasks({status:'open'})` and the briefing exactly
 *  as they were while giving the Board a real middle column for every kind.
 *
 *  For the three pipeline kinds a task also carries a `stage`. `stage` is nullable:
 *  NULL means "derive it from status/started_at", so a task made before this feature or
 *  by a Phase 7 rule still lands in the right workflow lane. Any move writes a fresh
 *  stage back.
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
  started_at: string | null;
  due_at: string | null;
}

/** The patch a move persists. `started_at` is included so the status/workflow lenses can
 *  set or clear the "in progress" marker. */
export interface MovePatch {
  status?: string;
  started_at?: string | null;
  due_at?: string | null;
  stage?: string | null;
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

/** The stage a task sits at when none is stored, from its status + started marker. */
export function deriveStage(t: Pick<TaskLensFields, "kind" | "status" | "started_at">): string | null {
  const s = STAGES[t.kind];
  if (!s) return null;
  if (t.status === "done") return s[s.length - 1];
  if (t.started_at) return s[Math.min(1, s.length - 2)];
  return s[0];
}

/** The stage for a bare status (used when creating a task, before it is started). */
export function stageFromStatus(kind: string, status: string): string | null {
  const s = STAGES[kind];
  if (!s) return null;
  if (status === "done") return s[s.length - 1];
  return s[0];
}

/** Given a stage, the canonical status it implies (first stage → open, last → done,
 *  anything between → open, i.e. still not done — the "in progress" nuance is carried by
 *  started_at, not by status). */
export function statusFromStage(kind: string, stage: string): string {
  const s = STAGES[kind];
  if (!s) return "open";
  return s.indexOf(stage) === s.length - 1 ? "done" : "open";
}

/** Is a stage a middle one (started, not finished)? */
function isMidStage(kind: string, stage: string): boolean {
  const s = STAGES[kind];
  if (!s) return false;
  const i = s.indexOf(stage);
  return i > 0 && i < s.length - 1;
}

const ymd = (iso: string): string => iso.slice(0, 10);

/** Days from the given instant to the end of its Jalali week (Friday). The Jalali week
 *  runs Saturday→Friday, and Sat/Sun/…/Fri are the same physical days in both calendars,
 *  so the Gregorian weekday is enough. JS `getUTCDay()` is Sunday=0…Saturday=6; shift so
 *  Saturday=0…Friday=6. */
function daysToWeekEnd(nowIso: string): number {
  const jIndex = (new Date(nowIso).getUTCDay() + 1) % 7;
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

export function dateForBucket(b: "backlog" | "today" | "week", nowIso: string): string | null {
  if (b === "backlog") return null;
  if (b === "today") return ymd(nowIso);
  const end = new Date(nowIso);
  end.setUTCDate(end.getUTCDate() + daysToWeekEnd(nowIso));
  return ymd(end.toISOString());
}

export function laneOf(t: TaskLensFields, view: BoardView, nowIso: string): string {
  if (view === "status") {
    if (t.status === "done") return "done";
    return t.started_at ? "in_progress" : "open";
  }
  if (view === "time") return t.status === "done" ? "done" : bucket(t.due_at, nowIso);
  return t.stage ?? deriveStage(t) ?? (t.status === "done" ? "done" : "open");
}

/** What persisting a drop from `toLane` means, as a field patch. The only place this
 *  logic lives. */
/** The patch that closes a task: status done, and — for a pipeline kind — its stage
 *  snapped to the last stage so the workflow lens shows it in the done column too. */
function closedPatch(kind: string): MovePatch {
  const s = STAGES[kind];
  return s ? { status: "done", stage: s[s.length - 1] } : { status: "done" };
}

export function movePatch(
  t: TaskLensFields,
  view: BoardView,
  toLane: string,
  nowIso: string
): MovePatch {
  if (view === "status") {
    if (toLane === "done") return closedPatch(t.kind);
    if (toLane === "in_progress") {
      return {
        status: "open",
        started_at: t.started_at ?? nowIso,
        stage: STAGES[t.kind] ? deriveStage({ kind: t.kind, status: "open", started_at: nowIso }) : undefined,
      };
    }
    // → open
    return {
      status: "open",
      started_at: null,
      stage: STAGES[t.kind] ? STAGES[t.kind][0] : undefined,
    };
  }

  if (view === "time") {
    if (toLane === "done") return closedPatch(t.kind);
    return {
      due_at: dateForBucket(toLane as "backlog" | "today" | "week", nowIso),
      status: t.status === "done" ? "open" : t.status,
    };
  }

  // workflow
  const stages = STAGES[t.kind];
  if (!stages) {
    // no pipeline for this kind — the workflow lens shows status lanes, treat like status
    return movePatch(t, "status", toLane, nowIso);
  }
  if (toLane === stages[stages.length - 1]) return { stage: toLane, status: "done" };
  if (toLane === stages[0]) return { stage: toLane, status: "open", started_at: null };
  return {
    stage: toLane,
    status: "open",
    started_at: isMidStage(t.kind, toLane) ? (t.started_at ?? nowIso) : t.started_at,
  };
}
