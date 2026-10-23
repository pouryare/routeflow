import fs from "node:fs";
import path from "node:path";
import { getDb, DB_PATH } from "@/lib/db";
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

export function statusFacts(organizationId: number, now: Date = new Date()): StatusFacts {
  const db = getDb();
  const one = <T>(sql: string, ...params: (string | number)[]) =>
    (db.prepare(sql).get(...params) as { t: T } | undefined)?.t ?? null;
  const dayAgo = new Date(now.getTime() - 86_400_000).toISOString();
  const dbBytes = fileBytes(DB_PATH) + fileBytes(`${DB_PATH}-wal`);

  return {
    backup: readBackupStatus(),
    analysisAt: one<string>("SELECT MAX(computed_at) AS t FROM kpi_snapshots WHERE organization_id = ?", organizationId),
    forecastAt: newestForecastAt(organizationId),
    lastSyncAt: one<string>("SELECT MAX(received_at) AS t FROM sync_mutations WHERE organization_id = ?", organizationId),
    customersSyncedAt: one<string>("SELECT MAX(synced_at) AS t FROM customers WHERE organization_id = ?", organizationId),
    lastNotificationAt: one<string>(
      `SELECT MAX(d.flushed_at) AS t FROM notification_deliveries d JOIN users u ON u.id = d.user_id WHERE u.organization_id = ?`,
      organizationId
    ),
    failedSignIns24h:
      one<number>(
        "SELECT COUNT(*) AS t FROM login_events WHERE organization_id = ? AND result <> 'success' AND created_at >= ?",
        organizationId,
        dayAgo
      ) ?? 0,
    dbBytes: dbBytes > 0 ? dbBytes : null,
  };
}
