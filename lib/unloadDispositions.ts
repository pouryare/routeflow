/** What can happen to stock a driver brings back.
 *
 *  Kept apart from lib/repo/unload.ts, which opens the database: the unload sheet on a phone
 *  needs these names and labels, and importing them from the repository module drags
 *  node:sqlite into the browser bundle, which crashes the driver page.
 */

export type Disposition =
  | "returned"
  | "damaged"
  | "expired"
  | "discarded"
  | "lost"
  | "sample";

export const DISPOSITIONS: Disposition[] = [
  "returned",
  "damaged",
  "expired",
  "discarded",
  "lost",
  "sample",
];

export const DISPOSITION_LABEL: Record<Disposition, string> = {
  returned: "برگشت به انبار",
  damaged: "خراب",
  expired: "تاریخ مصرف گذشته",
  discarded: "دور ریخته شد",
  lost: "گم شده",
  sample: "نمونه",
};
