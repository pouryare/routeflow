"use client";

import { useState } from "react";
import { Button } from "@heroui/react";
import { Icon } from "@/components/meridian/Icon";
import { useToast } from "@/components/ToastProvider";
import BottomSheet from "@/components/mobile/BottomSheet";
import DayChips from "@/components/mobile/DayChips";
import { ChipGroup } from "@/components/mobile/ChipGroup";
import { friendlyError } from "@/lib/userMessage";
import { faDigits } from "@/lib/format";
import { SNOOZE_CHOICES, SNOOZE_HOURS, SNOOZE_PICK_LABEL, SNOOZE_STOPS_PX, type SnoozeChoice } from "@/lib/taskSnooze";

type SnoozeBody = SnoozeChoice | { day: string; hour: number };

/** Sends one snooze (PATCH /api/tasks/[id] { snooze }) and says where the task went. Shared by the buttons
 *  below and the task row's swipe. Resolves true when it moved. */
function useSnooze(taskId: number, onDone: () => void) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function snooze(body: SnoozeBody, label: string): Promise<boolean> {
    setBusy(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snooze: body }),
      }).catch(() => null);
      const j = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
      if (!res?.ok) {
        toast(friendlyError(j?.error, "عقب انداخته نشد؛ دوباره تلاش کنید"), "error");
        return false;
      }
      toast(`به ${label} رفت`, "success");
      onDone();
      return true;
    } finally {
      setBusy(false);
    }
  }
  return { snooze, busy };
}

/** A task row's snooze swipe: stops at 1 h, 3 h, tomorrow 9 and «زمان دیگر», which opens the picker. The row
 *  puts `swipe` on its SwipeRow and renders `picker` outside the swipe face. */
export function useSnoozeSwipe(taskId: number, onDone: () => void) {
  const { snooze, busy } = useSnooze(taskId, onDone);
  const [picking, setPicking] = useState(false);
  const swipe = {
    label: "عقب انداختن",
    icon: "clock" as const,
    stops: [...SNOOZE_CHOICES.map((c) => c.label), SNOOZE_PICK_LABEL].map((label, i) => ({ at: SNOOZE_STOPS_PX[i], label })),
    run: (stop?: number) => {
      const c = stop === undefined ? undefined : SNOOZE_CHOICES[stop];
      if (c) void snooze(c.id, c.label);
      else setPicking(true);
    },
  };
  const picker = (
    <SnoozePicker
      open={picking}
      busy={busy}
      onClose={() => setPicking(false)}
      onPick={async (day, hour, label) => {
        if (await snooze({ day, hour }, label)) setPicking(false);
      }}
    />
  );
  return { swipe, picker, openPicker: () => setPicking(true) };
}

/** «زمان دیگر»: a day (DayChips) and an hour, then one button. */
function SnoozePicker({ open, onClose, onPick, busy }: {
  open: boolean;
  onClose: () => void;
  onPick: (day: string, hour: number, label: string) => void;
  busy: boolean;
}) {
  const [day, setDay] = useState("");
  const [hour, setHour] = useState("9");
  return (
    <BottomSheet open={open} title="عقب انداختن تا…" subtitle="روز و ساعت را انتخاب کنید" onClose={onClose} closeLabel="بستن انتخاب زمان">
      <div className="flex flex-col gap-[var(--space-3)]">
        <DayChips value={day} onChange={setDay} ariaLabel="روز" />
        <ChipGroup
          wrap
          group={{
            id: "snooze-hour",
            label: "ساعت",
            mode: "single",
            options: SNOOZE_HOURS.map((h) => ({ id: String(h), label: faDigits(`${h}:00`) })),
            value: hour,
            onChange: (v) => setHour((v as string) || hour),
          }}
        />
        <Button variant="primary" size="lg" fullWidth isDisabled={!day || busy} onPress={() => onPick(day, Number(hour), "زمانی که انتخاب کردید")}>
          <Icon name="clock" size="md" />
          عقب انداختن
        </Button>
      </div>
    </BottomSheet>
  );
}

/** F142: «بعداً» on a task or reminder. One tap opens the choices beside it, a second tap moves the due time.
 *  The server refuses urgent work and a fourth snooze; the screen only offers it when the card says
 *  `snoozable`. The task row's swipe reaches the same times and its last stop opens the picker, so a row
 *  passes `onPickOpen` and renders SnoozePicker itself, outside its swipe face. */
export default function SnoozeChoices({ taskId, onDone, onPickOpen }: {
  taskId: number;
  onDone: () => void;
  /** The row holds the picker: «زمان دیگر» asks it to open instead of opening one here. */
  onPickOpen?: () => void;
}) {
  const { snooze, busy } = useSnooze(taskId, onDone);
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);

  const picker = onPickOpen ? null : (
    <SnoozePicker
      open={picking}
      busy={busy}
      onClose={() => setPicking(false)}
      onPick={async (day, hour, label) => {
        if (await snooze({ day, hour }, label)) {
          setPicking(false);
          setOpen(false);
        }
      }}
    />
  );

  if (!open) {
    return (
      <>
        <button type="button" className="inline-flex min-h-[44px] items-center justify-center gap-[var(--space-2)] btn ghost" onClick={() => setOpen(true)}>
          <Icon name="clock" size="sm" />
          عقب انداختن این کار
        </button>
        {picker}
      </>
    );
  }
  return (
    <span className="inline-flex flex-wrap gap-[var(--space-2)]" role="group" aria-label="بعداً">
      {SNOOZE_CHOICES.map((c) => (
        <button key={c.id} type="button" disabled={busy} className="inline-flex min-h-[44px] items-center justify-center gap-[var(--space-2)] btn ghost" onClick={async () => { if (await snooze(c.id, c.label)) setOpen(false); }}>
          <Icon name="clock" size="sm" />
          {c.label}
        </button>
      ))}
      <button type="button" disabled={busy} className="inline-flex min-h-[44px] items-center justify-center gap-[var(--space-2)] btn ghost" onClick={() => (onPickOpen ? onPickOpen() : setPicking(true))}>
        <Icon name="calendar" size="sm" />
        {SNOOZE_PICK_LABEL}
      </button>
      {picker}
    </span>
  );
}
