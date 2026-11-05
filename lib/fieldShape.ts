import { normalisePersian } from "@/lib/persian";
import { faDigits } from "@/lib/format";
import { normPhone } from "@/lib/crm/phone";

/** Live check while typing, for fields with one right shape (owner, 2026-11-05: phone, national
 *  code, IBAN, postal code -- only phone fields exist in the app today). A red hint says what is
 *  missing while the number is still wrong; a check shows once it is right. Nothing shows on an
 *  empty field. Pure, so it is tested. */
export type ShapeHint = { tone: "ok" | "bad"; text: string } | null;

export function phoneHint(raw: string): ShapeHint {
  const text = normalisePersian(raw).trim();
  if (!text) return null;
  if (normPhone(text)) return { tone: "ok", text: "شماره درست است" };
  const digits = text.replace(/\D/g, "");
  /* A local number is 0 and ten more digits; while it is still short, say how many are left. */
  if (/^0[1-9]?\d*$/.test(digits) && digits.length < 11 && !text.startsWith("+")) {
    return { tone: "bad", text: `${faDigits(String(11 - digits.length))} رقم دیگر` };
  }
  return { tone: "bad", text: "شماره درست نیست؛ ۱۱ رقم با ۰ اول" };
}
