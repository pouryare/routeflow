// Single-process, in-memory fixed-window rate limiter. Sufficient here because the
// app runs as one systemd-managed Node process (no multi-instance/serverless
// deployment where an in-memory store would miss requests handled by other
// instances) -- reaching for Redis or similar for a single shared-password login
// form would be solving a scale problem this app doesn't have.

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// Periodic sweep so long-lived buckets from one-off keys don't accumulate forever.
setInterval(
  () => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (now >= bucket.resetAt) buckets.delete(key);
    }
  },
  5 * 60 * 1000
).unref();

export function rateLimit(
  key: string,
  max: number,
  windowMs: number
): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  if (bucket.count >= max) {
    return { allowed: false, retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  bucket.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

export function rateLimitReset(key: string): void {
  buckets.delete(key);
}

export function clientKey(req: { headers: Headers }): string {
  const fwd = req.headers.get("x-forwarded-for");
  const ip = fwd?.split(",")[0]?.trim();
  return ip || "unknown";
}
