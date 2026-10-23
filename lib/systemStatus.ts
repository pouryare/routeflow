/** F108: the owner's status page, as pure rules. lib/repo/systemStatus.ts gathers the facts;
 *  this turns them into lines with a tone, so the thresholds are tested without a database.
 *
 *  Every check answers "is something quietly broken?". A missing fact is `unknown`, never good:
 *  a backup that never wrote its status file is the failure this page exists to show. */
import { freshnessTier } from "./freshness";

export type Tone = "good" | "warn" | "bad" | "unknown";

export interface BackupStatus {
  ok: boolean;
  finishedAt: string;
  database: { file: string; bytes: number; check: string } | null;
  photos: { file: string; bytes: number; check: string } | null;
  error: string | null;
}

export interface StatusFacts {
  backup: BackupStatus | null;
  analysisAt: string | null;
  forecastAt: string | null;
  lastSyncAt: string | null;
  customersSyncedAt: string | null;
  lastNotificationAt: string | null;
  failedSignIns24h: number;
  dbBytes: number | null;
}

export interface StatusLine {
  key: string;
  label: string;
  tone: Tone;
  /** When the fact happened (ISO), for the page to render as a date; null if none. */
  at: string | null;
  detail: string;
}

const HOUR = 3_600_000;

function ageTone(at: string | null, now: Date, warnHours: number, badHours: number): Tone {
  if (!at) return "unknown";
  const hours = (now.getTime() - Date.parse(at)) / HOUR;
  if (hours >= badHours) return "bad";
  if (hours >= warnHours) return "warn";
  return "good";
}

function megabytes(bytes: number): string {
  return `${(bytes / 1_048_576).toFixed(1)} مگابایت`;
}

export function statusLines(f: StatusFacts, now: Date = new Date()): StatusLine[] {
  const backupAge = ageTone(f.backup?.finishedAt ?? null, now, 30, 48);
  const backupTone: Tone = !f.backup ? "unknown" : !f.backup.ok ? "bad" : backupAge;
  const backupDetail = !f.backup
    ? "پروندهٔ وضعیت پشتیبان پیدا نشد؛ پشتیبان‌گیری شبانه یا اجرا نشده یا هنوز به نسخهٔ تازه نرسیده است."
    : !f.backup.ok
      ? `آخرین پشتیبان ناموفق بود: ${f.backup.error ?? f.backup.database?.check ?? "بررسی رد شد"}`
      : `سالم${f.backup.database ? ` · ${megabytes(f.backup.database.bytes)}` : ""} · فقط روی همین سرور، نسخهٔ بیرونی هنوز نیست`;

  const freshness = freshnessTier(f.customersSyncedAt, now);
  return [
    { key: "backup", label: "پشتیبان شبانه", tone: backupTone, at: f.backup?.finishedAt ?? null, detail: backupDetail },
    {
      key: "analysis",
      label: "محاسبهٔ شاخص‌ها",
      tone: ageTone(f.analysisAt, now, 30, 72),
      at: f.analysisAt,
      detail: f.analysisAt ? "به‌روزرسانی شبانهٔ شاخص‌ها و امتیازها" : "هنوز اجرا نشده",
    },
    {
      key: "forecast",
      label: "پیش‌بینی فروش",
      tone: ageTone(f.forecastAt, now, 30, 72),
      at: f.forecastAt,
      detail: f.forecastAt ? "به‌روزرسانی شبانهٔ پیش‌بینی" : "هنوز اجرا نشده",
    },
    {
      key: "sync",
      label: "همگام‌سازی گوشی‌ها",
      // A quiet day is normal (a weekend), so this never goes past "warn" by itself.
      tone: f.lastSyncAt ? ageTone(f.lastSyncAt, now, 72, Infinity) : "unknown",
      at: f.lastSyncAt,
      detail: f.lastSyncAt ? "آخرین کاری که از گوشی بدون اینترنت رسید" : "هنوز چیزی از گوشی‌ها نرسیده",
    },
    {
      key: "customers",
      label: "تازگی دادهٔ مشتریان",
      tone: freshness === "fresh" ? "good" : freshness === "ageing" ? "warn" : freshness === "stale" ? "bad" : "unknown",
      at: f.customersSyncedAt,
      detail: "آخرین ورود فایل مشتریان",
    },
    {
      key: "notifications",
      label: "ارسال اعلان",
      tone: f.lastNotificationAt ? "good" : "unknown",
      at: f.lastNotificationAt,
      detail: f.lastNotificationAt ? "آخرین اعلانی که به تلگرام یا گوشی فرستاده شد" : "هنوز اعلانی بیرون فرستاده نشده",
    },
    {
      key: "signins",
      label: "ورودهای ناموفق در ۲۴ ساعت",
      tone: f.failedSignIns24h >= 20 ? "bad" : f.failedSignIns24h >= 5 ? "warn" : "good",
      at: null,
      detail: `${f.failedSignIns24h.toLocaleString("fa-IR")} بار`,
    },
    {
      key: "database",
      label: "حجم پایگاه داده",
      tone: f.dbBytes === null ? "unknown" : "good",
      at: null,
      detail: f.dbBytes === null ? "نامعلوم" : megabytes(f.dbBytes),
    },
  ];
}
