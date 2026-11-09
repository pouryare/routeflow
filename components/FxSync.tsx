"use client";

import { useEffect } from "react";
import { prefsOnce } from "@/lib/prefsOnce";
import { fxOn, isCompanyFx, isWeakPhone } from "@/lib/fx";

/** Once per page load: reads the company's switch and this person's own (GET /api/prefs), weighs them with
 *  reduced motion and the phone's strength (lib/fx.ts), and sets `data-fx="off"` on <html> when effects
 *  should not play. CSS does the rest. Signed out or offline, effects stay as they were. */
export default function FxSync() {
  useEffect(() => {
    let stopped = false;
    void prefsOnce()
      .then(({ status, data: raw }) => {
        const data = raw as { ok?: boolean; prefs?: { effects?: unknown }; effects?: unknown } | null;
        const res = { ok: status >= 200 && status < 300, status };
        if (stopped || !res.ok || !data?.ok) return;
        const nav = navigator as Navigator & { deviceMemory?: number };
        const p = data.prefs?.effects;
        const on = fxOn({
          company: isCompanyFx(data.effects) ? data.effects : "auto",
          person: p === "on" || p === "off" ? p : null,
          reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
          weak: isWeakPhone(nav.deviceMemory, nav.hardwareConcurrency),
        });
        document.documentElement.dataset.fx = on ? "on" : "off";
      })
      .catch(() => undefined);
    return () => {
      stopped = true;
    };
  }, []);
  return null;
}
