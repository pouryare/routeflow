/* The ordered migrations getDb() runs after the base schema. The order is the history of the
 * schema and must not change: a later era assumes the earlier ones have run (for example the
 * tenant-unique rebuilds assume organization_id exists). */
import type { DatabaseSync } from "node:sqlite";
import { applyEarlyColumns } from "./migrations/01-early-columns";
import { applyTenancyBootstrap } from "./migrations/02-tenancy-bootstrap";
import { applyCrmAndTenantColumns } from "./migrations/03-crm-and-tenant-columns";
import { applyTenantUniqueRebuilds } from "./migrations/04-tenant-unique-rebuilds";
import { applyTerritoryOrdersCustomers } from "./migrations/05-territory-orders-customers";
import { applyNotificationsRolesSeeds } from "./migrations/06-notifications-roles-seeds";
import { applyLedgersAndLateColumns } from "./migrations/07-ledgers-and-late-columns";
import { applyFounderSecondFactor } from "./migrations/08-founder-second-factor";
import { applyQuickWins } from "./migrations/09-quick-wins";

export function runMigrations(db: DatabaseSync): void {
  applyEarlyColumns(db);
  applyTenancyBootstrap(db);
  applyCrmAndTenantColumns(db);
  applyTenantUniqueRebuilds(db);
  applyTerritoryOrdersCustomers(db);
  applyNotificationsRolesSeeds(db);
  applyLedgersAndLateColumns(db);
  applyFounderSecondFactor(db);
  applyQuickWins(db);
}
