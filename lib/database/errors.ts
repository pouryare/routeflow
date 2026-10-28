/* Which constraint a failed statement broke: PostgreSQL sets a SQLSTATE code on the error. */

const CODES = { unique: "23505", check: "23514", foreignKey: "23503", notNull: "23502" } as const;

const violates = (e: unknown, kind: keyof typeof CODES): boolean =>
  e instanceof Error && (e as Error & { code?: string }).code === CODES[kind];

export const isUniqueViolation = (e: unknown) => violates(e, "unique");
export const isCheckViolation = (e: unknown) => violates(e, "check");
