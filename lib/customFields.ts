/** F122: owner-defined customer fields. Pure. Five types, at most ten active fields, a value is always stored as text. */

export const FIELD_KINDS = [
  { id: "text", label: "متن" },
  { id: "number", label: "عدد" },
  { id: "choice", label: "انتخابی" },
  { id: "date", label: "تاریخ" },
  { id: "yes_no", label: "بله یا نه" },
] as const;
export type FieldKind = (typeof FIELD_KINDS)[number]["id"];
export const isFieldKind = (v: unknown): v is FieldKind => FIELD_KINDS.some((k) => k.id === v);

export const MAX_ACTIVE_FIELDS = 10;
const MAX_CHOICES = 12;

export interface FieldDef { id: number; name: string; kind: FieldKind; choices: string[] }

/** A field name: 1 to 40 characters. */
export function parseName(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "";
  return s.length >= 1 && s.length <= 40 ? s : null;
}

/** The choices of a choice field, from a list or from text split on «،», «,» or new lines. 2 to 12 different ones, each up to 30 characters. */
export function parseChoices(v: unknown): string[] | null {
  const raw = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[،,\n]/) : [];
  const out = [...new Set(raw.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean))];
  return out.length >= 2 && out.length <= MAX_CHOICES && out.every((c) => c.length <= 30) ? out : null;
}

const toEnglishDigits = (s: string) => s.replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))).replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));

/** A value as it is stored, `null` to clear it, or the reason it is refused. Blank clears. */
export function checkValue(def: Pick<FieldDef, "kind" | "choices">, raw: unknown): string | null | { error: string } {
  if (raw === null || raw === undefined || (typeof raw === "string" && raw.trim() === "")) return null;
  switch (def.kind) {
    case "text": {
      const s = typeof raw === "string" ? raw.trim() : "";
      return s && s.length <= 200 ? s : { error: "متن حداکثر ۲۰۰ حرف است" };
    }
    case "number": {
      const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(toEnglishDigits(raw.trim()).replace(/[,٬]/g, "")) : NaN;
      return Number.isFinite(n) && Math.abs(n) < 1e15 ? String(n) : { error: "عدد نامعتبر است" };
    }
    case "choice":
      return typeof raw === "string" && def.choices.includes(raw) ? raw : { error: "این گزینه تعریف نشده" };
    case "date":
      return typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw) && !Number.isNaN(Date.parse(raw)) ? raw : { error: "تاریخ نامعتبر است" };
    case "yes_no":
      return raw === true || raw === "1" ? "1" : raw === false || raw === "0" ? "0" : { error: "فقط بله یا نه" };
  }
}
