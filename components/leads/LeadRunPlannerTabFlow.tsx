"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { friendlyError } from "@/lib/userMessage";
import { Icon } from "@/components/meridian/Icon";
import TapFlow, { type CustomStepApi } from "@/components/tapflow/TapFlow";
import JalaliDateInput from "@/components/meridian/JalaliDateInput";
import DriverPicker from "@/components/leads/assign/DriverPicker";
import RunSummary from "@/components/leads/assign/RunSummary";
import AssignDone from "@/components/leads/assign/AssignDone";
import { useToast } from "@/components/ToastProvider";
import { faNum } from "@/lib/format";
import { answerStep, startFlow } from "@/lib/crm/flows/machine";
import { leadRunFlow } from "@/lib/crm/flows/leadRun";
import { OUTBOX_HOLD_MS } from "@/lib/offline/constants";
import {
  blockedDates,
  busyDatesByDriver,
  needsOverride,
  type DriverRef,
  type RunRef,
} from "@/lib/leadRunAssign";
import { EMPTY_CONTEXT, type FlowContext, type FlowState } from "@/lib/crm/flows/types";
import { tehranTodayIso } from "@/lib/jalali";

/** The part of the created run this sheet hands back. The manager's pool is a `number[]` of
 *  location ids, and it was being handed the whole run object -- which turned the pool into
 *  an object the first time a hand-over succeeded. */
export interface AssignedRun {
  id: number;
  stops: Array<{ location_id: number }>;
}

export interface LeadRunPlannerTabFlowProps {
  open: boolean;
  locationIds: number[];
  /** The created run, plus who it went to and for when. The receipt the page keeps cannot
   *  be built from the run alone: `lead_runs` has no driver name on it, and the date chosen
   *  here is the one that was actually committed. */
  onAssigned: (run: AssignedRun, meta: { driverName: string; runDate: string }) => void;
  onClose: () => void;
}

const CTX: FlowContext = { ...EMPTY_CONTEXT, entry: "add_lead", isManager: true };

