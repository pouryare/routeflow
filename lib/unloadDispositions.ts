// Disposition names and labels, split out of lib/repo/unload.ts: that module imports lib/db
// (node:sqlite), so a client component importing a value from it pulls the database into the
// browser bundle and breaks `next build`. Keep this file free of server imports.

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
