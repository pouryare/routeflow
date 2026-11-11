import { domainToASCII } from "node:url";

/** A web address as typed ("https://App.Tamino.ir:443/login") reduced to the bare lowercase host
 *  ("app.tamino.ir"), or null when it is not a usable address. Used for what a platform owner types and
 *  for the Host header, so both sides compare the same way. */
export function normalizeHostname(input: unknown): string | null {
  if (typeof input !== "string") return null;
  let s = input.trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^[a-z]+:\/\//, "").replace(/[/?#].*$/, "").replace(/:\d+$/, "").replace(/\.$/, "");
  s = domainToASCII(s);
  return /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/.test(s) && s.length <= 253 ? s : null;
}

/** The address the request came in on. Only `Host`: Caddy passes it through unchanged and Arvan keeps it,
 *  while X-Forwarded-Host can be set by anyone. */
export function requestHostname(headers: { get(name: string): string | null }): string | null {
  return normalizeHostname(headers.get("host"));
}
