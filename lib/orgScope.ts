/** SQL that narrows a read to one tenant.
 *
 *  `null` is the platform_owner's "every tenant" (see `orgScopeId` in lib/session.ts); every
 *  other caller passes their own organisation id. The id is a REQUIRED argument of the readers
 *  that use this, never an optional one: a reader that forgot to be scoped then fails to
 *  compile instead of quietly handing one company another's rows. */
export function orgClause(column: string, organizationId: number | null): { sql: string; params: number[] } {
  return organizationId === null ? { sql: "", params: [] } : { sql: ` AND ${column} = ?`, params: [organizationId] };
}
