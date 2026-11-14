/** F73: the one-line before-and-after text an `edit` event carries («اولویت: عادی ← فوری»). */
export function editNote(field: string, before: string, after: string): string {
  return `${field}: ${before} ← ${after}`;
}
