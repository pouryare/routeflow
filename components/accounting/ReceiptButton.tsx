"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/meridian/Icon";

/** The receipt photo of one expense: «رسید» opens it when there is one; otherwise «افزودن رسید» takes
 *  a picture (the camera on a phone) and attaches it. Used on the journal beside an expense row. */
export default function ReceiptButton({ journalId, has }: { journalId: number; has: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<"idle" | "sending" | "failed">("idle");

  async function upload(file: File) {
    setState("sending");
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`/api/accounting/expenses/${journalId}/receipt`, { method: "POST", body: form }).catch(() => null);
    if (res?.ok) {
      setState("idle");
      router.refresh();
    } else setState("failed");
  }

  if (has) {
    return (
      <a
        href={`/api/accounting/expenses/${journalId}/receipt`}
        target="_blank"
        rel="noopener noreferrer"
        className="touch mr-2 inline-flex items-center gap-1 text-[length:var(--text-xs)] text-accent"
      >
        <Icon name="image" size="sm" />
        رسید
      </a>
    );
  }
  return (
    <span className="mr-2 inline-flex items-center gap-1">
      <button
        type="button"
        disabled={state === "sending"}
        onClick={() => input.current?.click()}
        className="touch inline-flex items-center gap-1 text-[length:var(--text-xs)] text-text-muted disabled:opacity-50"
      >
        <Icon name="camera" size="sm" />
        {state === "sending" ? "در حال ارسال…" : "افزودن رسید"}
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        aria-label="عکس رسید"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
          e.target.value = "";
        }}
      />
      {state === "failed" ? <span className="text-[length:var(--text-xs)] text-danger">ارسال نشد</span> : null}
    </span>
  );
}
