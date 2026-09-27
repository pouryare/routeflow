"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import TapFlow, { type CustomStepApi } from "@/components/tapflow/TapFlow";
import JalaliDateInput from "@/components/meridian/JalaliDateInput";
import DriverPicker from "@/components/leads/assign/DriverPicker";
import RunSummary from "@/components/leads/assign/RunSummary";
import AssignDone from "@/components/leads/assign/AssignDone";
import { faNum } from "@/lib/format";
import { startFlow } from "@/lib/crm/flows/machine";
import { leadRunFlow } from "@/lib/crm/flows/leadRun";
import {
  blockedDates,
  busyDatesByDriver,
  needsOverride,
  type DriverRef,
  type RunRef,
} from "@/lib/leadRunAssign";
import { EMPTY_CONTEXT, type FlowContext, type FlowState } from "@/lib/crm/flows/types";

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
  onAssigned: (run: AssignedRun) => void;
  onClose: () => void;
}

const CTX: FlowContext = { ...EMPTY_CONTEXT, entry: "add_lead", isManager: true };

/** Today, as the ISO the API wants. A route is nearly always handed over for a day that is
 *  about to happen, and the choice is shown in the summary rather than made blind. */
const todayIso = () => new Date().toISOString().slice(0, 10);

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
  const [runDate, setRunDate] = useState(todayIso);
  const [saving, setSaving] = useState(false);
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
      if (!res.ok || !data.ok) throw new Error(data?.error ?? "ثبت مسیر انجام نشد");
      setMessage({
        tone: "ok",
        text: data.reused
          ? "مسیر پیشین این روز جایگزین شد و راننده آن را می‌بیند."
          : "مسیر ثبت شد و به راننده سپرده شد.",
      });
      onAssigned(data.run);
      // Re-read the calendar: the day just taken is now the driver's, and
      // "سپردن مسیر دیگر" is a first-class action here. A failure to re-read is harmless --
      // the server refuses a double booking regardless of what the picker still offers.
      try {
        const fresh = await loadAssignData();
        setDrivers(fresh.drivers);
        setRuns(fresh.runs);
      } catch { /* keep what we have */ }
    } catch (e) {
      setMessage({ tone: "bad", text: e instanceof Error ? e.message : "خطا" });
    } finally {
      setSaving(false);
    }
  }, [driverId, loadAssignData, locationIds, onAssigned, override, runDate]);

  /** Back to a blank hand-over, keeping the date: it is a visible default, and a manager
   *  handing over a second route usually means the same day. */
  const restart = useCallback(() => {
    setFlow({ ctx: CTX, state: startFlow(leadRunFlow, CTX) });
    setDriverId("");
    setMessage(null);
    setSaving(false);
  }, []);

  /* Replaces TapFlow's own step body, so each screen has to offer its own way forward:
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
            className="btn solid w-full px-4 py-2"
            disabled={runDate === "" || driverId === ""}
            onClick={() => api.submit("next")}
          >
            ادامه
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
            /* The confirm is this screen, so a completed day does not need a fourth
             * question -- it needs to say plainly what the tap is about to undo. */
            <p className="tf-note warn">
              این روز قبلاً برای این راننده تکمیل شده است. با ثبت، مسیر پیشین جایگزین می‌شود.
            </p>
          ) : null}
          <button
            type="button"
            className="btn solid w-full px-4 py-2"
            disabled={driverId === "" || runDate === ""}
            onClick={() => api.submit("confirm")}
          >
            {override ? "جایگزینی و سپردن" : "ثبت و سپردن"}
          </button>
        </div>
      );
    }

    return null;
  }, [blocked, busy, chosen, driverId, drivers, locationIds.length, override, runDate]);

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