import { describe, it, expect } from "vitest";
import { check, riskyStatements } from "../scripts/check-migrations.mjs";

const up = (sql: string, kind = "expand-only") => `-- Up Migration\n-- rf: ${kind}\n${sql}\n-- Down Migration\nDROP TABLE x;\n`;

describe("migration markers", () => {
  it("passes a migration that only adds", () => {
    expect(check("a.sql", up("ALTER TABLE orders ADD COLUMN note text;\nCREATE INDEX orders_note ON orders (note);"))).toEqual([]);
    expect(check("a.sql", up("ALTER TABLE orders ADD COLUMN tier text NOT NULL DEFAULT 'a';"))).toEqual([]);
  });

  it("lets a new table carry its own constraints, unique indexes and row security", () => {
    const sql = up(
      "CREATE TABLE shares (id serial, org int NOT NULL);\nALTER TABLE shares ADD CONSTRAINT shares_pos CHECK (id > 0);\n" +
        "CREATE UNIQUE INDEX shares_u ON shares (org);\nALTER TABLE shares ENABLE ROW LEVEL SECURITY;\nCREATE POLICY p ON shares USING (true);",
    );
    expect(check("a.sql", sql)).toEqual([]);
  });

  it("does not count what a function body says, only what the file runs", () => {
    const sql = up("CREATE FUNCTION f() RETURNS void AS $$ BEGIN DELETE FROM orders; UPDATE orders SET a = 1; END; $$ LANGUAGE plpgsql;");
    expect(check("a.sql", sql)).toEqual([]);
  });

  it("counts an UNLOGGED table as new too", () => {
    const sql = up("CREATE UNLOGGED TABLE seen (id int, org int);\nALTER TABLE seen ENABLE ROW LEVEL SECURITY;\nCREATE POLICY p ON seen USING (true);");
    expect(check("a.sql", sql)).toEqual([]);
  });

  it("refuses an expand-only marker on statements the previous release can trip over", () => {
    expect(riskyStatements(up("ALTER TABLE orders DROP COLUMN note;"))).toContain("drops something");
    expect(riskyStatements(up("ALTER TABLE orders RENAME COLUMN a TO b;"))).toContain("renames something");
    expect(riskyStatements(up("ALTER TABLE orders ALTER COLUMN a SET NOT NULL;"))).toContain("makes a column required");
    expect(riskyStatements(up("ALTER TABLE orders ADD COLUMN a int NOT NULL;"))).toContain("adds a required column with no default");
    expect(riskyStatements(up("UPDATE orders SET a = 1;"))).toContain("changes existing rows");
    expect(riskyStatements(up("ALTER TABLE orders ADD CONSTRAINT c CHECK (a > 0);"))).toHaveLength(1);
    expect(check("b.sql", up("DELETE FROM orders;"))[0]).toContain("mark it '-- rf: contract'");
  });

  it("ignores comments and the down part", () => {
    expect(check("a.sql", up("-- DROP TABLE orders;\nALTER TABLE orders ADD COLUMN n int;"))).toEqual([]);
  });

  it("accepts anything marked contract and refuses a file with no marker", () => {
    expect(check("a.sql", up("DROP TABLE orders;", "contract"))).toEqual([]);
    expect(check("a.sql", "-- Up Migration\nALTER TABLE orders ADD COLUMN n int;\n")[0]).toContain("no '-- rf: expand-only'");
  });
});
