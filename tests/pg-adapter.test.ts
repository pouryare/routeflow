import { describe, it, expect } from "vitest";
import { toPg } from "@/lib/database/pg";

/* The SQL rewrite the PostgreSQL adapter applies to statements written for both engines. */
describe("toPg", () => {
  it("numbers the placeholders, skipping string literals and quoted names", () => {
    expect(toPg(`SELECT '?', "a?b" FROM t WHERE x = ? AND y IN (?, ?)`)).toBe(
      `SELECT '?', "a?b" FROM t WHERE x = $1 AND y IN ($2, $3)`
    );
  });
  it("keeps an escaped quote inside a literal", () => {
    expect(toPg(`SELECT 'it''s ?' WHERE a = ?`)).toBe(`SELECT 'it''s ?' WHERE a = $1`);
  });
  it("quotes a camelCase alias everywhere it is used, and leaves snake_case alone", () => {
    expect(toPg("SELECT SUM(amount_toman) AS amountToman FROM t ORDER BY amountToman")).toBe(
      'SELECT SUM(amount_toman) AS "amountToman" FROM t ORDER BY "amountToman"'
    );
  });
});
