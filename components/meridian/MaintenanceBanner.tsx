"use client";

import { useSyncExternalStore } from "react";
import { Alert, Button } from "@heroui/react";
import { Icon } from "@/components/meridian/Icon";
import { faJalaliDateTime } from "@/lib/jalali";
import type { Maintenance } from "@/lib/maintenance";

const KEY = "rf_maintenance_hidden";
const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => void listeners.delete(cb);
};
const read = (): string | null => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};

/** T17: the owner's maintenance window, for everyone. Before it starts it announces; while it runs
 *  it warns. Drivers and reps are also told to sync their offline work first. «بستن» hides this one
 *  window on this phone; a new window shows again. AppHeader decides the phase. */
export default function MaintenanceBanner({ m, phase, syncFirst }: { m: Maintenance; phase: "soon" | "now"; syncFirst: boolean }) {
  const hiddenFor = useSyncExternalStore(subscribe, read, () => null);
  if (hiddenFor === m.from) return null;
  const hide = () => {
    try { localStorage.setItem(KEY, m.from); } catch { /* hidden until the page reloads */ }
    listeners.forEach((l) => l());
  };
  const when = `${faJalaliDateTime(m.from)} تا ${faJalaliDateTime(m.to)}`;
  return (
    <Alert status={phase === "now" ? "danger" : "warning"} className="actas" role="status">
      <Alert.Indicator>
        <Icon name="settings" size="sm" />
      </Alert.Indicator>
      <Alert.Content className="actas__text">
        <Alert.Description>
          {phase === "now" ? "برنامه در حال به‌روزرسانی است" : "به‌روزرسانی برنامه"}: {when}
          {m.note ? ` · ${m.note}` : ""}
          {syncFirst && phase === "soon" ? " · پیش از شروع، کارهای ثبت‌شده بدون اینترنت را همگام کنید." : ""}
        </Alert.Description>
      </Alert.Content>
      <Button size="sm" variant="ghost" className="min-h-[44px]" onPress={hide}>
        <Icon name="x" size="md" />
        بستن
      </Button>
    </Alert>
  );
}
