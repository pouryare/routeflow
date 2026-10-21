"use client";

import { useCallback, useState } from "react";
import { friendlyError } from "@/lib/userMessage";
import { useToast } from "@/components/ToastProvider";
import { useHeldSave } from "@/components/crm/useHeldSave";

/** One tap that does something, with the 5 s undo instead of an "are you sure?".
 *
 *  For actions that need no question first (confirm an order, advance a stage): the write is
 *  held for the undo window, the toast offers «بازگردانی ثبت», and `pending` is true meanwhile so
 *  the button can say so and not be tapped twice. Leaving the page sends the held write at once
 *  (see useHeldSave), so it is never lost.
 *
 *  Actions that DO need a question first (why was this cancelled?) are tap flows instead. */
export function useUndoableAction() {
  const toast = useToast();
  const { hold, cancel } = useHeldSave();
  const [pending, setPending] = useState(false);

  const run = useCallback(
    (opts: {
      /** The toast: what was done, in the person's words. */
      message: string;
      send: () => Promise<{ ok: boolean; error?: string }>;
      /** Shown when the write fails: what failed and what to do next. */
      failure: string;
      onDone?: () => void;
    }) => {
      setPending(true);
      hold(async () => {
        const r = await opts.send().catch((): { ok: boolean; error?: string } => ({ ok: false }));
        setPending(false);
        if (!r.ok) toast(friendlyError(r.error, opts.failure), "error");
        else opts.onDone?.();
      });
      toast(opts.message, "success", {
        label: "بازگردانی ثبت",
        icon: "undo",
        onClick: () => {
          if (cancel()) setPending(false);
        },
      });
    },
    [hold, cancel, toast],
  );

  return { run, pending };
}
