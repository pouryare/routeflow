/* Z2: one key per form opening. Sent as the Idempotency-Key header, so a double tap or a retry saves once
 * (lib/repo/idempotency.ts). Call renew() after a save worked, so the next entry is a new one. */
export function idemKeeper() {
  let key = crypto.randomUUID();
  return {
    headers: (): Record<string, string> => ({ "Idempotency-Key": key }),
    renew: () => {
      key = crypto.randomUUID();
    },
  };
}
