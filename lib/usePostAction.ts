"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { friendlyError } from "@/lib/userMessage";

export interface ActionMessage {
  kind: "ok" | "error";
  text: string;
}

/** POST JSON, show the outcome, refresh the server-rendered page behind the form.
 *
 *  The admin editors (catalogue, commission) all do the same dance: lock the buttons, post,
 *  read the API's own `error` string on failure, otherwise confirm and re-fetch the page's
 *  data. `send` resolves to whether it worked, so a caller can chain a follow-up (clearing a
 *  form) only on success. `errorFallback` is the sentence shown when the API's error is one
 *  a person could not act on (see friendlyError). */
export function usePostAction(errorFallback = "ثبت نشد؛ دوباره تلاش کنید") {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<ActionMessage | null>(null);

  const send = useCallback(
    async (url: string, body: unknown, okText: string): Promise<boolean> => {
      setBusy(true);
      setMessage(null);
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          setMessage({ kind: "error", text: friendlyError(json.error, errorFallback) });
          return false;
        }
        setMessage({ kind: "ok", text: okText });
        router.refresh();
        return true;
      } finally {
        setBusy(false);
      }
    },
    [router, errorFallback]
  );

  return { busy, message, send };
}
