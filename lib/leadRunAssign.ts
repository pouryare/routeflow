import { faJalaliDate } from "./jalali";
import { faNum } from "./format";
import type { LeadRunStatus } from "./repo/leadRuns";

/** The rules behind handing a route to a driver, with no I/O so they can be tested.
 *
 *  Pure on purpose: this repo has no component tests (no @testing-library, no .test.tsx),
 *  so anything worth asserting about this flow has to be a function, not a render. */

export interface DriverRef {
  id: number;
  name: string;
  avatar_url: string | null;
}

export interface RunRef {
  driver_user_id: number;
  run_date: string;
  status: LeadRunStatus;
}

export type DonePhase = "saving" | "ok" | "bad";

/** Drops ids that can no longer be turned into stops.
 *
 *  A pool is a list of ids, and an id can outlive the location it names: delete a pin while
 *  it sits in a saved list or in the persisted scratch pool, and the id is still there.
 *  `setRunStops` throws `مکان پیدا نشد` for anything missing, so an unfiltered id makes the
 *  hand-over fail at the last possible moment, on a route that was never assignable in the
 *  first place. Filtering on the way in turns that into a stop that quietly is not there.
 *
 *  `lat`/`lng` are the same test the rest of the pool uses to decide routability, so a
 *  location that was never placeable is dropped here too rather than at save time. */
export function assignableIds(
  ids: number[],
  has: (id: number) => boolean,
): number[] {
  return ids.filter(has);
}

/** Dates this driver already has something on, and what state it is in.
 *
 *  The status is kept rather than collapsed to a boolean because the two cases are treated
 *  differently downstream: an active day is blocked outright, a completed one is only a
 *  warning. */
export function busyDatesByDriver(runs: RunRef[]): Map<number, Map<string, LeadRunStatus>> {
  const out = new Map<number, Map<string, LeadRunStatus>>();
  for (const r of runs) {
    let days = out.get(r.driver_user_id);
    if (!days) out.set(r.driver_user_id, (days = new Map()));
    days.set(r.run_date, r.status);
  }
  return out;
}

/** Days that cannot be picked at all: the driver has a live route, so another one would
 *  double-book them. A `done` day is deliberately absent -- overriding a finished day is
 *  allowed, and the caller confirms it. */
export function blockedDates(busy: Map<string, LeadRunStatus> | undefined): Set<string> {
  const out = new Set<string>();
  if (!busy) return out;
  for (const [iso, status] of busy) if (status !== "done") out.add(iso);
  return out;
}

/** Whether picking this day needs the explicit override on the confirm screen. */
export function needsOverride(busy: Map<string, LeadRunStatus> | undefined, iso: string): boolean {
  return busy?.get(iso) === "done";
}

/** How many days this driver already has routes on -- the line under their name.
 *  Persian has a singular, and zero is better said by saying nothing. */
export function busyLabel(days: number): string | null {
  if (days <= 0) return null;
  return days === 1 ? `${faNum(1)} روز مسیر دارد` : `${faNum(days)} روز مسیر دارد`;
}

/** What the done screen is showing.
 *
 *  The bug this replaces: `saved` flips synchronously when the flow is answered, but the
 *  POST is still in the air, so deriving from `message` alone used to claim success and
 *  then take it back a moment later. Nothing is "ok" until a message says so.
 *
 *  `assign()` always sets a message, including on its early return, so "no message yet"
 *  genuinely means the write is in flight and there is no third, stuck case. */
export function donePhase(message: { tone: "ok" | "bad" } | null): DonePhase {
  return message ? (message.tone === "bad" ? "bad" : "ok") : "saving";
}

export interface SummaryInput {
  driverName: string | null;
  /** ISO `YYYY-MM-DD`; empty means no date was chosen. */
  runDate: string;
  stopCount: number;
}

/** The facts being applied, in the order they matter. Shared by the confirm screen and the
 *  done panel so the two can never drift apart. */
export function summaryOf({ driverName, runDate, stopCount }: SummaryInput): string[] {
  return [
    driverName ?? "راننده انتخاب نشده",
    runDate ? faJalaliDate(runDate) : "تاریخ انتخاب نشده",
    `${faNum(stopCount)} توقف`,
  ];
}

/** What is left of a day split once a route has been handed over.
 *
 *  A hand-over is of the *current route*, not of a day. Those differ: the route may be
 *  exactly one day, or a mixture drawn from several. So this removes the assigned ids from
 *  wherever they sit rather than dropping "the day that was assigned", which is not a thing
 *  that exists.
 *
 *  Days that lose every stop disappear -- an empty day is not a day, and `removeFromDayGroup`
 *  already drops them, so this keeps the two rules the same. Everything else keeps its
 *  members *and* its order, which is the part that matters: a proposal is a draft being
 *  shaped, and re-proposing it would throw away the tuning the manager did by hand.
 *
 *  Pure, and therefore testable, because it is the piece most likely to be subtly wrong. */
export function removeHandedOver<T extends { id: number }>(
  days: T[][],
  handedOver: number[],
): T[][] {
  if (handedOver.length === 0) return days;
  const gone = new Set(handedOver);
  return days
    .map((day) => day.filter((stop) => !gone.has(stop.id)))
    .filter((day) => day.length > 0);
}

/** Resolves a scope argument to the locations it names, or the whole working set.
 *
 *  The `Array.isArray` check is the whole point of this function, and it exists because of a
 *  crash rather than a theory. `proposeDays` is wired as `onClick={proposeDays}`, so React
 *  passes the click event as the first argument. While that function took no parameters the
 *  event was discarded harmlessly; the moment it grew an optional `scope`, the event landed
 *  in it, and a SyntheticEvent is truthy -- so it went into `assignableIds` and died on
 *  `ids.filter is not a function`.
 *
 *  A truthiness check cannot catch that. An event is truthy, an array is truthy, and only
 *  the type tells them apart, so the type is what gets asked. Scope order is preserved, and
 *  anything not in `available` is dropped: naming a list must not be a way to pull a lead
 *  in from outside the working set. */
export function resolveScope<T extends { id: number }>(
  scope: unknown,
  available: T[],
): T[] {
  if (!Array.isArray(scope)) return available;
  const wanted = new Set((scope as unknown[]).filter((x): x is number => Number.isInteger(x)));
  const out: T[] = [];
  for (const id of wanted) {
    const found = available.find((l) => l.id === id);
    if (found) out.push(found);
  }
  return out;
}
