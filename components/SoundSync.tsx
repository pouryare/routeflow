"use client";

import { useEffect } from "react";
import { prefsOnce } from "@/lib/prefsOnce";
import { configureSound } from "@/lib/sound";
import { isSkin } from "@/lib/soundRecipes";

/** Tells lib/sound.ts, once per page load, this person's sound switch and their company's skin
 *  (GET /api/prefs). Signed out, or a role the route refuses, there is no company: the plain skin.
 *  The answer is kept by lib/sound.ts, so the next load sounds right before this returns. */
export default function SoundSync() {
  useEffect(() => {
    let stopped = false;
    void prefsOnce()
      .then(({ status, data: raw }) => {
        const data = raw as { ok?: boolean; prefs?: { sound?: unknown; sound_volume?: unknown }; soundSkin?: unknown } | null;
        const res = { ok: status >= 200 && status < 300, status };
        if (stopped) return;
        if (!res.ok || !data?.ok) {
          if (res.status === 401 || res.status === 403) configureSound({ skin: null });
          return;
        }
        const s = data.prefs?.sound;
        configureSound({ choice: s === "on" || s === "off" ? s : null, skin: isSkin(data.soundSkin) ? data.soundSkin : null, volume: typeof data.prefs?.sound_volume === "number" ? data.prefs.sound_volume : 100 });
      })
      .catch(() => undefined /* offline: the kept settings stand */);
    return () => {
      stopped = true;
    };
  }, []);
  return null;
}