export default function LeadRunPlannerTabFlow({
  open,
  locationIds,
  onAssigned,
  onClose,
}: LeadRunPlannerTabFlowProps) {
  const [drivers, setDrivers] = useState<DriverRef[]>([]);
  const [runs, setRuns] = useState<RunRef[]>([]);
  const [driverId, setDriverId] = useState<number | "">("");
  /* Defaults to today, set once per opening rather than in an effect: the host remounts
   * this component on every open (the `key` in the leads page), so a fresh mount is what
   * re-seeds it -- and clearing the date afterwards is not undone underneath the user. */
  /* Today, as the ISO the API wants. A route is nearly always handed over for a day that is
     about to happen, and the choice is shown in the summary rather than made blind. */
  const [runDate, setRunDate] = useState(() => tehranTodayIso());
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  /* The live flow.
   *
   * This is the fix for the `unknown step undefined` crash: TapFlow reads the top of
   * `state.stack` on every render, so handing it a freshly-made `{ stack: [] }` made it
   * look up `steps[undefined]`. Seeding through a lazy initialiser means the stack is
   * never empty by the time TapFlow sees it -- there is no window in which it could be.
   * The host remounts this component per open (see the `key` in the leads page), which
   * both re-seeds the flow and clears the picker's own state for the next hand-over. */
  const [flow, setFlow] = useState<{ ctx: FlowContext; state: FlowState }>(
    () => ({ ctx: CTX, state: startFlow(leadRunFlow, CTX) }),
  );

  /* Drivers to assign to, and the runs already on the calendar -- one round trip each, both
   * already-existing endpoints. This only fetches; applying the result is left to the
   * caller, so the effect below can own its own cancellation without the state write
   * leaking into a callback the linter sees being called synchronously. */
  const loadAssignData = useCallback(async () => {
    const [driversRes, runsRes] = await Promise.all([
      fetch("/api/lead-runs?drivers=1"),
      fetch("/api/lead-runs"),
    ]);
    const [driversData, runsData] = await Promise.all([driversRes.json(), runsRes.json()]);
    return {
      drivers: (driversData?.ok ? (driversData.drivers ?? []) : []) as DriverRef[],
      runs: (runsData?.ok ? (runsData.runs ?? []) : []) as RunRef[],
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      try {
        const fresh = await loadAssignData();
        if (cancelled) return;
        setDrivers(fresh.drivers);
        setRuns(fresh.runs);
      } catch { /* the picker simply stays empty */ }
    })();
    return () => { cancelled = true; };
  }, [open, loadAssignData]);

  const busy = useMemo(() => busyDatesByDriver(runs), [runs]);
  const chosen = drivers.find((d) => d.id === driverId) ?? null;
  const chosenDays = driverId === "" ? undefined : busy.get(driverId);
  const blocked = useMemo(() => blockedDates(chosenDays), [chosenDays]);
  const override = useMemo(() => needsOverride(chosenDays, runDate), [chosenDays, runDate]);

  const assign = useCallback(async () => {
    /* Every exit sets a message. The done screen's "saving" phase is derived from the
     * absence of one, so a silent return here would hang it forever. */
    if (driverId === "" || locationIds.length === 0) {
      setMessage({ tone: "bad", text: "راننده یا مسیر انتخاب نشده است." });
      return;
    }
    if (runDate === "") {
      setMessage({ tone: "bad", text: "تاریخ مسیر انتخاب نشده است." });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/lead-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          driver_user_id: driverId,
          run_date: runDate,
          location_ids: locationIds,
          // Only ever true when the confirm screen has shown the warning first.
          override,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(friendlyError(data?.error, "مسیر ثبت نشد؛ دوباره تلاش کنید"));
      setMessage({
        tone: "ok",
        text: data.reused
          ? "مسیر پیشین این روز جایگزین شد و راننده آن را می‌بیند."
          : "مسیر ثبت شد و به راننده سپرده شد.",
      });
      onAssigned(data.run, { driverName: chosen?.name ?? "راننده", runDate });
      // Re-read the calendar: the day just taken is now the driver's, and
      // "سپردن مسیر دیگر" is a first-class action here. A failure to re-read is harmless --
      // the server refuses a double booking regardless of what the picker still offers.
      try {
        const fresh = await loadAssignData();
        setDrivers(fresh.drivers);
        setRuns(fresh.runs);
      } catch { /* keep what we have */ }
    } catch (e) {
      setMessage({ tone: "bad", text: e instanceof Error ? e.message : "مسیر ثبت نشد؛ دوباره تلاش کنید" });
    } finally {
      setSaving(false);
    }
  }, [chosen, driverId, loadAssignData, locationIds, onAssigned, override, runDate]);

  /** The undo window. Tapping "ثبت و سپردن" starts a timer and a toast together; the route
   *  is written when the timer ends, not when the button is tapped.
   *
   *  This is the same 5 s the rest of the app uses for an undoable mutation, and the same
   *  constant: a toast carrying an action lives `ACTION_LIFETIME_MS`, which *is*
   *  `OUTBOX_HOLD_MS`. So the bar draining above is an honest display of how long the
   *  hand-over is still yours to take back -- importing the number rather than repeating it
   *  is what keeps the visible countdown and the invisible hold from drifting apart.
   *
   *  A hand-over deliberately does not go through the outbox. `mayQueueOffline` is false
   *  for claims and this is one: a route nobody has driven yet is an intention, not a
   *  record of something that already happened. */
  const [holding, setHolding] = useState(false);
  const holdRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearHold = useCallback(() => {
    if (holdRef.current !== null) clearTimeout(holdRef.current);
    holdRef.current = null;
    setHolding(false);
  }, []);

  /** Nobody is going to act on a hand-over the sheet was closed mid-way through. */
  useEffect(() => clearHold, [clearHold]);

  /** Back to a blank hand-over, keeping the date: it is a visible default, and a manager
   *  handing over a second route usually means the same day. */
  const restart = useCallback(() => {
    clearHold();
    setFlow({ ctx: CTX, state: startFlow(leadRunFlow, CTX) });
    setDriverId("");
    setMessage(null);
    setSaving(false);
  }, [clearHold]);

  /** Start the undo window. The flow is deliberately NOT advanced here: submitting the
   *  machine's option is what flips `saved` and puts the done screen up, and doing that
   *  before the write would mean a cancel had to un-save the state machine. Holding on the
   *  confirm screen means the manager watches the summary they are about to commit, with a
   *  draining bar over it and a way out.
   *
   *  `onSaved` is the only caller of `assign` that is left. The old auto-submit could also
   *  reach it, which is how one confirm could fire two POSTs. */
  const beginHandover = useCallback(() => {
    if (holding) return;
    setHolding(true);
    holdRef.current = setTimeout(() => {
      holdRef.current = null;
      setHolding(false);
      setFlow((f) => {
        if (!f) return f;
        // The window is 5 s of real time and the flow can move underneath it: a back tap
        // from the confirm screen leaves `date` on top, and submitting "confirm" against
        // that step would answer a question nobody asked. Only ever fire on the step the
        // window was opened from.
        const top = f.state.stack[f.state.stack.length - 1];
        if (f.state.saved || top !== "submit") return f;
        return { ...f, state: answerStep(leadRunFlow, f.ctx, f.state, "confirm") };
      });
    }, OUTBOX_HOLD_MS);
    toast(
      `تا ${faNum(OUTBOX_HOLD_MS / 1000)} ثانیه دیگر مسیر به راننده سپرده می‌شود.`,
      "info",
      {
        label: "لغو سپردن مسیر",
        // No second toast: `ToastProvider` dismisses the one that owned this action, and
        // the confirm button reverting from "در انتظار تأیید…" is itself the confirmation
        // that the cancel landed. A second toast would only be noise.
        onClick: clearHold,
      },
    );
  }, [clearHold, holding, toast]);

  /** Replaces TapFlow's own step body, so each screen has to offer its own way forward:
   * the machine advances only when one of its options is submitted. */
  const renderCustom = useCallback((api: CustomStepApi) => {
    if (api.step.id === "driver") {
      return (
        /* No continue button: a driver is a choice, not a question with an answer to
         * confirm. Tapping a face is the answer, and it moves on. */
        <DriverPicker
          drivers={drivers}
          busy={busy}
          selectedId={driverId}
          onSelect={(id) => {
            setDriverId(id);
            api.submit("next");
          }}
        />
      );
    }

    if (api.step.id === "date") {
      const taken = blocked.size;
      return (
        <div className="flex flex-col gap-2">
          <JalaliDateInput
            value={runDate}
            onChange={setRunDate}
            required
            isDisabled={(iso) => blocked.has(iso)}
            aria-label="تاریخ مسیر"
          />
          {driverId === "" ? (
            <p className="tf-note">ابتدا راننده را انتخاب کنید.</p>
          ) : taken > 0 ? (
            <p className="tf-note">
              {faNum(taken)} روز از این ماه برای این راننده مسیر فعال دارد و انتخاب نمی‌شود.
            </p>
          ) : null}
          <button
            type="button"
            className="inline-flex items-center justify-center gap-[var(--space-2)] btn solid w-full px-4 py-2"
            disabled={runDate === "" || driverId === ""}
            onClick={() => api.submit("next")}
          >
            <Icon name="arrow-left" size="md" />
            ادامه به مرحلهٔ بعد
          </button>
        </div>
      );
    }

    if (api.step.id === "submit") {
      return (
        <div className="flex flex-col gap-2">
          <RunSummary
            driverId={driverId === "" ? undefined : driverId}
            driverName={chosen?.name ?? null}
            driverAvatar={chosen?.avatar_url ?? null}
            runDate={runDate}
            stopCount={locationIds.length}
          />
          {override ? (
            <p className="tf-note warn">
              این روز قبلاً برای این راننده تکمیل شده است. با ثبت، مسیر پیشین جایگزین می‌شود.
            </p>
          ) : null}
          <button
            type="button"
            className="inline-flex items-center justify-center gap-[var(--space-2)] btn solid w-full px-4 py-2"
            disabled={driverId === "" || runDate === "" || holding}
            onClick={beginHandover}
          >
            <Icon name="route" size="md" />
            {override ? "جایگزینی و سپردن" : holding ? "در انتظار تأیید…" : "ثبت و سپردن"}
          </button>
          {/* The bar that used to drain across this button now belongs to the toast `لغو`
              opens. Its lifetime is `OUTBOX_HOLD_MS` too, so the countdown a manager reads
              and the countdown the write obeys are the same five seconds. Nothing here
              writes until that one ends. */}
          {holding ? (
            <p className="tf-note">می‌توانید تا پایان شمارش، سپردن را لغو کنید.</p>
          ) : null}
        </div>
      );
    }

    return null;
  }, [beginHandover, blocked, busy, chosen, driverId, drivers, holding, locationIds.length, override, runDate]);

  /* Nothing renders while the sheet is closed. */
  if (!open) return null;

  const done = (
    <AssignDone
      message={message}
      saving={saving}
      driverId={driverId}
      driverName={chosen?.name ?? null}
      driverAvatar={chosen?.avatar_url ?? null}
      runDate={runDate}
      stopCount={locationIds.length}
      onClose={onClose}
      onRetry={() => { void assign(); }}
      onRestart={restart}
    />
  );

  return (
    <TapFlow
      open={open}
      title="سپردن مسیر به راننده"
      config={leadRunFlow}
      ctx={flow.ctx}
      state={flow.state}
      onState={(next) => setFlow((f) => (f ? { ...f, state: next } : f))}
      onSaved={() => { void assign(); }}
      onClose={onClose}
      renderCustom={renderCustom}
      done={done}
    />
  );
}