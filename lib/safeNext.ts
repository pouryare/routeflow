/** A post-login destination is only ever a path on this site.
 *
 *  `?next=` is attacker-controllable: a link such as /login?next=https://evil.example sent
 *  the user off-site right after they typed their password. Accept a single leading slash
 *  followed by something that is not another slash or a backslash (browsers treat `//host`
 *  and `/\\host` as protocol-relative), and nothing with a scheme or control characters. */
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next || next.length > 2000) return null;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(next)) return null;
  return next;
}
