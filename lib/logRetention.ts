/* FB41: the log tables that only grow, and how long each is kept. Not history the books or an order's story
 * depend on (those move to archive twins, lib/historyArchive.ts); these are logs of what the machine did.
 * Example: login_events at 90 days: on 13 Aban a row from before 15 Mordad is deleted that night. */
export interface PurgeableLog {
  id: string;
  label: string;
  table: string;
  /** The column that says when the row happened (ISO text). */
  time: string;
  /** Extra condition so a row still in use is never purged. */
  also: string;
  defaultDays: number;
}

export const PURGEABLE_LOGS: readonly PurgeableLog[] = [
  { id: "login_events", label: "ورودهای ناموفق و موفق", table: "login_events", time: "created_at", also: "", defaultDays: 90 },
  { id: "notification_deliveries", label: "ارسال اعلان به پیامرسان‌ها", table: "notification_deliveries", time: "flushed_at", also: "", defaultDays: 90 },
  { id: "sync_mutations", label: "همگام‌سازی گوشی‌ها (کارهای انجام‌شده)", table: "sync_mutations", time: "received_at", also: "AND status IN ('applied', 'duplicate')", defaultDays: 90 },
  { id: "idempotency_keys", label: "کلید جلوگیری از ثبت دوباره", table: "idempotency_keys", time: "created_at", also: "", defaultDays: 7 },
];

export const MIN_KEEP_DAYS = 7;
export const MAX_KEEP_DAYS = 3650;

export const validKeepDays = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= MIN_KEEP_DAYS && n <= MAX_KEEP_DAYS;

/** Rows older than this ISO time are purged. */
export const keepCutoff = (now: Date, days: number): string => new Date(now.getTime() - days * 86_400_000).toISOString();
