/** The lunar occasions an owner records each year, so choosing one is a tap, not typing. Order is
 *  rough calendar order through the Hijri year; the free-text title stays available for anything
 *  announced that is not here. */
export const LUNAR_OCCASIONS = [
  "عید فطر",
  "عید قربان",
  "عید غدیر",
  "تاسوعا",
  "عاشورا",
  "اربعین",
  "رحلت پیامبر",
  "شهادت امام رضا",
  "میلاد پیامبر",
  "شهادت حضرت فاطمه",
  "ولادت امام علی",
  "مبعث",
  "نیمهٔ شعبان",
  "شهادت امام علی",
] as const;

/** Is `title` one of the common occasions? A custom title is the exception, not the default. */
export const isCommonOccasion = (title: string): boolean => (LUNAR_OCCASIONS as readonly string[]).includes(title);
