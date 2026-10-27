"use client";

import { GoButton, SkipButton } from "@/components/tapflow/Answer";
import { useState } from "react";
import { friendlyError } from "@/lib/userMessage";
import { Icon } from "@/components/meridian/Icon";
import type { CustomStepApi } from "@/components/tapflow/TapFlow";

/** Paste a Google Maps / SnappFood / Instagram link; the server resolves name, pin and address. */
export default function LinkStep({ api }: { api: CustomStepApi }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const resolve = async (u: string) => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/crm/resolve-link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: u }) });
      const j = (await res.json()) as { ok: boolean; link?: unknown; error?: string };
      if (!j.ok) { setErr(friendlyError(j.error, "لینک خوانده نشد؛ لینک را بررسی کنید و دوباره تلاش کنید")); return; }
      api.submit("ok", JSON.stringify(j.link));
    } catch {
      setErr("اتصال برقرار نشد. اینترنت را بررسی کنید و دوباره تلاش کنید.");
    } finally {
      setBusy(false);
    }
  };
  const paste = async () => {
    try {
      const m = /https?:\/\/\S+/.exec(await navigator.clipboard.readText());
      if (!m) { setErr("در کلیپ‌بورد لینکی نیست"); return; }
      setUrl(m[0]);
      void resolve(m[0]);
    } catch {
      setErr("اجازهٔ خواندن کلیپ‌بورد داده نشد؛ لینک را در کادر بچسبانید");
    }
  };

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8 }}>
        <input className="tf-input ltr" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://maps.app.goo.gl/…" aria-label="لینک" inputMode="url" />
        <button type="button" className="inline-flex items-center justify-center gap-[var(--space-2)] btn ghost" onClick={() => void paste()}>
        <Icon name="clipboard" size="md" />
        چسباندن</button>
      </div>
      {err ? <div className="tf-card warn">{err}</div> : null}
      <GoButton icon="link" isDisabled={!url.trim() || busy} onPress={() => void resolve(url.trim())}>{busy ? "در حال خواندن لینک…" : "خواندن لینک و ادامه"}</GoButton>
      <SkipButton icon="link" onPress={() => api.submit("nolink")}>لینک ندارم</SkipButton>
    </>
  );
}
