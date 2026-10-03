/** What every phase receives, and the scale profiles the CLI chooses between.
 *
 *  `asOf` is the anchor date (YYYY-MM-DD). Everything dated is relative to it, so a run is
 *  reproducible and "last 7 days" always has something in it.
 */

import type { DatabaseSync } from "node:sqlite";
import type { Rng } from "./rng";

export interface ScaleProfile {
  name: string;
  customers: number;
  leads: number;
  months: number;
  /** Orders per customer per week. ~0.62 over 36 months at 500 customers ≈ 15,000 orders. */
  ordersPerCustomerPerWeek: number;
  /** Customers who ordered and then went quiet, so churn can find training labels. */
  lapsedCustomers: number;
}

export const HEAVY: ScaleProfile = {
  name: "heavy", customers: 500, leads: 200, months: 36,
  ordersPerCustomerPerWeek: 0.62, lapsedCustomers: 30,
};

/** Small but structurally complete — same phases, same columns, seconds not minutes. */
export const SMOKE: ScaleProfile = {
  name: "smoke", customers: 40, leads: 20, months: 8,
  ordersPerCustomerPerWeek: 0.5, lapsedCustomers: 12,
};

/** Ids carried between phases. Every field is optional because each phase fills its own. */
export interface SeedIds {
  facility?: number;
  groupIds?: number[];
  productIds?: number[];
  customerIds?: number[];
  /** Phase 04 marks these dormant; phase 05 stops generating orders for them. */
  lapsedCustomerIds?: number[];
  leadLocationIds?: number[];
  /** Filled by phase 10, keyed by slug so no caller hardcodes an id. */
  tenantOrgIds?: Record<string, number>;
}

export interface SeedContext {
  db: DatabaseSync;
  rng: Rng;
  scale: ScaleProfile;
  /** The anchor date, YYYY-MM-DD. GREGORIAN. Use `periodOf()` for Jalali keys. */
  asOf: string;
  /** Milliseconds since epoch for asOf, at 12:00 UTC to dodge a DST edge. */
  asOfMs: number;
  /** ISO date `daysAgo` days before the anchor. */
  iso(daysAgo: number): string;
  /** Full ISO timestamp `daysAgo` days before the anchor. */
  stamp(daysAgo: number): string;
  /** The primary tenant's id, filled by phase 01. */
  orgId: number;
  /** userId by role, filled by phase 01. */
  staff: Record<string, number>;
  ids: SeedIds;
  /** Printed in the summary so the tester knows who to log in as. */
  logins: { username: string; role: string; password: string }[];
  progress(msg: string): void;
}

export const DAY_MS = 86_400_000;
