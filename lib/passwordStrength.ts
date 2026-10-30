export const MIN_PASSWORD = 8;

export interface PasswordRule {
  id: string;
  label: string;
  met: boolean;
}

/** The rules shown under a new-password field, ticked as the person types. The server only
 *  insists on the length (MIN_PASSWORD); the others are advice, and `score` counts how many are met. */
export function passwordRules(pw: string): { rules: PasswordRule[]; score: number } {
  const rules: PasswordRule[] = [
    { id: "len", label: "حداقل ۸ نویسه", met: pw.length >= MIN_PASSWORD },
    { id: "long", label: "۱۲ نویسه یا بیشتر", met: pw.length >= 12 },
    { id: "digit", label: "یک رقم", met: /\d|[۰-۹]/.test(pw) },
    { id: "mix", label: "حرف و نماد یا حروف بزرگ و کوچک", met: /[A-Z]/.test(pw) && /[a-z]/.test(pw) || /[^\p{L}\p{N}\s]/u.test(pw) },
  ];
  return { rules, score: rules.filter((r) => r.met).length };
}
