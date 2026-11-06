"use client";

import { useEffect } from "react";
import { driver, type Driver } from "driver.js";
import "driver.js/dist/driver.css";

export function fxOn() {
  return typeof document !== "undefined" && document.documentElement.dataset.fx !== "off";
}

/** The spotlight: dim the page, leave a bright hole around the button, and pulse the button. Inside an
 *  open sheet there is no dim (the sheet already sits over the page), only the pulse. `setHand` gets
 *  the button's centre so the hand can point at it. */
export function useSpotlight(el: HTMLElement | null, showHints: boolean, setHand: (p: { x: number; y: number }) => void) {
  useEffect(() => {
    if (!el || !showHints) return;
    el.scrollIntoView({ block: "center", behavior: fxOn() ? "smooth" : "auto" });
    el.setAttribute("data-tour-pulse", "");
    const inSheet = !!el.closest('[role="dialog"]');
    let d: Driver | null = null;
    if (!inSheet) {
      d = driver({
        animate: fxOn(),
        overlayOpacity: 0.55,
        stagePadding: 6,
        stageRadius: 14,
        allowClose: false,
        allowKeyboardControl: false,
        overlayClickBehavior: "none",
        disableActiveInteraction: false,
        showButtons: [],
      });
      d.highlight({ element: el });
    }
    const place = () => {
      const r = el.getBoundingClientRect();
      setHand({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
    };
    const id = window.setTimeout(place, fxOn() ? 350 : 0);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      el.removeAttribute("data-tour-pulse");
      d?.destroy();
    };
  }, [el, showHints, setHand]);
}
