/** «نیاز به کمک»: what a driver on the road can report with one tap (batch H). */
export const HELP_KINDS = {
  flat_tyre: "پنچری",
  accident: "تصادف",
  breakdown: "خرابی خودرو",
  other: "مشکل دیگر",
} as const;

export type HelpKind = keyof typeof HELP_KINDS;

export function isHelpKind(v: unknown): v is HelpKind {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(HELP_KINDS, v);
}

/** «۵ دقیقه پیش» for the age of the last GPS point; the manager must see how stale it is. */
function ageLabel(ms: number): string {
  const min = Math.max(0, Math.floor(ms / 60000));
  if (min < 1) return "همین الان";
  if (min < 60) return `${min.toLocaleString("fa-IR")} دقیقه پیش`;
  return `${Math.round(min / 60).toLocaleString("fa-IR")} ساعت پیش`;
}

/** The one line a manager reads in the notification. */
export function helpBody(p: { driver: string; phone: string | null; kind: HelpKind; pending: number; positionAgeMs: number | null }): string {
  const parts = [
    `${p.driver}: ${HELP_KINDS[p.kind]}`,
    p.positionAgeMs === null ? "موقعیت ثبت نشده" : `آخرین موقعیت ${ageLabel(p.positionAgeMs)}`,
    `${p.pending.toLocaleString("fa-IR")} توقف مانده`,
    p.phone ? `تماس ${p.phone}` : null,
  ];
  return parts.filter(Boolean).join(" · ");
}
