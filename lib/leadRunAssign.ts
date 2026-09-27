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
