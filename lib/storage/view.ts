/** What the storage page shows, worked out without React so it can be tested (docs/storage.md section 6). */

import { faNum } from "@/lib/format";
import type { EventKind, PublicStorage } from "@/lib/repo/storages";
import { ARVAN_PRESETS } from "./s3";

const GB = 1024 ** 3;

/** 3.2 گیگابایت, 820 مگابایت, 5 ترابایت. */
export function faBytes(n: number): string {
  if (n >= 1024 * GB) return `${faNum(Math.round((n / (1024 * GB)) * 10) / 10)} ترابایت`;
  if (n >= GB) return `${faNum(Math.round((n / GB) * 10) / 10)} گیگابایت`;
  if (n >= 1024 ** 2) return `${faNum(Math.round(n / 1024 ** 2))} مگابایت`;
  if (n >= 1024) return `${faNum(Math.round(n / 1024))} کیلوبایت`;
  return `${faNum(n)} بایت`;
}

/** `ok`, `warn` past the warning level, `over` past the plan size (still uploading when the storage
 *  is set to keep going: shown in orange, decision 22). `none` when no plan size is set. */
export function usageTone(s: Pick<PublicStorage, "used_bytes" | "plan_bytes" | "warn_percent">): "none" | "ok" | "warn" | "over" {
  if (!s.plan_bytes) return "none";
  if (s.used_bytes >= s.plan_bytes) return "over";
  if (s.used_bytes * 100 >= s.plan_bytes * s.warn_percent) return "warn";
  return "ok";
}

/** Width of the usage bar, 0 to 100. */
export const usagePercent = (s: Pick<PublicStorage, "used_bytes" | "plan_bytes">) =>
  s.plan_bytes ? Math.min(100, Math.round((s.used_bytes / s.plan_bytes) * 100)) : 0;

/** «آروان، تهران» for a preset endpoint, otherwise the host, or «دیسک سرور». */
export function providerLabel(s: Pick<PublicStorage, "kind" | "endpoint">): string {
  if (s.kind === "local") return "دیسک سرور (فقط توسعه)";
  const preset = ARVAN_PRESETS.find((p) => p.endpoint === s.endpoint);
  if (preset) return preset.label;
  try {
    return new URL(s.endpoint ?? "").host;
  } catch {
    return s.endpoint ?? "";
  }
}

/** The plan sizes offered as chips (Arvan's plans), in GB; «سایر» opens a field. */
export const PLAN_CHOICES = [
  { gb: 5, label: "۵ گیگ (رایگان)" },
  { gb: 500, label: "۵۰۰ گیگ" },
  { gb: 5120, label: "۵ ترابایت" },
] as const;

export const WARN_CHOICES = [80, 90, 95] as const;

export const EVENT_LABEL: Record<EventKind, string> = {
  added: "فضا اضافه شد",
  edited: "تنظیمات تغییر کرد",
  key_swapped: "کلید عوض شد",
  rules_changed: "قاعده‌ها تغییر کرد",
  check_failed: "بررسی ناموفق",
  check_ok: "دوباره کار می‌کند",
  held: "فایل روی سرور ماند",
  near_full: "نزدیک به پر شدن",
  spilled: "سرریز به فضای دیگر",
  move_started: "انتقال شروع شد",
  move_done: "انتقال تمام شد",
  removed: "فضا حذف شد",
  file_missing: "فایل پیدا نشد",
  restored: "فایل بازگردانده شد",
  purged: "سطل زباله خالی شد",
};

export const BAD_EVENTS = new Set<EventKind>(["check_failed", "held", "near_full", "file_missing"]);

/** Plan size in GB for the form from stored bytes; null when unset. */
export const planGb = (bytes: number | null) => (bytes ? Math.round((bytes / GB) * 100) / 100 : null);
