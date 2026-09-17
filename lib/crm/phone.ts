import { normalisePersian } from "@/lib/persian";

/** Validate Iranian phones before normalizing; never strip letters or truncate digits. */
export function normPhone(raw: string | null | undefined): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const text = normalisePersian(raw).trim();
  if (!/^\+?[\d\s()-]+$/.test(text)) return null;
  const compact = text.replace(/[\s()-]/g, "");
  const match = /^(?:\+98|0098|0)?([1-9]\d{9})$/.exec(compact);
  return match?.[1] ?? null;
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
