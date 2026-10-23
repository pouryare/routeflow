import fs from "node:fs";
import path from "node:path";
import { getDb, DB_PATH } from "@/lib/db";
import { dialect } from "@/lib/database/dialect";
import { newestForecastAt } from "./forecast";
import type { BackupStatus, StatusFacts } from "../systemStatus";

/** The facts behind the owner's status page (F108), for one organisation. The backup status and
 *  the database size are the server's, shared by every company on it; the rest is this one's. */

/** Where scripts/backup.mjs writes; the same environment variable and default. */
function backupDir(): string {
  return process.env.COVERAGE_BACKUP_DIR || path.join(process.cwd(), "backups");
}

export function readBackupStatus(dir: string = backupDir()): BackupStatus | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(dir, "backup-status.json"), "utf8")) as BackupStatus;
    return typeof parsed?.finishedAt === "string" ? parsed : null;
  } catch {
    return null;
  }
}

function fileBytes(file: string): number {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

export async function statusFacts(organizationId: number, now: Date = new Date()): Promise<StatusFacts> {
  const db = getDb();
  const one = async <T>(sql: string, ...params: (string | number)[]) =>
    (await db.prepare(sql).get(...params) as { t: T } | undefined)?.t ?? null;
  const dayAgo = new Date(now.getTime() - 86_400_000).toISOString();
  const facts = {
    backup: readBackupStatus(),
    analysisAt: await one<string>("SELECT MAX(computed_at) AS t FROM kpi_snapshots WHERE organization_id = ?", organizationId),
    forecastAt: await newestForecastAt(organizationId),
    lastSyncAt: await one<string>("SELECT MAX(received_at) AS t FROM sync_mutations WHERE organization_id = ?", organizationId),
    customersSyncedAt: await one<string>("SELECT MAX(synced_at) AS t FROM customers WHERE organization_id = ?", organizationId),
    lastNotificationAt: await one<string>(
      `SELECT MAX(d.flushed_at) AS t FROM notification_deliveries d JOIN users u ON u.id = d.user_id WHERE u.organization_id = ?`,
      organizationId
    ),
    lastDigestAt: await one<string>(
      "SELECT MAX(created_at) AS t FROM notifications WHERE organization_id = ? AND type_code = 'owner.digest'",
      organizationId
    ),
    failedSignIns24h:
      await one<number>(
        "SELECT COUNT(*) AS t FROM login_events WHERE organization_id = ? AND result <> 'success' AND created_at >= ?",
        organizationId,
        dayAgo
      ) ?? 0,
  };
  // Measured after the reads: the database file is opened by the first statement, not before.
  const dbBytes =
    dialect() === "postgres"
      ? ((await one<number>("SELECT pg_database_size(current_database()) AS t")) ?? 0)
      : fileBytes(DB_PATH) + fileBytes(`${DB_PATH}-wal`);
  return { ...facts, dbBytes: dbBytes > 0 ? dbBytes : null };
}
