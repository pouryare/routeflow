/** Remember method (Z10): the paying method a person used last, per flow, on this phone. Only the
 *  method is kept (the owner chose it, 2026-10-30): the category always starts empty. Browser
 *  storage can be missing or refuse (private window), which only means nothing is remembered. */
const key = (flow: "payment" | "expense") => `rf_last_method_${flow}`;

export function readLastMethod(flow: "payment" | "expense"): string | undefined {
  try {
    return localStorage.getItem(key(flow)) ?? undefined;
  } catch {
    return undefined;
  }
}

export function writeLastMethod(flow: "payment" | "expense", method: string | undefined): void {
  if (!method) return;
  try {
    localStorage.setItem(key(flow), method);
  } catch {
    /* nothing remembered */
  }
}
