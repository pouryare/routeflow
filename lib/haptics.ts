"use client";

import { WebHaptics } from "web-haptics";

/** The app's haptic ticks: one shared web-haptics instance (Android: the vibration API;
 *  iPhone: a hidden switch control that Safari ticks when toggled, which only works inside a
 *  tap). Created on first use because it adds that hidden control to the page. When the app
 *  is wrapped with Capacitor, @capacitor/haptics replaces this one function. */
let instance: WebHaptics | null = null;

export type Haptic = "selection" | "light" | "success" | "error";

export function haptic(kind: Haptic): void {
  if (typeof window === "undefined") return;
  instance ??= new WebHaptics();
  void instance.trigger(kind).catch(() => {});
}
