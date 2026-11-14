import crypto from "node:crypto";

/** F120: the six-digit code for one order, worked out from the order id and the server secret, so nothing is stored
 *  and nobody can guess it from the order number. The dispatcher reads it to the customer; the customer says it at the door. */
export function deliveryCode(orderId: number, secret: string): string {
  const n = crypto.createHmac("sha256", secret).update(`delivery-code:${orderId}`).digest().readUInt32BE(0) % 1_000_000;
  return String(n).padStart(6, "0");
}

/** Persian and Arabic digits become ASCII so a driver's phone keyboard cannot fail a right code. */
const ascii = (s: string) => s.replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0)).replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/\D/g, "");

/** null = no code was typed (the customer had none, or the stop does not ask), true = it matched, false = it did not. */
export function codeResult(expected: string, given: string | null | undefined): boolean | null {
  const g = ascii(given ?? "");
  return g === "" ? null : g === expected;
}
