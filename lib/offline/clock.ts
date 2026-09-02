/** Clock skew, the honest version of "server-authoritative timestamps".
 *
 *  §4.5: for a delivery recorded in a basement at 10:15 and synced at 14:00 the device
 *  clock is the only witness. So both times are kept -- `occurred_at` (device) and
 *  `received_at` (server) -- plus the skew measured each sync, so a device with a wrong
 *  clock is detectable and correctable rather than silently corrupting the timeline.
 */

/** How much to ADD to a device time to get server time. Positive => the device is slow. */
export function measureSkew(serverIso: string, clientMs: number): number {
  return Date.parse(serverIso) - Math.floor(clientMs);
}

/** Apply a measured skew to a device timestamp. */
export function toServerTime(deviceIso: string, skewMs: number): string {
  return new Date(Date.parse(deviceIso) + skewMs).toISOString();
}

/** A skew large enough to be worth flagging (device clock off by more than a minute). */
export const SKEW_WARN_MS = 60_000;

export function skewIsSuspect(skewMs: number): boolean {
  return Math.abs(skewMs) > SKEW_WARN_MS;
}
