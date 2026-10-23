/* Which constraint a failed statement broke, asked the same way on SQLite and PostgreSQL.
 * node:sqlite says it in the message ("UNIQUE constraint failed: ..."); pg sets a SQLSTATE code
 * (23505 and friends) and words the message differently. */

const PG_CODES = { unique: "23505", check: "23514", foreignKey: "23503", notNull: "23502" } as const;
const SQLITE_TEXT = { unique: /UNIQUE constraint/, check: /CHECK constraint/, foreignKey: /FOREIGN KEY constraint/, notNull: /NOT NULL constraint/ };

type Violation = keyof typeof PG_CODES;

function violates(e: unknown, kind: Violation): boolean {
  if (!(e instanceof Error)) return false;
  return (e as Error & { code?: string }).code === PG_CODES[kind] || SQLITE_TEXT[kind].test(e.message);
}

export const isUniqueViolation = (e: unknown) => violates(e, "unique");
export const isCheckViolation = (e: unknown) => violates(e, "check");
