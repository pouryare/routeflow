/** The platform owner's view of companies: create one (with its first owner login and optional address),
 *  list them with their addresses, edit, and manage addresses. Callers run inside withDbScope("all"). */

import { getDb } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import type { DomainStatus } from "@/lib/repo/companyDomains";

export interface CompanyDomainRow {
  id: number;
  hostname: string;
  status: DomainStatus;
  last_checked_at: string | null;
  last_error: string | null;
}
export interface CompanyRow {
  id: number;
  name: string;
  active: number;
  has_logo: boolean;
  created_at: string;
  users: number;
  domains: CompanyDomainRow[];
}

export const MAX_LOGO_BYTES = 150 * 1024;
export type LogoType = "image/png" | "image/jpeg" | "image/webp";

/** The type of an image by its first bytes, or null: a file's own claim about its type is not trusted. */
export function sniffLogo(bytes: Buffer): LogoType | null {
  if (bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length > 12 && bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

export async function listCompanies(): Promise<CompanyRow[]> {
  const db = getDb();
  const orgs = (await db
    .prepare(
      `SELECT o.id, o.name, o.active, o.created_at, (o.logo_data IS NOT NULL) AS has_logo,
              (SELECT COUNT(*) FROM users u WHERE u.organization_id = o.id AND u.active = 1) AS users
       FROM organizations o ORDER BY o.name`
    )
    .all()) as unknown as { id: number; name: string; active: number; created_at: string; has_logo: boolean | number; users: number | string }[];
  const doms = (await db
    .prepare("SELECT id, organization_id, hostname, status, last_checked_at, last_error FROM company_domains ORDER BY id")
    .all()) as unknown as (CompanyDomainRow & { organization_id: number })[];
  return orgs.map((o) => ({
    id: o.id,
    name: o.name,
    active: o.active,
    created_at: o.created_at,
    has_logo: !!o.has_logo,
    users: Number(o.users),
    domains: doms
      .filter((d) => d.organization_id === o.id)
      .map((d) => ({ id: d.id, hostname: d.hostname, status: d.status, last_checked_at: d.last_checked_at, last_error: d.last_error })),
  }));
}

export interface NewCompany {
  name: string;
  hostname: string | null;
  logo: { data: Buffer; type: LogoType } | null;
  owner: { username: string; displayName: string; password: string };
}

function slugFor(name: string, hostname: string | null): string {
  const base = (hostname ?? name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return `${base || "co"}-${Math.random().toString(36).slice(2, 6)}`;
}

/** One company with its first owner (who must change the password at first sign-in) and, if given, its address.
 *  All or nothing. Throws the database's UNIQUE error on a taken username or address; callers map it to a 409. */
export async function createCompany(c: NewCompany): Promise<number> {
  const db = getDb();
  const now = new Date().toISOString();
  return await db.tx(async () => {
    const org = (await db
      .prepare("INSERT INTO organizations (name, slug, logo_data, logo_type, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id")
      .get(c.name, slugFor(c.name, c.hostname), c.logo ? c.logo.data.toString("base64") : null, c.logo?.type ?? null, now)) as { id: number };
    await db
      .prepare(
        `INSERT INTO users (username, password_hash, display_name, role, active, token_version, created_at, organization_id, must_change_password)
         VALUES (?, ?, ?, 'owner', 1, 0, ?, ?, 1)`
      )
      .run(c.owner.username, hashPassword(c.owner.password), c.owner.displayName, now, org.id);
    if (c.hostname) {
      await db.prepare("INSERT INTO company_domains (organization_id, hostname, created_at) VALUES (?, ?, ?)").run(org.id, c.hostname, now);
    }
    return org.id;
  });
}

export async function updateCompany(
  id: number,
  f: { name?: string; active?: boolean; logo?: { data: Buffer; type: LogoType } | "remove" }
): Promise<boolean> {
  const sets: string[] = [];
  const vals: (string | number)[] = [];
  if (f.name !== undefined) { sets.push("name = ?"); vals.push(f.name); }
  if (f.active !== undefined) { sets.push("active = ?"); vals.push(f.active ? 1 : 0); }
  if (f.logo === "remove") sets.push("logo_data = NULL", "logo_type = NULL");
  else if (f.logo) { sets.push("logo_data = ?", "logo_type = ?"); vals.push(f.logo.data.toString("base64"), f.logo.type); }
  if (!sets.length) return true;
  const r = await getDb().prepare(`UPDATE organizations SET ${sets.join(", ")} WHERE id = ?`).run(...vals, id);
  return r.changes > 0;
}

export async function organizationExists(id: number): Promise<boolean> {
  return !!(await getDb().prepare("SELECT 1 FROM organizations WHERE id = ?").get(id));
}

/** Throws the database's UNIQUE error on an address another company already has. */
export async function addDomain(organizationId: number, hostname: string): Promise<number> {
  const r = (await getDb()
    .prepare("INSERT INTO company_domains (organization_id, hostname, created_at) VALUES (?, ?, ?) RETURNING id")
    .get(organizationId, hostname, new Date().toISOString())) as { id: number };
  return r.id;
}

export async function findDomain(id: number): Promise<{ id: number; organization_id: number; hostname: string } | undefined> {
  return (await getDb().prepare("SELECT id, organization_id, hostname FROM company_domains WHERE id = ?").get(id)) as
    | { id: number; organization_id: number; hostname: string }
    | undefined;
}

export async function setDomainStatus(id: number, status: DomainStatus, error: string | null): Promise<void> {
  await getDb()
    .prepare("UPDATE company_domains SET status = ?, last_error = ?, last_checked_at = ? WHERE id = ?")
    .run(status, error, new Date().toISOString(), id);
}

export async function removeDomain(id: number): Promise<void> {
  await getDb().prepare("DELETE FROM company_domains WHERE id = ?").run(id);
}
