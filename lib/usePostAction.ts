"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

export interface ActionMessage {
  kind: "ok" | "error";
  text: string;
}

/** POST JSON, show the outcome, refresh the server-rendered page behind the form.
 *
 *  The admin editors (catalogue, commission) all do the same dance: lock the buttons, post,
 *  read the API's own `error` string on failure, otherwise confirm and re-fetch the page's
 *  data. `send` resolves to whether it worked, so a caller can chain a follow-up (clearing a
 *  form) only on success. */
export function usePostAction() {
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
          setMessage({ kind: "error", text: json.error ?? "ثبت نشد" });
          return false;
        }
        setMessage({ kind: "ok", text: okText });
        router.refresh();
        return true;
      } finally {
        setBusy(false);
      }
    },
    [router]
  );

  return { busy, message, send };
}
