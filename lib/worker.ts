/* The background worker (docs/plans/event-architecture-2026-11-12.md E3, decisions 10.22).
 *
 * pg-boss keeps its queue in the `pgboss` schema of our own database. It starts inside the app process
 * (instrumentation.ts) because the release is a standalone bundle: a separate script could not import
 * lib/**. Several app servers are fine, jobs are claimed with SKIP LOCKED. Split it into its own process
 * when the first CPU-heavy job arrives (OCR, a large export, an 80-stop optimisation); the handlers do
 * not change.
 *
 * The schema is made by a migration (db/migrations/*_pgboss-schema.sql) under the owner role, so
 * pg-boss runs with migrate: false and the web role needs no CREATE. */
import { PgBoss } from "pg-boss";
import type { ConstructorOptions } from "pg-boss";
import { withDbScope } from "@/lib/database/scope";
import { allOrgIds } from "@/lib/repo/organizations";
import { drainEvents } from "@/lib/repo/events";
import { sweepCompanyRules } from "@/lib/repo/rulesSweep";

export const QUEUES = {
  /** Re-run reactions that failed or were cut off, every minute. */
  eventsDrain: "events.drain",
  /** The rules sweep for every company, every 5 minutes (replaces the systemd rules timer). */
  rulesSweep: "rules.sweep",
} as const;

/** Failed jobs are kept 14 days so the status card can show them. */
const RETENTION_DAYS = 14;

let boss: PgBoss | null = null;

export function workerOptions(connectionString: string): ConstructorOptions {
  return {
    connectionString,
    schema: "pgboss",
    max: 3,
    migrate: false,
    createSchema: false,
    application_name: "routeflow-worker",
  };
}

async function eachCompany(fn: (organizationId: number) => Promise<unknown>) {
  await withDbScope("system", async () => {
    for (const id of await allOrgIds()) await fn(id);
  });
}

/** Starts the worker and registers its queues, handlers and schedules. Returns null when it is off. */
export async function startWorker(connectionString = process.env.DATABASE_URL): Promise<PgBoss | null> {
  if (boss) return boss;
  if (!connectionString || process.env.ROUTEFLOW_WORKER === "off") return null;
  const b = new PgBoss(workerOptions(connectionString));
  b.on("error", (err) => console.error("[worker]", err));
  await b.start();
  const queue = { retryLimit: 3, retryDelay: 30, retryBackoff: true, deleteAfterSeconds: RETENTION_DAYS * 86400 } as const;
  await b.createQueue(QUEUES.eventsDrain, queue);
  await b.createQueue(QUEUES.rulesSweep, queue);
  await b.work(QUEUES.eventsDrain, async () => {
    await eachCompany((id) => drainEvents(id));
  });
  await b.work(QUEUES.rulesSweep, async () => {
    await eachCompany((id) => sweepCompanyRules(id));
  });
  await b.schedule(QUEUES.eventsDrain, "* * * * *");
  await b.schedule(QUEUES.rulesSweep, "*/5 * * * *");
  boss = b;
  return b;
}

export async function stopWorker(): Promise<void> {
  const b = boss;
  boss = null;
  await b?.stop({ graceful: true, timeout: 10_000 });
}

export function workerRunning(): boolean {
  return boss !== null;
}
