"use client";

import { useEffect, useState } from "react";
import ToggleSwitch from "@/components/ToggleSwitch";
import { applyContrast, readContrast, CONTRAST_CHANGE_EVENT } from "@/lib/contrast";

/** The switch for high contrast, in the account menu. Reads the stored choice after mount (the
 *  server cannot know it) and follows changes made by another copy of itself. */
export default function ContrastToggle() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const sync = () => setOn(readContrast());
    sync();
    window.addEventListener(CONTRAST_CHANGE_EVENT, sync);
    return () => window.removeEventListener(CONTRAST_CHANGE_EVENT, sync);
  }, []);
  return <ToggleSwitch on={on} onChange={() => applyContrast(!on)} label="کنتراست بالا" />;
}
