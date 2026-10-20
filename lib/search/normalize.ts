/** One way to compare Persian text typed by a person: Persian/Arabic digits to ASCII, Arabic
 *  ي / ك to ی / ک, no half-spaces, lower-cased. Search boxes and pickers share it so a name
 *  typed with an Arabic keyboard still finds the customer saved with a Persian one. */
export function normalizeSearch(s: string): string {
  return s
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0))
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/‌/g, "")
    .toLowerCase()
    .trim();
}
