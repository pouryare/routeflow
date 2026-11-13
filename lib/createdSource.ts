/** T5: how a record came to exist, stored next to who created it (customers, orders, payments, tasks).
 *  One word per way in; rows made before this was recorded have none. */
const CREATED_SOURCE_LABEL = {
  form: "فرم برنامه",
  offline: "همگام‌سازی گوشی",
  import: "بارگذاری اکسل",
  rule: "قانون خودکار",
  conversion: "تبدیل سرنخ به مشتری",
  system: "سامانه",
} as const;

export type CreatedSource = keyof typeof CREATED_SOURCE_LABEL;

/** «فرم برنامه», or nothing for a record made before the source was kept. */
export const createdSourceLabel = (code: string | null | undefined): string | null =>
  code && code in CREATED_SOURCE_LABEL ? CREATED_SOURCE_LABEL[code as CreatedSource] : null;
