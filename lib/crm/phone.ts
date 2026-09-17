import { normalisePersian } from "@/lib/persian";

/** Compare Iranian phones by their last ten digits, ignoring country/trunk prefixes. */
export function normPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = normalisePersian(raw).replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : null;
}

export function formatPhone(norm: string): string {
  return `0${norm.slice(0, 3)} ${norm.slice(3, 6)} ${norm.slice(6)}`;
}

export function telHref(norm: string): string {
  return `tel:0${norm}`;
}

export function normName(s: string): string {
  return normalisePersian(s).replace(/[\s\p{P}\p{S}]/gu, "").toLowerCase();
}

/** Exact normalized names, or containment when the shorter name has at least six letters. */
export function namesAlike(a: string, b: string): boolean {
  const x = normName(a);
  const y = normName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [s, l] = x.length <= y.length ? [x, y] : [y, x];
  return s.length >= 6 && l.includes(s);
}
