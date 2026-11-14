"use client";

import { useState } from "react";
import { Icon } from "@/components/meridian/Icon";
import { useToast } from "@/components/ToastProvider";

const save = (href: string) => {
  const a = document.createElement("a");
  a.href = href;
  a.download = "";
  a.click();
};

/** «خروجی اکسل». A small export downloads at once. A big one (E7) is built on the worker: the button
 *  says so, checks every few seconds for a minute, and the finished file is also announced in the
 *  notification list, so leaving the page loses nothing. */
export default function ExportButton({ url }: { url: string }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function poll(id: number) {
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const j = (await fetch(`/api/exports/${id}`).then((r) => r.json()).catch(() => null)) as { status?: string } | null;
      if (j?.status === "done") {
        toast("خروجی آماده شد", "success", { label: "دانلود", icon: "download", onClick: () => save(`/api/exports/${id}?file=1`) });
        return;
      }
      if (j?.status === "failed") return toast("خروجی ساخته نشد. دوباره امتحان کنید.", "error");
    }
    toast("هنوز در حال ساخت است؛ وقتی آماده شد در اعلان‌ها می‌آید.", "info");
  }

  async function run() {
    setBusy(true);
    try {
      const res = await fetch(url);
      if (res.status === 202) {
        const j = (await res.json()) as { job_id: number; total: number };
        toast("فهرست بزرگ است؛ در حال ساخت فایل…", "info");
        await poll(j.job_id);
      } else if (res.ok) {
        const href = URL.createObjectURL(await res.blob());
        save(href);
        setTimeout(() => URL.revokeObjectURL(href), 10_000);
      } else toast("خروجی ساخته نشد", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" className="btn ghost" data-tour="orders-export" disabled={busy} onClick={() => void run()}>
      <Icon name="download" size="md" />
      {busy ? "در حال ساخت…" : "خروجی اکسل"}
    </button>
  );
}
