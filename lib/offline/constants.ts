/** How long an offline mutation sits in the outbox as `held` before the sync engine may
 *  pick it up. This is the SAME number the undo bar in components/ToastProvider.tsx
 *  drains over (`ACTION_LIFETIME_MS`), by design: the shrinking bar is an honest display
 *  of how long the mutation is still yours to take back with a local delete rather than a
 *  compensating write. One constant so the visible bar and the invisible hold cannot
 *  drift apart -- see docs/crm-erp-plan.md 4.6.
 *
 *  5 s, one undo window for the whole app (decided 2026-09-11, docs/tap-flow-principles.md §6.6).
 */
export const OUTBOX_HOLD_MS = 5000;

/** Sync cadence while online. */
export const SYNC_INTERVAL_MS = 30_000;

/** Retry backoff: min(BASE * 2^attempts, CAP), then the record stays `failed`. */
export const RETRY_BASE_MS = 30_000;
export const RETRY_CAP_MS = 600_000;
export const MAX_ATTEMPTS = 8;
