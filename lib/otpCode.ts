/* Client-safe on purpose: components/mobile/OtpInput.tsx imports this, and lib/stepUp.ts pulls node:crypto,
   which would put a crypto polyfill (139 KB) in every page's JavaScript. */

/** Western digits for whatever the person typed: Persian and Arabic-Indic digits, spaces and dashes
 *  are accepted, so a code typed on a Persian keyboard is not refused. */
export function normaliseCode(raw: string): string {
  return raw
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\s-]/g, "");
}
