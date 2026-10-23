/* The ordered migrations getDb() runs after the base schema. The order is the history of the
 * schema and must not change: a later era assumes the earlier ones have run (for example the
 * tenant-unique rebuilds assume organization_id exists). */
import type { DatabaseSync } from "node:sqlite";
import type { Db } from "./client";
import { applyEarlyColumns } from "./migrations/01-early-columns";
import { applyTenancyBootstrap } from "./migrations/02-tenancy-bootstrap";
import { applyCrmAndTenantColumns } from "./migrations/03-crm-and-tenant-columns";
import { applyTenantUniqueRebuilds } from "./migrations/04-tenant-unique-rebuilds";
import { applyTerritoryOrdersCustomers } from "./migrations/05-territory-orders-customers";
import { applyNotificationsRolesSeeds } from "./migrations/06-notifications-roles-seeds";
import { applyLedgersAndLateColumns } from "./migrations/07-ledgers-and-late-columns";
import { applyFounderSecondFactor } from "./migrations/08-founder-second-factor";
import { applyQuickWins } from "./migrations/09-quick-wins";
import { applyEasyBatch } from "./migrations/10-easy-batch";

/** `adb` is the asynchronous handle on the same connection, for the few migrations that call
 *  app code. */
export async function runMigrations(db: DatabaseSync, adb: Db): Promise<void> {
  applyEarlyColumns(db);
  applyTenancyBootstrap(db);
  await applyCrmAndTenantColumns(db, adb);
  applyTenantUniqueRebuilds(db);
  applyTerritoryOrdersCustomers(db);
  await applyNotificationsRolesSeeds(db, adb);
  await applyLedgersAndLateColumns(db, adb);
  applyFounderSecondFactor(db);
  applyQuickWins(db);
  applyEasyBatch(db);
}
