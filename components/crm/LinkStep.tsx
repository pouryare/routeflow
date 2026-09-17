"use client";

import { useState } from "react";
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
      if (!j.ok) { setErr(j.error ?? "لینک خوانده نشد"); return; }
      api.submit("ok", JSON.stringify(j.link));
    } catch {
      setErr("اتصال برقرار نشد");
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
        <button type="button" className="btn ghost" onClick={() => void paste()}>چسباندن</button>
      </div>
      {err ? <div className="tf-card warn">{err}</div> : null}
      <button type="button" className="tf-go" disabled={!url.trim() || busy} onClick={() => void resolve(url.trim())}>{busy ? "در حال خواندن…" : "ادامه"}</button>
      <button type="button" className="tf-skip" onClick={() => api.submit("nolink")}>لینک ندارم</button>
    </>
  );
}
