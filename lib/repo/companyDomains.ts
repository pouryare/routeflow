/** Company addresses: which company a web address belongs to, and the platform switches around it.
 *  Reads here run for the sign-in page, before any session exists, so callers wrap them in
 *  withDbScope("system") (lib/database/scope.ts). */

import { getDb } from "@/lib/db";
import { isPlatformOwner } from "@/lib/roles";

export type DomainStatus = "waiting_dns" | "waiting_arvan" | "active" | "failed";

/** What an address means:
 *  - company: a registered, active address of that company;
 *  - main: the platform's own address (or any address when MAIN_HOST is not set);
 *  - unknown: MAIN_HOST is set and this is neither it nor an active company address. */
export type HostKind =
  | { kind: "company"; organizationId: number; name: string; logo: string | null }
  | { kind: "main" }
  | { kind: "unknown" };

export async function resolveHost(host: string | null): Promise<HostKind> {
  const db = getDb();
  if (host) {
    const row = await db
      .prepare(
        `SELECT o.id, o.name, o.logo_data, o.logo_type FROM company_domains d
         JOIN organizations o ON o.id = d.organization_id
         WHERE d.hostname = ? AND d.status = 'active' AND o.active = 1`
      )
      .get(host) as { id: number; name: string; logo_data: string | null; logo_type: string | null } | undefined;
    if (row) {
      return {
        kind: "company",
        organizationId: row.id,
        name: row.name,
        logo: row.logo_data && row.logo_type ? `data:${row.logo_type};base64,${row.logo_data}` : null,
      };
    }
  }
  const main = process.env.MAIN_HOST?.trim().toLowerCase();
  // shortcut: without MAIN_HOST every unregistered address is the main one (as before this feature); set it on the server.
  return !main || host === main ? { kind: "main" } : { kind: "unknown" };
}

/** Has a company registered this address (in any state)? Caddy's permission check for making a certificate. */
export async function isRegisteredHost(host: string): Promise<boolean> {
  return !!(await getDb().prepare("SELECT organization_id FROM company_domains WHERE hostname = ?").get(host));
}

async function platformSetting(key: string): Promise<string | null> {
  const row = await getDb().prepare("SELECT value FROM platform_settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export async function setPlatformSetting(key: string, value: string): Promise<void> {
  await getDb()
    .prepare("INSERT INTO platform_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value")
    .run(key, value);
}

/** Is the main address closed to everyone but platform owners? (Off until the owner switches it on.) */
export async function mainAddressOwnerOnly(): Promise<boolean> {
  return (await platformSetting("main_address_owner_only")) === "1";
}

/** May this person sign in on this kind of address? Platform owners may anywhere; a company's people only on
 *  their own company's address, and on the main address only while it is open to them. */
export function mayUseAddress(
  host: HostKind,
  user: { role: string; organization_id: number | null },
  mainOwnerOnly: boolean
): boolean {
  if (isPlatformOwner(user.role)) return true;
  if (host.kind === "company") return user.organization_id === host.organizationId;
  if (host.kind === "main") return !mainOwnerOnly;
  return false;
}
