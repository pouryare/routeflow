/** Which push-service URLs a browser subscription may point at.
 *
 *  The server POSTs to a subscription's endpoint whenever a notification fires, so an endpoint is
 *  an outbound request target chosen by whoever registered it. Accepting any string let a signed-in
 *  user register http://127.0.0.1:… or a cloud metadata address and have the server call it. Real
 *  subscriptions come from the browser vendors' own push services, so only those hosts are taken. */
const ALLOWED_HOSTS = [
  "fcm.googleapis.com",
  "android.googleapis.com",
  "jmt17.google.com",
  "updates.push.services.mozilla.com",
  "push.services.mozilla.com",
  "web.push.apple.com",
  "push.apple.com",
  "notify.windows.com",
];

export const MAX_PUSH_ENDPOINT_LENGTH = 1000;

export function isAllowedPushEndpoint(value: unknown): value is string {
  if (typeof value !== "string" || value.length > MAX_PUSH_ENDPOINT_LENGTH) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
  const host = url.hostname.toLowerCase();
  return ALLOWED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

/** The p256dh and auth values are base64url strings of fixed small size. */
export function isPushKey(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length >= 8 && value.length <= maxLength && /^[A-Za-z0-9_\-+/=]+$/.test(value);
}
